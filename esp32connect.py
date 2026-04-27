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
IRRIGATION_AUTO_DRAIN_TO_MOISTURE = 25.0
STATUS_REQUEST_TIMEOUT = 1.5
STATUS_CACHE_TTL_SECONDS = 0.4
STATE_FILE = os.path.join(os.path.dirname(__file__), "esp32_state.json")
STATE_FILE_TMP = f"{STATE_FILE}.tmp"
DEFAULT_DEVICE_IP = "192.168.0.20"
IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD = 30.0
IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD = 60.0
IRRIGATION_PH_TARGET = 7.0
FIELD_KEYS_WITH_PH_CONDITION = {"f1", "f2"}
IRRIGATION_PH_TOLERANCE = 0.05
IRRIGATION_LOW_PH_THRESHOLD = 4.0
IRRIGATION_HIGH_PH_THRESHOLD = 10.0
IRRIGATION_PH_STEP_PER_TICK = 0.1
MAIN_TANK_STOP_PERCENT = 100.0
WL_PH_FIX_DRAIN_TARGET = 12.0    # water level (cm) to drain to in pH-fix mode (40% of 30cm)
WL_PH_FIX_IRRIGATE_UNTIL = 18.0  # water level (cm) to irrigate to after pH reset (60% of 30cm)
MAIN_TANK_REFILL_START_PERCENT = 20.0
GREENHOUSE_FAN_TEMP_THRESHOLD = 25.0
GREENHOUSE_TEMP_MIN = 20.0
GREENHOUSE_TEMP_OFF_STEP_PER_TICK = 0.5
AUTOMATION_GREENHOUSE_ALERT_INTERVAL_SECONDS = 120.0
AUTOMATION_GREENHOUSE_ALERT_DURATION_SECONDS = 15.0
SIMULATION_TICK_SECONDS = 1.2
MOISTURE_AUTO_IRRIGATION_DURATION_SECONDS = 120.0
AUTOMATION_STARTUP_RESET_SECONDS = 5.0
AUTOMATION_CYCLE_MOISTURE_RISE_PER_TICK = 0.6
AUTOMATION_CYCLE_MOISTURE_DRAIN_PER_TICK = 1.0
PH_RECOVERY_IRRIGATION_DELAY_SECONDS = 2.0

