import json
import os
import threading
import time
from copy import deepcopy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen


HOST = "0.0.0.0"
PORT = 8000
REQUEST_TIMEOUT = 4
STATUS_REQUEST_TIMEOUT = 1.5
STATUS_CACHE_TTL_SECONDS = 0.4
STATE_FILE = os.path.join(os.path.dirname(__file__), "esp32_state.json")
STATE_FILE_TMP = f"{STATE_FILE}.tmp"
DEFAULT_DEVICE_IP = "192.168.0.20"
IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD = 30.0
IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD = 100.0
IRRIGATION_PH_TARGET = 7.0
IRRIGATION_PH_TOLERANCE = 0.05
IRRIGATION_LOW_PH_THRESHOLD = 4.0
IRRIGATION_HIGH_PH_THRESHOLD = 10.0
IRRIGATION_PH_STEP_PER_TICK = 0.1
MAIN_TANK_STOP_PERCENT = 100.0
MAIN_TANK_REFILL_START_PERCENT = 20.0
GREENHOUSE_FAN_TEMP_THRESHOLD = 40.0
GREENHOUSE_FAN_HUMIDITY_THRESHOLD = 70.0
GREENHOUSE_TEMP_MIN = 20.0
GREENHOUSE_TEMP_OFF_STEP_PER_TICK = 0.5
SIMULATION_TICK_SECONDS = 4.0
MOISTURE_AUTO_IRRIGATION_DURATION_SECONDS = 120.0

DEFAULT_STATE = {
    "deviceIp": "",
    "connected": False,
    "lastError": "ESP32 IP not configured",
    "state": {
        "tank": 41,
        "tankSensor": {
            "value": 41,
            "online": False,
            "lastUpdatedAt": None,
            "error": "Main tank sensor not initialized",
        },
        "pumping": False,
        "mainTankManualOverride": None,
        "flowRate": 0.0,
        "gh": {
            "temp": 35,
            "humidity": 65,
            "fireAlert": False,
            "fireSensor": {
                "online": False,
                "lastUpdatedAt": None,
                "raw": "",
                "error": "Farmhouse fire sensor not initialized",
            },
        },
        "f1": {
            "moisture": 62.4,
            "ph": 6.81,
            "wl": 21.3,
            "n": 42,
            "p": 35,
            "k": 55,
            "irrigation": False,
            "drain": False,
            "acid": False,
            "base": False,
        },
        "f2": {
            "moisture": 60.8,
            "ph": 8.10,
            "wl": 13.3,
            "n": 38,
            "p": 28,
            "k": 48,
            "irrigation": False,
            "drain": False,
            "acid": False,
            "base": False,
        },
        "f3": {
            "moisture": 24.0,
            "ph": 3.2,
            "wl": 8.5,
            "n": 22,
            "p": 18,
            "k": 31,
            "irrigation": False,
            "drain": False,
            "acid": False,
            "base": False,
        },
    },
}

STATE_LOCK = threading.Lock()
IRRIGATION_END_TIMES = {"f1": None, "f2": None, "f3": None}
LOW_MOISTURE_LATCHES = {"f1": False, "f2": False, "f3": False}
PH_CONTROL_LATCHES = {"f1": False, "f2": False, "f3": False}
MANUAL_IRRIGATION_OVERRIDES = {"f1": None, "f2": None, "f3": None}
IRRIGATION_RUNS = {
    "f1": {"reason": None, "start_time": None, "start_moisture": None},
    "f2": {"reason": None, "start_time": None, "start_moisture": None},
    "f3": {"reason": None, "start_time": None, "start_moisture": None},
}
FIELD_KEYS = ("f1", "f2", "f3")
LAST_SAVED_STATE = None
LAST_STATUS_SYNC_AT = 0.0
STATUS_SYNC_IN_PROGRESS = False
LAST_SUCCESSFUL_STATUS_PATH = "/status"