DEFAULT_STATE = {
    "deviceIp": "",
    "connected": False,
    "automationEnabled": False,
    "lastError": "ESP32 IP not configured",
    "state": {
        "tank": 0.0,
        "tankSensor": {
            "value": 0.0,
            "online": False,
            "lastUpdatedAt": None,
            "error": "Main tank sensor not initialized",
        },
        "pumping": True,
        "mainTankManualOverride": None,
        "flowRate": 0.0,
        "gh": {
            "temp": 25.0,
            "humidity": 35.0,
            "fireAlert": False,
            "fireSensor": {
                "detected": False,
                "online": False,
                "lastUpdatedAt": None,
                "raw": "",
                "error": "Farmhouse fire sensor not initialized",
            },
            "automationFirePulseActive": False,
        },
        "f1": {
            "moisture": 0.0,
            "ph": 7.0,
            "wl": 0.0,
            "n": 0.0,
            "p": 0.0,
            "k": 0.0,
            "irrigation": False,
            "drain": False,
            "acid": False,
            "base": False,
        },
        "f2": {
            "moisture": 0.0,
            "ph": 7.0,
            "wl": 0.0,
            "n": 0.0,
            "p": 0.0,
            "k": 0.0,
            "irrigation": False,
            "drain": False,
            "acid": False,
            "base": False,
        },
        "f3": {
            "moisture": 0.0,
            "ph": 7.0,
            "wl": 0.0,
            "n": 0.0,
            "p": 0.0,
            "k": 0.0,
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
PH_RECOVERY_READY_AT = {"f1": None, "f2": None, "f3": None}
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
AUTOMATION_CYCLE_STARTED_AT = None
AUTOMATION_RESET_UNTIL = None


def deep_merge(base, patch):
    result = deepcopy(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def load_state():
    # Always boot with a clean zeroed state instead of restoring prior runtime values.
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
    # 100% moisture = 30cm water level; 0% = 0cm
    normalized_moisture = max(0.0, min(100.0, number_from_value(moisture, 0.0)))
    water_level = (normalized_moisture / 100.0) * 30.0
    return round(water_level, 1)


def water_level_to_moisture(water_level):
    # 30cm water level = 100% moisture; 0cm = 0%
    normalized_water_level = max(0.0, min(30.0, number_from_value(water_level, 0.0)))
    moisture = (normalized_water_level / 30.0) * 100.0
    return round(moisture, 1)


def moisture_to_ph(moisture):
    normalized_moisture = max(0.0, min(100.0, number_from_value(moisture, 0.0)))
    # pH follows moisture from 0..60 -> 0..7 and stays capped at 7 after 60.
    return round(min(7.0, (normalized_moisture / 60.0) * 7.0), 2)


def ph_to_moisture(ph):
    normalized_ph = max(0.0, min(7.0, number_from_value(ph, IRRIGATION_PH_TARGET)))
    return round((normalized_ph / 7.0) * 60.0, 1)


def field_supports_ph_condition(field_key):
    return field_key in FIELD_KEYS_WITH_PH_CONDITION


def apply_field_ph_condition(field_key, field):
    if field_supports_ph_condition(field_key):
        field.update(get_ph_chemical_state(field.get("ph")))
    return field


def normalize_linked_field_values(field_patch, preferred_source=None, field_key=None):
    normalized_patch = dict(field_patch or {})
    
    # Normalize moisture to 0-100 range
    if "moisture" in normalized_patch:
        normalized_patch["moisture"] = round(max(0.0, min(100.0, number_from_value(normalized_patch["moisture"], 0.0))), 1)
    
    # Normalize water level to 0-30cm range
    if "wl" in normalized_patch:
        normalized_patch["wl"] = round(max(0.0, min(30.0, number_from_value(normalized_patch["wl"], 0.0))), 1)
    
    # Sync moisture to water level (100% moisture = 30cm, 0% = 0cm)
    if preferred_source == "moisture" and "moisture" in normalized_patch:
        normalized_patch["wl"] = moisture_to_water_level(normalized_patch["moisture"])
    # Sync water level to moisture (30cm = 100%, 0cm = 0%)
    elif preferred_source == "wl" and "wl" in normalized_patch:
        normalized_patch["moisture"] = water_level_to_moisture(normalized_patch["wl"])
    # If both present and no preference, ensure they're synchronized (moisture takes priority)
    elif "moisture" in normalized_patch and "wl" in normalized_patch:
        normalized_patch["wl"] = moisture_to_water_level(normalized_patch["moisture"])
    
    # Normalize pH to 0-14 range
    if "ph" in normalized_patch:
        normalized_patch["ph"] = round(max(0.0, min(14.0, number_from_value(normalized_patch["ph"], IRRIGATION_PH_TARGET))), 2)

    # Apply pH-based chemical state (acid/base indicators) for fields f1 and f2 only
    if "ph" in normalized_patch:
        apply_field_ph_condition(field_key, normalized_patch)

    return normalized_patch


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


def is_irrigation_blocked_by_ph(field_key, field):
    if field_key not in FIELD_KEYS_WITH_PH_CONDITION:
        return False
    return is_ph_out_of_range(field.get("ph"))


def should_field_drain(field):
    moisture = number_from_value(field.get("moisture"), 0.0)
    ph = number_from_value(field.get("ph"), IRRIGATION_PH_TARGET)
    return moisture > 40.0 and (ph < 4.0 or ph > 10.0)


def has_reached_drain_cutoff(field):
    water_level = number_from_value(field.get("wl"), 0.0)
    return water_level <= WL_PH_FIX_DRAIN_TARGET


def is_post_drain_recovery_state(field_key, field):
    if field_key not in {"f1", "f2"}:
        return False
    moisture = number_from_value(field.get("moisture"), 0.0)
    water_level = number_from_value(field.get("wl"), 0.0)
    ph = number_from_value(field.get("ph"), IRRIGATION_PH_TARGET)
    ph_in_range = IRRIGATION_LOW_PH_THRESHOLD <= ph <= IRRIGATION_HIGH_PH_THRESHOLD
    return (
        ph_in_range
        and water_level <= WL_PH_FIX_DRAIN_TARGET
        and 40.0 <= moisture < IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD
    )


def move_ph_toward_target(ph, target=IRRIGATION_PH_TARGET):
    normalized_ph = number_from_value(ph, target)
    if normalized_ph < target:
        return round(min(target, normalized_ph + IRRIGATION_PH_STEP_PER_TICK), 2)
    if normalized_ph > target:
        return round(max(target, normalized_ph - IRRIGATION_PH_STEP_PER_TICK), 2)
    return round(target, 2)


def resolve_auto_irrigation(field_key, field, currently_irrigating=False):
    moisture = number_from_value(field.get("moisture"), IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD)
    ph = number_from_value(field.get("ph"), IRRIGATION_PH_TARGET)
    ph_in_range = IRRIGATION_LOW_PH_THRESHOLD <= ph <= IRRIGATION_HIGH_PH_THRESHOLD

    # Always OFF when moisture > 60%
    if moisture >= IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD:
        return False, None

    # pH condition only applies to f1 and f2, not f3
    if field_key in FIELD_KEYS_WITH_PH_CONDITION and not ph_in_range:
        return False, None

    # Keep irrigating if already running and moisture hasn't reached OFF threshold yet
    if bool_from_value(currently_irrigating) and moisture < IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD:
        return True, "moisture"

    # Start irrigation only when moisture drops below ON threshold (30%)
    if moisture < IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD:
        return True, "moisture"

    return False, None


def should_main_tank_pump(tank, was_pumping=True):
    normalized_tank = number_from_value(tank, 0.0)
    if normalized_tank >= MAIN_TANK_STOP_PERCENT:
        return False
    if bool_from_value(was_pumping):
        return True
    return normalized_tank <= MAIN_TANK_REFILL_START_PERCENT


def resolve_main_tank_pumping(state):
    state_values = state.get("state", {}) if isinstance(state, dict) else {}
    tank = number_from_value(state_values.get("tank"), 0.0)
    manual_override = state_values.get("mainTankManualOverride")

    # Boundary limits always win regardless of user override
    if tank <= MAIN_TANK_REFILL_START_PERCENT:
        return True
    if tank >= MAIN_TANK_STOP_PERCENT:
        return False

    # User manual override takes priority in the middle range
    if isinstance(manual_override, bool):
        return manual_override

    # No override — default to ON (pump active by default)
    return should_main_tank_pump(tank, state_values.get("pumping", True))


def should_auto_irrigate(field_key, field):
    should_irrigate, _ = resolve_auto_irrigation(field_key, field, currently_irrigating=bool_from_value(field.get("irrigation")))
    return should_irrigate


def can_start_irrigation(field_key, field):
    should_irrigate, _ = resolve_auto_irrigation(field_key, field, currently_irrigating=False)
    return should_irrigate


def can_resume_irrigation_until_cutoff(field):
    return number_from_value(field.get("moisture"), 0.0) < IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD


def get_irrigation_reason(field_key, field):
    _, reason = resolve_auto_irrigation(field_key, field, currently_irrigating=bool_from_value(field.get("irrigation")))
    return reason


def is_automation_cycle_running(now=None):
    return not is_automation_reset_active(now)


def is_automation_reset_active(now=None):
    if now is None:
        now = time.time()

    return AUTOMATION_RESET_UNTIL is not None and now < AUTOMATION_RESET_UNTIL


def is_automation_greenhouse_alert_active(now=None):
    if now is None:
        now = time.time()

    if AUTOMATION_CYCLE_STARTED_AT is None or now < AUTOMATION_CYCLE_STARTED_AT:
        return False

    elapsed = now - AUTOMATION_CYCLE_STARTED_AT
    if elapsed < AUTOMATION_GREENHOUSE_ALERT_INTERVAL_SECONDS:
        return False

    cycle_position = elapsed % AUTOMATION_GREENHOUSE_ALERT_INTERVAL_SECONDS
    return cycle_position < AUTOMATION_GREENHOUSE_ALERT_DURATION_SECONDS


def reset_state_for_automation_start(now=None):
    global AUTOMATION_CYCLE_STARTED_AT
    global AUTOMATION_RESET_UNTIL

    if now is None:
        now = time.time()

    state = CURRENT.get("state", {})
    state["tank"] = 0.0
    state["pumping"] = False
    state["mainTankManualOverride"] = False
    state["flowRate"] = 0.0
    greenhouse = state.get("gh")
    if isinstance(greenhouse, dict):
        greenhouse["automationFirePulseActive"] = False

    for field_key in FIELD_KEYS:
        field = state.get(field_key)
        if not isinstance(field, dict):
            continue

        for numeric_key in ("moisture", "wl", "n", "p", "k"):
            field[numeric_key] = 0.0
            
        field["ph"] = IRRIGATION_PH_TARGET

        for bool_key in ("irrigation", "drain", "acid", "base"):
            field[bool_key] = False

        apply_field_ph_condition(field_key, field)

        LOW_MOISTURE_LATCHES[field_key] = False
        PH_CONTROL_LATCHES[field_key] = False
        PH_RECOVERY_READY_AT[field_key] = None
        MANUAL_IRRIGATION_OVERRIDES[field_key] = None
        clear_irrigation_run(field_key)

    AUTOMATION_CYCLE_STARTED_AT = now
    AUTOMATION_RESET_UNTIL = now + AUTOMATION_STARTUP_RESET_SECONDS


def set_automation_enabled(enabled):
    global AUTOMATION_CYCLE_STARTED_AT
    global AUTOMATION_RESET_UNTIL

    enabled = bool_from_value(enabled)
    now = time.time()

    with STATE_LOCK:
        CURRENT["automationEnabled"] = enabled

        if enabled:
            reset_state_for_automation_start(now=now)
        else:
            AUTOMATION_CYCLE_STARTED_AT = None
            AUTOMATION_RESET_UNTIL = None
            CURRENT["state"]["pumping"] = False
            CURRENT["state"]["mainTankManualOverride"] = False
            CURRENT["state"]["flowRate"] = 0.0
            greenhouse = CURRENT.get("state", {}).get("gh")
            if isinstance(greenhouse, dict):
                greenhouse["automationFirePulseActive"] = False
            for field_key in FIELD_KEYS:
                field = CURRENT.get("state", {}).get(field_key)
                if not isinstance(field, dict):
                    continue
                field["irrigation"] = False
                field["drain"] = False
                MANUAL_IRRIGATION_OVERRIDES[field_key] = None
                LOW_MOISTURE_LATCHES[field_key] = False
                PH_CONTROL_LATCHES[field_key] = False
                PH_RECOVERY_READY_AT[field_key] = None
                clear_irrigation_run(field_key)

        save_state()
        return deepcopy(CURRENT)


def resolve_automation_field_mode(field_key, field, now=None, ph_just_reset=False, automation_enabled=False):
    moisture = number_from_value(field.get("moisture"), 0.0)
    water_level = number_from_value(field.get("wl"), 0.0)
    ph = number_from_value(field.get("ph"), IRRIGATION_PH_TARGET)
    was_irrigating = bool_from_value(field.get("irrigation"))
    was_draining = bool_from_value(field.get("drain"))
    ph_in_range = IRRIGATION_LOW_PH_THRESHOLD <= ph <= IRRIGATION_HIGH_PH_THRESHOLD
    ph_out_of_range = ph < IRRIGATION_LOW_PH_THRESHOLD or ph > IRRIGATION_HIGH_PH_THRESHOLD

    # pH-fix mode: moisture > 40% and pH out of range (f1, f2 only)
    if moisture > 40.0 and ph_out_of_range and field_key in {"f1", "f2"}:
        # Phase 1: drain until water level reaches WL_PH_FIX_DRAIN_TARGET (12cm)
        if water_level > WL_PH_FIX_DRAIN_TARGET:
            return "drain"
        # Phase 2: wl at/below 12cm → irrigate until moisture reaches 60%
        if 40.0 <= moisture < IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD:
            return "irrigation"
        return "idle"

    # After pH fix OR pH just reset: Allow irrigation in recovery zone (30-60%)
    # Detect if we're in post-pH-reset state: wl is low (12 or below) and ph is normal
    in_ph_recovery = ph_just_reset or (ph_in_range and water_level <= WL_PH_FIX_DRAIN_TARGET and 40.0 <= moisture < IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD)
    if in_ph_recovery:
        return "irrigation"

    # For f3: No pH condition required
    # For f1, f2: pH must be in range
    if field_key != "f3" and not ph_in_range:
        return "idle"

    # Hysteresis logic to prevent flickering (matches frontend):
    # - Turn OFF only when moisture >= 60%
    # - Turn ON when moisture < 30%
    # - Zone 30-50%: Allow turning ON even if not previously on (after pH reset)
    # - Zone 50-60%: Maintain current state (hysteresis)
    if moisture >= IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD:
        # Only drain back to 35% when automation is actively running
        if automation_enabled:
            return "drain"
        return "idle"

    if moisture < IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD:
        return "irrigation"

    # 35–60% zone: hold current state
    if was_irrigating and moisture < IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD:
        return "irrigation"
    # Only hold drain state during automation (draining back to 35%)
    if automation_enabled and was_draining and moisture > IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD:
        return "drain"

    return "idle"


def set_irrigation_run(field_key, reason, field, now=None):
    if now is None:
        now = time.time()

    run = IRRIGATION_RUNS[field_key]
    previous_reason = run.get("reason")

    if previous_reason != reason:
        run["start_time"] = None
        run["start_moisture"] = None

    run["reason"] = reason

    if reason in {"moisture", "manual"}:
        if run["start_time"] is None or run["start_moisture"] is None:
            start_moisture = min(
                number_from_value(field.get("moisture"), IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD),
                IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD,
            )
            run["start_time"] = now
            run["start_moisture"] = start_moisture
        IRRIGATION_END_TIMES[field_key] = now + MOISTURE_AUTO_IRRIGATION_DURATION_SECONDS if reason == "moisture" else None
    else:
        run["start_time"] = None
        run["start_moisture"] = None
        IRRIGATION_END_TIMES[field_key] = None


def clear_irrigation_run(field_key):
    IRRIGATION_RUNS[field_key]["reason"] = None
    IRRIGATION_RUNS[field_key]["start_time"] = None
    IRRIGATION_RUNS[field_key]["start_moisture"] = None
    IRRIGATION_END_TIMES[field_key] = None


def get_irrigation_moisture_target(field_key, field, now):
    current_moisture = number_from_value(field.get("moisture"), 0.0)
    target_moisture = IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD
    run = IRRIGATION_RUNS[field_key]
    start_time = run.get("start_time")
    start_moisture = run.get("start_moisture")

    if start_time is None or start_moisture is None:
        return round(current_moisture, 1)

    duration = max(0.001, MOISTURE_AUTO_IRRIGATION_DURATION_SECONDS)
    elapsed = max(0.0, now - start_time)
    progress = min(1.0, elapsed / duration)
    planned_moisture = start_moisture + (target_moisture - start_moisture) * progress
    # Never move backward because of timing jitter or stale start values.
    return round(max(current_moisture, min(target_moisture, planned_moisture)), 1)


def apply_greenhouse_rules(state):
    greenhouse = state.get("state", {}).get("gh")
    if not isinstance(greenhouse, dict):
        return state

    temp = number_from_value(greenhouse.get("temp"), GREENHOUSE_FAN_TEMP_THRESHOLD)
    # Fan is controlled by temperature only: ON when temp > 25, otherwise OFF.
    greenhouse["fanOn"] = temp > GREENHOUSE_FAN_TEMP_THRESHOLD
    return state


def initialize_irrigation_runtime(state):
    for field_key in FIELD_KEYS:
        field = state.get("state", {}).get(field_key)
        if not isinstance(field, dict):
            continue

        LOW_MOISTURE_LATCHES[field_key] = False
        PH_CONTROL_LATCHES[field_key] = False
        PH_RECOVERY_READY_AT[field_key] = None
        MANUAL_IRRIGATION_OVERRIDES[field_key] = None
        apply_field_ph_condition(field_key, field)
        automation_mode = resolve_automation_field_mode(field_key, field)
        field["drain"] = automation_mode == "drain"
        field["irrigation"] = automation_mode == "irrigation"

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


save_state(force=True)


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
            PH_RECOVERY_READY_AT[field_key] = None
            # Hold irrigation OFF while shutdown is in progress so auto-rules
            # cannot turn it back on from low-moisture values.
            MANUAL_IRRIGATION_OVERRIDES[field_key] = False
            clear_irrigation_run(field_key)

        CURRENT["connected"] = False
        CURRENT["lastError"] = "Server stopped manually"
        save_state()


def send_pump_off_commands(ip_address):
    """
    Send complete shutdown request to ESP32 using exact device format.
    
    Sends to f1 and f2: /set?level=0&pump=off&moisture=0&ph=7&status=irrigation&yellow=off
    - level=0: Water level to zero
    - pump=off: All pumps OFF
    - moisture=0: Moisture sensor reset
    - ph=7: pH reset to neutral
    - status=irrigation: Normal status (not draining)
    - yellow=off: Turn off yellow indicator light (field 1 and 2 only)
    
    This is called during /api/reset endpoint to ensure complete shutdown
    with both local state reset and device communication.
    """
    try:
        # Send shutdown commands with yellow=off to f1 and f2 only
        for field_key in ("f1", "f2"):
            try:
                # Build complete shutdown request matching ESP32 format:
                # /set?level=0&pump=off&moisture=0&ph=7&status=irrigation&yellow=off
                query = urlencode({
                    "level": "0",
                    "pump": "off",
                    "moisture": "0",
                    "ph": "7",
                    "status": "irrigation",
                    "yellow": "off"
                })
                url = f"http://{ip_address}/set?{query}"
                http_json(url, timeout=REQUEST_TIMEOUT)
            except Exception:
                pass
    except Exception:
        pass


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
        # Hardware temperature & humidity sync removed here
        if "fireAlert" in payload["gh"]:
            gh_patch["fireAlert"] = bool_from_value(payload["gh"]["fireAlert"])

    # Hardware temperature & humidity sync removed here too
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
        if any(key in field_patch for key in ("moisture", "ph", "wl")):
            field_patch = normalize_linked_field_values(field_patch, field_key=field_key)
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
    # device_payload uses exact ESP32 format: level, pump, moisture, ph, status, yellow
    device_payload = {}
    metadata = {"manual_irrigation_control": False}
    moisture_updated = False
    water_level_updated = False
    ph_updated = False

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
        if target_key == "moisture":
            moisture_updated = True
        if target_key == "wl":
            water_level_updated = True
        if target_key == "ph":
            ph_updated = True

    preferred_source = "moisture" if moisture_updated else "wl" if water_level_updated else "ph" if ph_updated else None
    if preferred_source:
        field_patch = normalize_linked_field_values(field_patch, preferred_source=preferred_source, field_key=field_key)
    
    manual_irrigation_control = bool_from_value(incoming.get("manualIrrigationControl"))
    sensor_update_present = bool(field_patch)

    incoming_status = str(incoming.get("status", "")).strip().lower()
    if incoming_status in {"drain", "irrigation"}:
        field_patch["drain"] = incoming_status == "drain"

    for key in ("irrigation", "drain", "acid", "base"):
        if key not in incoming:
            continue
        if key == "irrigation" and sensor_update_present and not manual_irrigation_control:
            continue
        value = bool_from_value(incoming[key])
        field_patch[key] = value
        if key == "irrigation" and manual_irrigation_control:
            metadata["manual_irrigation_control"] = True

    # Build device payload in ESP32 format
    # Format: /set?level=XX&pump=on/off&moisture=XX&ph=X.X&status=irrigation/drain&yellow=on/off
    device_payload["level"] = str(int(field_patch.get("wl", current_field.get("wl", 0))))
    device_payload["pump"] = "on" if field_patch.get("irrigation", current_field.get("irrigation", False)) else "off"
    device_payload["moisture"] = str(int(field_patch.get("moisture", current_field.get("moisture", 0))))
    device_payload["ph"] = str(round(field_patch.get("ph", current_field.get("ph", 7.0)), 1))
    device_payload["status"] = "drain" if field_patch.get("drain", current_field.get("drain", False)) else "irrigation"
    device_payload["yellow"] = "off"  # Normal operation
    
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
        automation_enabled = bool_from_value(merged.get("automationEnabled"))
        automation_reset_active = automation_enabled and is_automation_reset_active(now)

        # Always recompute fanOn from temperature only (temp > 25 → ON, else → OFF)
        # This ensures the fan rule is enforced even if the patch includes a stale fanOn value
        current_temp = number_from_value(merged["state"]["gh"].get("temp"), 0.0)
        merged["state"]["gh"]["fanOn"] = current_temp > GREENHOUSE_FAN_TEMP_THRESHOLD

        for field_key in FIELD_KEYS:
            field = merged["state"][field_key]
            field_patch = state_patch.get(field_key, {}) if isinstance(state_patch.get(field_key), dict) else {}
            metadata = (field_metadata or {}).get(field_key, {})
            sensor_update_present = any(key in field_patch for key in ("moisture", "wl", "ph", "n", "p", "k"))

            if sensor_update_present:
                preferred_source = "moisture" if "moisture" in field_patch else "wl" if "wl" in field_patch else "ph" if "ph" in field_patch else None
                normalized_field_patch = normalize_linked_field_values(field_patch, preferred_source=preferred_source, field_key=field_key)
                if normalized_field_patch != field_patch:
                    field.update(normalized_field_patch)
                    field_patch = normalized_field_patch
                
                # Ensure bidirectional sync: if moisture changed, update WL; if WL changed, update moisture
                if "moisture" in field_patch and "wl" not in field_patch:
                    field["wl"] = moisture_to_water_level(field_patch["moisture"])
                elif "wl" in field_patch and "moisture" not in field_patch:
                    field["moisture"] = water_level_to_moisture(field_patch["wl"])

            full_moisture_cutoff = number_from_value(field.get("moisture"), 0.0) > IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD

            if full_moisture_cutoff and not automation_enabled:
                MANUAL_IRRIGATION_OVERRIDES[field_key] = None
                LOW_MOISTURE_LATCHES[field_key] = False
                PH_CONTROL_LATCHES[field_key] = False
                PH_RECOVERY_READY_AT[field_key] = None
                field["irrigation"] = False
                apply_field_ph_condition(field_key, field)
                clear_irrigation_run(field_key)

            if "moisture" in field_patch or "wl" in field_patch:
                MANUAL_IRRIGATION_OVERRIDES[field_key] = None

            if "moisture" in field_patch:
                clear_irrigation_run(field_key)
                if is_post_drain_recovery_state(field_key, field):
                    current_moisture = number_from_value(field.get("moisture"), 0.0)
                    field["irrigation"] = 40.0 <= current_moisture < IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD
                    field["drain"] = False
                    field["mix"] = False

            if is_irrigation_blocked_by_ph(field_key, field):
                MANUAL_IRRIGATION_OVERRIDES[field_key] = None
                field["irrigation"] = False
                clear_irrigation_run(field_key)

            if metadata.get("manual_irrigation_control") and "irrigation" in field_patch:
                requested_manual_irrigation = bool_from_value(field_patch.get("irrigation"))
                if requested_manual_irrigation:
                    MANUAL_IRRIGATION_OVERRIDES[field_key] = True if can_resume_irrigation_until_cutoff(field) else None
                    if MANUAL_IRRIGATION_OVERRIDES[field_key] is None:
                        field["irrigation"] = False
                else:
                    MANUAL_IRRIGATION_OVERRIDES[field_key] = False

            if automation_enabled:
                if automation_reset_active:
                    desired_auto_reason = None
                    field["irrigation"] = False
                    field["drain"] = False
                    PH_RECOVERY_READY_AT[field_key] = None
                else:
                    automation_mode = resolve_automation_field_mode(field_key, field, now=now,automation_enabled=True)
                    desired_auto_reason = "moisture" if automation_mode == "irrigation" else None
                    field["drain"] = automation_mode == "drain"
                    field["irrigation"] = automation_mode == "irrigation"
            else:
                automation_mode = resolve_automation_field_mode(field_key, field, now=now)
                desired_auto_reason = "moisture" if automation_mode == "irrigation" else None
                manual_override = MANUAL_IRRIGATION_OVERRIDES[field_key]
                manual_requested = bool_from_value(field.get("irrigation")) and desired_auto_reason is None
                field["drain"] = automation_mode == "drain"
                auto_irrigation_requested = automation_mode == "irrigation"
                current_moisture = number_from_value(field.get("moisture"), 0.0)
                ph_out_of_range = is_irrigation_blocked_by_ph(field_key, field)
                keep_running_until_cutoff = (
                    bool_from_value(field.get("irrigation"))
                    and current_moisture < IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD
                )

                if ph_out_of_range:
                    field["irrigation"] = False
                elif isinstance(manual_override, bool):
                    field["irrigation"] = auto_irrigation_requested or manual_override
                elif sensor_update_present:
                    field["irrigation"] = auto_irrigation_requested or keep_running_until_cutoff
                else:
                    field["irrigation"] = auto_irrigation_requested or manual_requested

            LOW_MOISTURE_LATCHES[field_key] = desired_auto_reason == "moisture"
            PH_CONTROL_LATCHES[field_key] = False
            PH_RECOVERY_READY_AT[field_key] = None
            apply_field_ph_condition(field_key, field)

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

        if automation_reset_active:
            merged["state"]["pumping"] = False
            merged["state"]["mainTankManualOverride"] = False
            merged["state"]["flowRate"] = 0.0
        else:
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
            automation_enabled = bool_from_value(CURRENT.get("automationEnabled"))
            dirty = False
            now = time.time()
            automation_reset_active = automation_enabled and is_automation_reset_active(now)
            greenhouse_pulse_active = automation_enabled and is_automation_greenhouse_alert_active(now)
            greenhouse = CURRENT.get("state", {}).get("gh")
            active_irrigation_count = 0
            if isinstance(greenhouse, dict):
                if bool_from_value(greenhouse.get("fanOn")):
                    current_temp = number_from_value(greenhouse.get("temp"), GREENHOUSE_TEMP_MIN)
                    cooled_temp = round(max(GREENHOUSE_TEMP_MIN, current_temp - GREENHOUSE_TEMP_OFF_STEP_PER_TICK), 1)
                    if current_temp > GREENHOUSE_FAN_TEMP_THRESHOLD and cooled_temp < GREENHOUSE_FAN_TEMP_THRESHOLD:
                        cooled_temp = GREENHOUSE_FAN_TEMP_THRESHOLD
                    if cooled_temp != current_temp:
                        greenhouse["temp"] = cooled_temp
                        dirty = True

                previous_fan_on = bool_from_value(greenhouse.get("fanOn"))
                apply_greenhouse_rules(CURRENT)
                if bool_from_value(greenhouse.get("fanOn")) != previous_fan_on:
                    dirty = True

            for field_key in FIELD_KEYS:
                field = CURRENT.get("state", {}).get(field_key)
                if not field:
                    continue

                if automation_reset_active:
                    if bool_from_value(field.get("irrigation")):
                        field["irrigation"] = False
                        dirty = True
                    if bool_from_value(field.get("drain")):
                        field["drain"] = False
                        dirty = True
                    continue

                # Track if pH was just reset in this tick
                ph_was_just_reset = False

                if bool_from_value(field.get("drain")):
                    current_water_level = number_from_value(field.get("wl"), 0.0)
                    current_moisture = number_from_value(field.get("moisture"), 0.0)
                    next_water_level = round(max(0.0, current_water_level - AUTOMATION_CYCLE_MOISTURE_DRAIN_PER_TICK), 1)
                    if next_water_level != current_water_level:
                        field["wl"] = next_water_level
                        field["moisture"] = water_level_to_moisture(next_water_level)
                        dirty = True
                    next_moisture = water_level_to_moisture(field.get("wl", 0.0))
                    if next_moisture != current_moisture:
                        field["moisture"] = next_moisture
                        dirty = True

                    # Automation cycle drain: stop at 35% and flip back to irrigation.
                    # Only runs when automation is ON — manual mode never auto-flips drain.
                    if automation_enabled:
                        ph = number_from_value(field.get("ph"), IRRIGATION_PH_TARGET)
                        is_ph_fix_drain = (
                            (ph < IRRIGATION_LOW_PH_THRESHOLD or ph > IRRIGATION_HIGH_PH_THRESHOLD)
                            and field_key in {"f1", "f2"}
                        )
                        if not is_ph_fix_drain and next_moisture <= IRRIGATION_AUTO_DRAIN_TO_MOISTURE:
                            field["drain"] = False
                            field["irrigation"] = True
                            clear_irrigation_run(field_key)
                            set_irrigation_run(field_key, "moisture", field)
                            dirty = True
                            continue

                    # pH-fix drain: when wl reaches drain target and pH is out of range → reset pH to 7
                    ph = number_from_value(field.get("ph"), IRRIGATION_PH_TARGET)
                    if next_water_level <= WL_PH_FIX_DRAIN_TARGET and (ph < IRRIGATION_LOW_PH_THRESHOLD or ph > IRRIGATION_HIGH_PH_THRESHOLD):
                        field["ph"] = IRRIGATION_PH_TARGET
                        field.update(get_ph_chemical_state(IRRIGATION_PH_TARGET))
                        ph_was_just_reset = True
                        dirty = True
                        field["drain"] = False
                        field["mix"] = False
                        field["irrigation"] = next_moisture < IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD
                        dirty = True

                if is_irrigation_blocked_by_ph(field_key, field):
                    if bool_from_value(field.get("irrigation")):
                        field["irrigation"] = False
                        dirty = True
                    MANUAL_IRRIGATION_OVERRIDES[field_key] = None
                    clear_irrigation_run(field_key)

                if field.get("irrigation"):
                    active_irrigation_count += 1
                    current_moisture = number_from_value(field.get("moisture"), 0.0)
                    current_wl = number_from_value(field.get("wl"), 0.0)
                    if current_moisture < IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD:
                        next_moisture = round(min(IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD, current_moisture + AUTOMATION_CYCLE_MOISTURE_RISE_PER_TICK), 1)
                        if next_moisture != current_moisture:
                            field["moisture"] = next_moisture
                            field["wl"] = moisture_to_water_level(next_moisture)
                            dirty = True
                    else:
                        field["irrigation"] = False
                        MANUAL_IRRIGATION_OVERRIDES[field_key] = None
                        clear_irrigation_run(field_key)
                        dirty = True
                    next_wl = min(30.0, moisture_to_water_level(field.get("moisture", 0.0)))
                    next_wl = round(next_wl, 1)
                    if next_wl != current_wl:
                        field["wl"] = next_wl
                        dirty = True

                nutrient_drain = 0.25 if bool_from_value(field.get("irrigation")) else 0.08
                for nutrient_key in ("n", "p", "k"):
                    current_nutrient = number_from_value(field.get(nutrient_key), 0.0)
                    next_nutrient = round(max(0.0, current_nutrient - nutrient_drain), 1)
                    if next_nutrient != current_nutrient:
                        field[nutrient_key] = next_nutrient
                        dirty = True

                if field.get("moisture", 0.0) > IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD and not automation_enabled:
                    if field.get("irrigation"):
                        field["irrigation"] = False
                        MANUAL_IRRIGATION_OVERRIDES[field_key] = None
                        dirty = True
                    clear_irrigation_run(field_key)
                    LOW_MOISTURE_LATCHES[field_key] = False
                    PH_CONTROL_LATCHES[field_key] = False
                    PH_RECOVERY_READY_AT[field_key] = None
                    apply_field_ph_condition(field_key, field)

                if automation_enabled:
                    automation_mode = resolve_automation_field_mode(field_key, field, now=now, ph_just_reset=ph_was_just_reset, automation_enabled=True)
                    desired_auto_reason = "moisture" if automation_mode == "irrigation" else None
                    if bool_from_value(field.get("drain")) != (automation_mode == "drain"):
                        field["drain"] = automation_mode == "drain"
                        dirty = True
                    should_irrigate = automation_mode == "irrigation"
                else:
                    automation_mode = resolve_automation_field_mode(field_key, field, now=now, ph_just_reset=ph_was_just_reset, automation_enabled=False)
                    desired_auto_reason = "moisture" if automation_mode == "irrigation" else None
                    if bool_from_value(field.get("drain")) != (automation_mode == "drain"):
                        field["drain"] = automation_mode == "drain"
                        dirty = True
                    manual_override = MANUAL_IRRIGATION_OVERRIDES[field_key]
                    manual_requested = IRRIGATION_RUNS[field_key]["reason"] == "manual" and bool_from_value(field.get("irrigation"))
                    auto_irrigation_requested = automation_mode == "irrigation"
                    current_moisture = number_from_value(field.get("moisture"), 0.0)
                    ph_out_of_range = is_irrigation_blocked_by_ph(field_key, field)
                    keep_running_until_cutoff = (
                        bool_from_value(field.get("irrigation"))
                        and current_moisture < IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD
                    )
                    if ph_out_of_range:
                        should_irrigate = False
                    elif isinstance(manual_override, bool):
                        should_irrigate = auto_irrigation_requested or manual_override
                    else:
                        should_irrigate = auto_irrigation_requested or manual_requested or keep_running_until_cutoff

                if bool_from_value(field.get("irrigation")) != should_irrigate:
                    field["irrigation"] = should_irrigate
                    dirty = True

                LOW_MOISTURE_LATCHES[field_key] = desired_auto_reason == "moisture"
                PH_CONTROL_LATCHES[field_key] = False
                PH_RECOVERY_READY_AT[field_key] = None
                apply_field_ph_condition(field_key, field)

                if should_irrigate:
                    set_irrigation_run(field_key, desired_auto_reason or "manual", field, now=now)
                else:
                    clear_irrigation_run(field_key)

            if automation_enabled and isinstance(greenhouse, dict):
                previous_pulse_state = bool_from_value(greenhouse.get("automationFirePulseActive"))
                if previous_pulse_state != greenhouse_pulse_active:
                    greenhouse["automationFirePulseActive"] = greenhouse_pulse_active
                    dirty = True

                fire_sensor = greenhouse.get("fireSensor", {})
                sensor_fire_alert = bool_from_value(fire_sensor.get("detected")) if isinstance(fire_sensor, dict) else False
                next_fire_alert = (
                    sensor_fire_alert
                    or greenhouse_pulse_active
                    or number_from_value(greenhouse.get("temp"), 0.0) >= 52.0
                )
                if bool_from_value(greenhouse.get("fireAlert")) != next_fire_alert:
                    greenhouse["fireAlert"] = next_fire_alert
                    dirty = True

            if dirty:
                apply_greenhouse_rules(CURRENT)
                if automation_reset_active:
                    CURRENT["state"]["pumping"] = False
                    CURRENT["state"]["mainTankManualOverride"] = False
                    CURRENT["state"]["flowRate"] = 0.0
                else:
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
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
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

        if parsed.path == "/api/automation":
            try:
                body = self.read_body()
            except json.JSONDecodeError:
                self.send_json({"error": "Invalid JSON body"}, status=400)
                return

            enabled = bool_from_value((body or {}).get("enabled"))
            snapshot = set_automation_enabled(enabled)
            self.send_json({"ok": True, "automationEnabled": enabled, "dashboard": snapshot})
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

        # --- ADD THIS NEW GREENHOUSE BLOCK HERE ---
        if parsed.path == "/api/greenhouse":
            try:
                body = self.read_body()
            except json.JSONDecodeError:
                self.send_json({"error": "Invalid JSON body"}, status=400)
                return

            update_current(
                {"state": {"gh": body}},
                connected=None,
                last_error=""
            )
            self.send_json({"ok": True, "dashboard": CURRENT})
            return
        # ------------------------------------------

        # --- RESET ENDPOINT: Send complete shutdown command with yellow=on (system off indicator) ---
        if parsed.path == "/api/reset":
            try:
                with STATE_LOCK:
                    ip_address = CURRENT.get("deviceIp", "")

                # Send shutdown commands to device: pump=off, yellow=on, all sensors zeroed
                if ip_address:
                    send_pump_off_commands(ip_address)

                # Reset all local field states to zero with pumps OFF
                reset_state_for_shutdown()

                # Disable automation to prevent auto-recovery
                CURRENT["automationEnabled"] = False

                self.send_json({"ok": True, "message": "System reset - all pumps OFF, yellow=on sent", "dashboard": CURRENT})
            except Exception as error:
                self.send_json({"error": str(error), "dashboard": CURRENT}, status=500)
            return
        # ------------------------------------------

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