def deep_merge(base, patch):
    result = deepcopy(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def load_state():
    if not os.path.exists(STATE_FILE):
        return deepcopy(DEFAULT_STATE)

    try:
        with open(STATE_FILE, "r", encoding="utf-8") as file:
            saved = json.load(file)
        merged = deep_merge(DEFAULT_STATE, saved)
        merged.pop("lastUpdated", None)
        return merged
    except (OSError, json.JSONDecodeError):
        return deepcopy(DEFAULT_STATE)


CURRENT = load_state()





def bool_from_value(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "on", "yes", "running"}
    return False


def number_from_value(value, fallback):
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def moisture_to_water_level(moisture):
    normalized_moisture = max(0.0, min(100.0, number_from_value(moisture, 0.0)))
    return round((normalized_moisture / 100.0) * 30.0, 1)


def water_level_to_moisture(water_level):
    normalized_water_level = max(0.0, min(30.0, number_from_value(water_level, 0.0)))
    return round((normalized_water_level / 30.0) * 100.0, 1)


def moisture_to_ph(moisture):
    normalized_moisture = max(0.0, min(100.0, number_from_value(moisture, 0.0)))
    return round(max(0.0, min(14.0, 1.0 + (normalized_moisture / 10.0))), 2)


def ph_to_moisture(ph):
    normalized_ph = max(0.0, min(14.0, number_from_value(ph, IRRIGATION_PH_TARGET)))
    return round(max(0.0, min(100.0, (normalized_ph - 1.0) * 10.0)), 1)


def get_ph_chemical_state(ph):
    normalized_ph = number_from_value(ph, IRRIGATION_PH_TARGET)
    return {
        "acid": normalized_ph < IRRIGATION_PH_TARGET,
        "base": normalized_ph > IRRIGATION_PH_TARGET,
    }


def is_ph_balanced(ph):
    normalized_ph = number_from_value(ph, IRRIGATION_PH_TARGET)
    return abs(normalized_ph - IRRIGATION_PH_TARGET) <= IRRIGATION_PH_TOLERANCE


def is_ph_out_of_range(ph):
    normalized_ph = number_from_value(ph, IRRIGATION_PH_TARGET)
    return normalized_ph < IRRIGATION_LOW_PH_THRESHOLD or normalized_ph > IRRIGATION_HIGH_PH_THRESHOLD


def resolve_auto_irrigation(field_key, field, currently_irrigating=False):
    moisture = number_from_value(field.get("moisture"), IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD)
    ph = number_from_value(field.get("ph"), IRRIGATION_PH_TARGET)

    if moisture >= IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD:
        return False, None

    has_unsafe_ph_override_at_high_moisture = (
        field_key in {"f1", "f2"}
        and moisture >= IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD
        and (ph < 4.0 or ph > 10.0)
    )

    if has_unsafe_ph_override_at_high_moisture:
        return True, "ph"
    if moisture < IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD:
        return True, "moisture"
    return bool_from_value(currently_irrigating), "moisture" if bool_from_value(currently_irrigating) else None


def should_main_tank_pump(tank, was_pumping=False):
    normalized_tank = number_from_value(tank, 0.0)
    if normalized_tank >= MAIN_TANK_STOP_PERCENT:
        return False
    if bool_from_value(was_pumping):
        return True
    return normalized_tank <= MAIN_TANK_REFILL_START_PERCENT


def resolve_main_tank_pumping(state):
    state_values = state.get("state", {}) if isinstance(state, dict) else {}
    tank = number_from_value(state_values.get("tank"), 0.0)

    # The automatic tank limits always win: at or below 20% the pump must run,
    # and at 100% it must stop. Manual override only applies between them.
    if tank <= MAIN_TANK_REFILL_START_PERCENT:
        return True
    if tank >= MAIN_TANK_STOP_PERCENT:
        return False

    manual_override = state_values.get("mainTankManualOverride")
    if isinstance(manual_override, bool):
        return manual_override
    return should_main_tank_pump(
        tank,
        state_values.get("pumping"),
    )


def should_auto_irrigate(field_key, field):
    should_irrigate, _ = resolve_auto_irrigation(field_key, field, currently_irrigating=bool_from_value(field.get("irrigation")))
    return should_irrigate


def can_start_irrigation(field_key, field):
    should_irrigate, _ = resolve_auto_irrigation(field_key, field, currently_irrigating=False)
    return should_irrigate


def get_irrigation_reason(field_key, field):
    _, reason = resolve_auto_irrigation(field_key, field, currently_irrigating=bool_from_value(field.get("irrigation")))
    return reason


def set_irrigation_run(field_key, reason, field, now=None):
    if now is None:
        now = time.time()

    run = IRRIGATION_RUNS[field_key]
    run["reason"] = reason

    if reason == "moisture":
        start_moisture = min(
            number_from_value(field.get("moisture"), IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD),
            IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD,
        )
        run["start_time"] = now
        run["start_moisture"] = start_moisture
        IRRIGATION_END_TIMES[field_key] = now + MOISTURE_AUTO_IRRIGATION_DURATION_SECONDS
    else:
        run["start_time"] = None
        run["start_moisture"] = None
        IRRIGATION_END_TIMES[field_key] = None


def clear_irrigation_run(field_key):
    IRRIGATION_RUNS[field_key]["reason"] = None
    IRRIGATION_RUNS[field_key]["start_time"] = None
    IRRIGATION_RUNS[field_key]["start_moisture"] = None
    IRRIGATION_END_TIMES[field_key] = None


def apply_greenhouse_rules(state):
    greenhouse = state.get("state", {}).get("gh")
    if not isinstance(greenhouse, dict):
        return state

    temp = number_from_value(greenhouse.get("temp"), GREENHOUSE_FAN_TEMP_THRESHOLD)
    humidity = number_from_value(greenhouse.get("humidity"), GREENHOUSE_FAN_HUMIDITY_THRESHOLD)
    greenhouse["fanOn"] = (
        temp > GREENHOUSE_FAN_TEMP_THRESHOLD
        and humidity > GREENHOUSE_FAN_HUMIDITY_THRESHOLD
    )
    return state


def initialize_irrigation_runtime(state):
    for field_key in FIELD_KEYS:
        field = state.get("state", {}).get(field_key)
        if not isinstance(field, dict):
            continue

        LOW_MOISTURE_LATCHES[field_key] = False
        PH_CONTROL_LATCHES[field_key] = False
        MANUAL_IRRIGATION_OVERRIDES[field_key] = None
        field.update(get_ph_chemical_state(field.get("ph")))
        field["irrigation"] = can_start_irrigation(field_key, field)

        if field["irrigation"]:
            set_irrigation_run(field_key, "moisture", field)
        else:
            clear_irrigation_run(field_key)

    state["state"]["pumping"] = resolve_main_tank_pumping(state)
    return state


CURRENT = initialize_irrigation_runtime(CURRENT)
CURRENT = apply_greenhouse_rules(CURRENT)


def serialize_state():
    CURRENT.pop("lastUpdated", None)
    return json.dumps(CURRENT, ensure_ascii=False, separators=(",", ":"))


def save_state(force=False):
    global LAST_SAVED_STATE

    serialized_state = serialize_state()
    if not force and serialized_state == LAST_SAVED_STATE and os.path.exists(STATE_FILE):
        return False

    with open(STATE_FILE_TMP, "w", encoding="utf-8") as file:
        file.write(serialized_state)
    os.replace(STATE_FILE_TMP, STATE_FILE)
    LAST_SAVED_STATE = serialized_state
    return True


def reset_state_for_shutdown():
    with STATE_LOCK:
        state = CURRENT.get("state", {})
        state["tank"] = 0.0
        state["pumping"] = False
        state["mainTankManualOverride"] = False
        state["flowRate"] = 0.0

        for field_key in FIELD_KEYS:
            field = state.get(field_key)
            if not isinstance(field, dict):
                continue

            for numeric_key in ("moisture", "ph", "wl", "n", "p", "k"):
                field[numeric_key] = 0.0

            # Force irrigation-related outputs safe on shutdown without
            # touching unrelated greenhouse/light state.
            for bool_key in ("irrigation", "drain", "acid", "base"):
                field[bool_key] = False

            LOW_MOISTURE_LATCHES[field_key] = False
            PH_CONTROL_LATCHES[field_key] = False
            # Hold irrigation OFF while shutdown is in progress so auto-rules
            # cannot turn it back on from low-moisture values.
            MANUAL_IRRIGATION_OVERRIDES[field_key] = False
            clear_irrigation_run(field_key)

        CURRENT["connected"] = False
        CURRENT["lastError"] = "Server stopped manually"
        save_state()


def normalize_ip(ip_value):
    ip_value = (ip_value or "").strip()
    if ip_value.startswith("http://"):
        ip_value = ip_value[7:]
    elif ip_value.startswith("https://"):
        ip_value = ip_value[8:]
    return ip_value.rstrip("/")


def get_target_ip(override_ip=None):
    normalized_override = normalize_ip(override_ip)
    if normalized_override:
        return normalized_override

    saved_ip = normalize_ip(CURRENT.get("deviceIp"))
    if saved_ip:
        return saved_ip

    return DEFAULT_DEVICE_IP


def http_json(url, method="GET", body=None, timeout=REQUEST_TIMEOUT):
    payload = None
    headers = {}
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = Request(url, data=payload, method=method, headers=headers)
    with urlopen(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8", errors="replace")
        content_type = response.headers.get("Content-Type", "")
        if "application/json" in content_type:
            return json.loads(raw)

        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"raw": raw}


def http_text(url, timeout=REQUEST_TIMEOUT):
    request = Request(url, method="GET")
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")





def apply_status_payload(payload):
    patch = {}

    if not isinstance(payload, dict):
        return patch

    state_patch = {}
    gh_patch = {}

    if "tank" in payload:
        state_patch["tank"] = number_from_value(payload["tank"], CURRENT["state"]["tank"])
    if "flowRate" in payload:
        state_patch["flowRate"] = number_from_value(payload["flowRate"], CURRENT["state"]["flowRate"])
    elif "flow_rate" in payload:
        state_patch["flowRate"] = number_from_value(payload["flow_rate"], CURRENT["state"]["flowRate"])

    if "pumping" in payload:
        state_patch["pumping"] = bool_from_value(payload["pumping"])
    elif "pump" in payload:
        state_patch["pumping"] = bool_from_value(payload["pump"])

    if isinstance(payload.get("gh"), dict):
        if "temp" in payload["gh"]:
            gh_patch["temp"] = number_from_value(payload["gh"]["temp"], CURRENT["state"]["gh"]["temp"])
        if "humidity" in payload["gh"]:
            gh_patch["humidity"] = number_from_value(payload["gh"]["humidity"], CURRENT["state"]["gh"]["humidity"])
        if "fireAlert" in payload["gh"]:
            gh_patch["fireAlert"] = bool_from_value(payload["gh"]["fireAlert"])

    if "temperature" in payload:
        gh_patch["temp"] = number_from_value(payload["temperature"], CURRENT["state"]["gh"]["temp"])
    if "humidity" in payload:
        gh_patch["humidity"] = number_from_value(payload["humidity"], CURRENT["state"]["gh"]["humidity"])
    if "fire" in payload:
        gh_patch["fireAlert"] = bool_from_value(payload["fire"])
    elif "fireAlert" in payload:
        gh_patch["fireAlert"] = bool_from_value(payload["fireAlert"])

    if gh_patch:
        state_patch["gh"] = gh_patch

    for field_key in FIELD_KEYS:
        incoming = payload.get(field_key)
        if not isinstance(incoming, dict):
            continue

        field_patch = {}
        for key in ("moisture", "ph", "wl", "n", "p", "k"):
            if key in incoming:
                field_patch[key] = number_from_value(incoming[key], CURRENT["state"][field_key][key])
        for key in ("irrigation", "drain", "acid", "base"):
            if key in incoming:
                field_patch[key] = bool_from_value(incoming[key])
        if field_patch:
            state_patch[field_key] = field_patch

    if state_patch:
        patch["state"] = state_patch
    return patch


def fetch_device_status(ip_address):
    global LAST_SUCCESSFUL_STATUS_PATH

    errors = []
    status_paths = [LAST_SUCCESSFUL_STATUS_PATH]
    for fallback_path in ("/status", "/data", "/"):
        if fallback_path not in status_paths:
            status_paths.append(fallback_path)

    for path in status_paths:
        try:
            payload = http_json(
                f"http://{ip_address}{path}",
                timeout=STATUS_REQUEST_TIMEOUT,
            )
            patch = apply_status_payload(payload)
            if patch:
                LAST_SUCCESSFUL_STATUS_PATH = path
                return patch
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
            errors.append(f"{path}: {error}")
        except Exception as error:
            errors.append(f"{path}: {error}")

    raise RuntimeError("; ".join(errors) if errors else "Unable to read ESP32 status")


def refresh_device_status_now(ip_address):
    patch = fetch_device_status(ip_address)
    update_current(patch, connected=True, last_error="")


def schedule_status_refresh(ip_address, force=False):
    global LAST_STATUS_SYNC_AT, STATUS_SYNC_IN_PROGRESS

    if not ip_address:
        return False

    now = time.time()
    with STATE_LOCK:
        if STATUS_SYNC_IN_PROGRESS:
            return False
        if not force and now - LAST_STATUS_SYNC_AT < STATUS_CACHE_TTL_SECONDS:
            return False

        STATUS_SYNC_IN_PROGRESS = True
        LAST_STATUS_SYNC_AT = now

    def worker():
        global STATUS_SYNC_IN_PROGRESS
        try:
            refresh_device_status_now(ip_address)
        except Exception as error:
            update_current({}, connected=False, last_error=str(error))
        finally:
            with STATE_LOCK:
                STATUS_SYNC_IN_PROGRESS = False

    threading.Thread(target=worker, daemon=True).start()
    return True


def set_pump_state(ip_address, pump_on, field_key="f1"):
    pump_value = "on" if pump_on else "off"
    query = urlencode({"pump": pump_value, "field": field_key})
    url = f"http://{ip_address}/set?{query}"

    try:
        response = http_json(url)
    except json.JSONDecodeError:
        response = {"raw": http_text(url)}

    with STATE_LOCK:
        CURRENT["state"]["pumping"] = pump_on
        CURRENT["state"][field_key]["irrigation"] = pump_on
        CURRENT["connected"] = True
        CURRENT["lastError"] = ""
        if pump_on:
            set_irrigation_run(field_key, "manual", CURRENT["state"][field_key])
        else:
            clear_irrigation_run(field_key)
        save_state()

    return {"requestedPumpState": pump_value, "deviceResponse": response}


def normalize_field_body(field_key, body):
    if not isinstance(body, dict):
        raise ValueError("Invalid JSON body")

    incoming = body.get("values") if isinstance(body.get("values"), dict) else body
    current_field = CURRENT["state"][field_key]

    field_patch = {}
    device_payload = {"field": field_key}
    metadata = {"manual_irrigation_control": False}
    moisture_updated = False
    water_level_updated = False

    for source_key, target_key in (
        ("moisture", "moisture"),
        ("ph", "ph"),
        ("waterLevel", "wl"),
        ("wl", "wl"),
        ("n", "n"),
        ("p", "p"),
        ("k", "k"),
    ):
        if source_key not in incoming:
            continue
        value = number_from_value(incoming[source_key], current_field[target_key])
        field_patch[target_key] = value
        device_payload[target_key] = value
        if target_key == "moisture":
            moisture_updated = True
        if target_key == "wl":
            water_level_updated = True

    if moisture_updated and not water_level_updated:
        linked_water_level = moisture_to_water_level(field_patch["moisture"])
        field_patch["wl"] = linked_water_level
        device_payload["wl"] = linked_water_level
    elif water_level_updated and not moisture_updated:
        linked_moisture = water_level_to_moisture(field_patch["wl"])
        field_patch["moisture"] = linked_moisture
        device_payload["moisture"] = linked_moisture
    manual_irrigation_control = bool_from_value(incoming.get("manualIrrigationControl"))
    sensor_update_present = bool(field_patch)

    incoming_status = str(incoming.get("status", "")).strip().lower()
    if incoming_status in {"drain", "irrigation"}:
        field_patch["drain"] = incoming_status == "drain"
        device_payload["status"] = incoming_status

    for key in ("irrigation", "drain", "acid", "base"):
        if key not in incoming:
            continue
        if key == "irrigation" and sensor_update_present and not manual_irrigation_control:
            continue
        value = bool_from_value(incoming[key])
        field_patch[key] = value
        device_payload[key] = value
        if key == "irrigation" and manual_irrigation_control:
            metadata["manual_irrigation_control"] = True

    if "drain" in field_patch:
        device_payload["status"] = "drain" if field_patch["drain"] else "irrigation"

    return field_patch, device_payload, metadata


def print_field_update(field_key):
    field = CURRENT["state"][field_key]
    print(f"\n[{field_key.upper()}] Updated values from UI")
    print(f"  moisture: {field['moisture']}")
    print(f"  ph: {field['ph']}")
    print(f"  water level: {field['wl']}")
    print(f"  n: {field['n']}")
    print(f"  p: {field['p']}")
    print(f"  k: {field['k']}")
    print(f"  irrigation: {field['irrigation']}")
    print(f"  drain: {field['drain']}")
    print(f"  acid: {field['acid']}")
    print(f"  base: {field['base']}")


def update_current(patch, connected=None, last_error=None, field_metadata=None):
    with STATE_LOCK:
        now = time.time()
        merged = apply_greenhouse_rules(deep_merge(CURRENT, patch))
        state_patch = patch.get("state", {}) if isinstance(patch.get("state"), dict) else {}
        greenhouse_patch = state_patch.get("gh", {}) if isinstance(state_patch.get("gh"), dict) else {}

        if "fanOn" in greenhouse_patch:
            merged["state"]["gh"]["fanOn"] = bool_from_value(greenhouse_patch.get("fanOn"))

        for field_key in FIELD_KEYS:
            field = merged["state"][field_key]
            field_patch = state_patch.get(field_key, {}) if isinstance(state_patch.get(field_key), dict) else {}
            metadata = (field_metadata or {}).get(field_key, {})
            sensor_update_present = any(key in field_patch for key in ("moisture", "wl", "ph", "n", "p", "k"))
            full_moisture_cutoff = number_from_value(field.get("moisture"), 0.0) >= IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD

            if full_moisture_cutoff:
                MANUAL_IRRIGATION_OVERRIDES[field_key] = False
                LOW_MOISTURE_LATCHES[field_key] = False
                PH_CONTROL_LATCHES[field_key] = False
                field["irrigation"] = False
                field.update(get_ph_chemical_state(field.get("ph")))
                clear_irrigation_run(field_key)
                continue

            if "moisture" in field_patch or "wl" in field_patch:
                MANUAL_IRRIGATION_OVERRIDES[field_key] = None

            if metadata.get("manual_irrigation_control") and "irrigation" in field_patch:
                requested_manual_irrigation = bool_from_value(field_patch.get("irrigation"))
                if requested_manual_irrigation:
                    MANUAL_IRRIGATION_OVERRIDES[field_key] = True if can_start_irrigation(field_key, field) else None
                    if MANUAL_IRRIGATION_OVERRIDES[field_key] is None:
                        field["irrigation"] = False
                else:
                    MANUAL_IRRIGATION_OVERRIDES[field_key] = False

            desired_auto_reason = get_irrigation_reason(field_key, field)
            manual_override = MANUAL_IRRIGATION_OVERRIDES[field_key]
            manual_requested = bool_from_value(field.get("irrigation")) and desired_auto_reason is None

            if isinstance(manual_override, bool):
                field["irrigation"] = manual_override
            elif sensor_update_present:
                field["irrigation"] = bool(desired_auto_reason)
            else:
                field["irrigation"] = bool(desired_auto_reason) or manual_requested

            LOW_MOISTURE_LATCHES[field_key] = desired_auto_reason == "moisture"
            PH_CONTROL_LATCHES[field_key] = desired_auto_reason == "ph"
            field.update(get_ph_chemical_state(field.get("ph")))

            if field["irrigation"]:
                set_irrigation_run(field_key, desired_auto_reason or "manual", field, now=now)
            else:
                clear_irrigation_run(field_key)

        if "mainTankManualOverride" in state_patch:
            manual_override = state_patch.get("mainTankManualOverride")
            if isinstance(manual_override, bool):
                merged["state"]["mainTankManualOverride"] = manual_override
            elif manual_override is None:
                merged["state"]["mainTankManualOverride"] = None
            else:
                merged["state"]["mainTankManualOverride"] = bool_from_value(manual_override)

        merged["state"]["pumping"] = resolve_main_tank_pumping(merged)
        CURRENT.clear()
        CURRENT.update(merged)
        if connected is not None:
            CURRENT["connected"] = connected
        if last_error is not None:
            CURRENT["lastError"] = last_error
        save_state()

def simulation_loop():
    while True:
        time.sleep(SIMULATION_TICK_SECONDS)
        with STATE_LOCK:
            dirty = False
            now = time.time()
            greenhouse = CURRENT.get("state", {}).get("gh")
            if isinstance(greenhouse, dict):
                apply_greenhouse_rules(CURRENT)
                if bool_from_value(greenhouse.get("fanOn")):
                    current_temp = number_from_value(greenhouse.get("temp"), GREENHOUSE_TEMP_MIN)
                    next_temp = round(max(GREENHOUSE_TEMP_MIN, current_temp - GREENHOUSE_TEMP_OFF_STEP_PER_TICK), 1)
                    if next_temp != current_temp:
                        greenhouse["temp"] = next_temp
                        dirty = True
                apply_greenhouse_rules(CURRENT)

            for field_key in FIELD_KEYS:
                field = CURRENT.get("state", {}).get(field_key)
                if not field:
                    continue

                if field.get("irrigation"):
                    if field.get("moisture", 0) < IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD:
                        field["moisture"] = round(min(100.0, field.get("moisture", 0) + 1.0), 1)
                        dirty = True
                    else:
                        field["irrigation"] = False
                        MANUAL_IRRIGATION_OVERRIDES[field_key] = False
                        clear_irrigation_run(field_key)
                        dirty = True

                else:
                    if field.get("moisture", 0) > 0.0:
                        field["moisture"] = round(max(0.0, field.get("moisture", 0) - 0.2), 1)
                        dirty = True

                linked_water_level = moisture_to_water_level(field.get("moisture", 0.0))
                if field.get("wl") != linked_water_level:
                    field["wl"] = linked_water_level
                    dirty = True

                if field.get("moisture", 0.0) >= IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD:
                    if field.get("irrigation"):
                        field["irrigation"] = False
                        MANUAL_IRRIGATION_OVERRIDES[field_key] = False
                        dirty = True
                    clear_irrigation_run(field_key)
                    LOW_MOISTURE_LATCHES[field_key] = False
                    PH_CONTROL_LATCHES[field_key] = False
                    field.update(get_ph_chemical_state(field.get("ph")))
                    continue

                desired_auto_reason = get_irrigation_reason(field_key, field)
                manual_override = MANUAL_IRRIGATION_OVERRIDES[field_key]
                manual_requested = IRRIGATION_RUNS[field_key]["reason"] == "manual" and bool_from_value(field.get("irrigation"))
                should_irrigate = manual_override if isinstance(manual_override, bool) else (bool(desired_auto_reason) or manual_requested)

                if bool_from_value(field.get("irrigation")) != should_irrigate:
                    field["irrigation"] = should_irrigate
                    dirty = True

                LOW_MOISTURE_LATCHES[field_key] = desired_auto_reason == "moisture"
                PH_CONTROL_LATCHES[field_key] = desired_auto_reason == "ph"
                field.update(get_ph_chemical_state(field.get("ph")))

                if should_irrigate:
                    set_irrigation_run(field_key, desired_auto_reason or "manual", field, now=now)
                else:
                    clear_irrigation_run(field_key)

            if dirty:
                apply_greenhouse_rules(CURRENT)
                CURRENT["state"]["pumping"] = resolve_main_tank_pumping(CURRENT)
                save_state()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            return

    def read_body(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8", errors="replace")
        return json.loads(raw) if raw else {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/status":
            with STATE_LOCK:
                ip_address = CURRENT["deviceIp"]
                snapshot = deepcopy(CURRENT)

            if ip_address:
                schedule_status_refresh(ip_address)

            self.send_json(snapshot)
            return

        if parsed.path == "/api/health":
            self.send_json({"ok": True})
            return

        self.send_json({"error": "Not found"}, status=404)

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/config":
            try:
                body = self.read_body()
            except json.JSONDecodeError:
                self.send_json({"error": "Invalid JSON body"}, status=400)
                return

            ip_address = normalize_ip(body.get("ip"))
            update_current({"deviceIp": ip_address}, connected=False, last_error="Connecting..." if ip_address else "ESP32 IP not configured")
            self.send_json(CURRENT)
            return

        if parsed.path == "/api/irrigation/toggle":
            try:
                body = self.read_body()
            except json.JSONDecodeError:
                self.send_json({"error": "Invalid JSON body"}, status=400)
                return

            field_key = body.get("field", "f1")
            if field_key not in {"f1", "f2", "f3"}:
                self.send_json({"error": "Invalid field"}, status=400)
                return

            with STATE_LOCK:
                ip_address = CURRENT["deviceIp"]
                current_value = CURRENT["state"][field_key]["irrigation"]

            if not ip_address:
                self.send_json({"error": "Set the ESP32 IP first"}, status=400)
                return

            try:
                result = set_pump_state(ip_address, not current_value, field_key=field_key)
                try:
                    patch = fetch_device_status(ip_address)
                    update_current(patch, connected=True, last_error="")
                except Exception:
                    update_current({}, connected=True, last_error="")
                self.send_json({"ok": True, "result": result, "dashboard": CURRENT})
            except Exception as error:
                update_current({}, connected=False, last_error=str(error))
                self.send_json({"error": str(error), "dashboard": CURRENT}, status=502)
            return

        if parsed.path.startswith("/api/fields/"):
            field_key = parsed.path.rsplit("/", 1)[-1]
            if field_key not in {"f1", "f2", "f3"}:
                self.send_json({"error": "Invalid field"}, status=400)
                return

            try:
                body = self.read_body()
            except json.JSONDecodeError:
                self.send_json({"error": "Invalid JSON body"}, status=400)
                return

            try:
                field_patch, device_payload, metadata = normalize_field_body(field_key, body)
            except ValueError as error:
                self.send_json({"error": str(error)}, status=400)
                return

            update_current(
                {"state": {field_key: field_patch}},
                connected=False,
                last_error="",
                field_metadata={field_key: metadata},
            )
            print_field_update(field_key)
            self.send_json({"ok": True, "field": field_key, "saved": True, "dashboard": CURRENT})
            return

        self.send_json({"error": "Not found"}, status=404)


if __name__ == "__main__":
    print(f"ESP32 bridge running on http://127.0.0.1:{PORT}")
    print("Open your React dashboard, enter the ESP32 IP, then use the irrigation button.")
    threading.Thread(target=simulation_loop, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nManual shutdown detected. Resetting backend state to zero and switching irrigation off.")
        reset_state_for_shutdown()
        server.server_close()
