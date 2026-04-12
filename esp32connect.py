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
STATE_FILE = os.path.join(os.path.dirname(__file__), "esp32_state.json")
DEFAULT_DEVICE_IP = "192.168.0.20"
IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD = 30.0
IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD = 60.0
IRRIGATION_PH_LOW_THRESHOLD = 4.0
IRRIGATION_PH_HIGH_THRESHOLD = 10.0
IRRIGATION_PH_TARGET = 7.0
IRRIGATION_PH_STEP_PER_TICK = 0.1
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
    "lastUpdated": None,
    "state": {
        "tank": 41,
        "pumping": False,
        "flowRate": 0.0,
        "gh": {"temp": 35, "humidity": 65},
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
IRRIGATION_RUNS = {
    "f1": {"reason": None, "start_time": None, "start_moisture": None},
    "f2": {"reason": None, "start_time": None, "start_moisture": None},
    "f3": {"reason": None, "start_time": None, "start_moisture": None},
}


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
        return deep_merge(DEFAULT_STATE, saved)
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


def should_auto_irrigate(field_key, field):
    moisture = number_from_value(field.get("moisture"), IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD)
    return moisture < IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD


def get_irrigation_reason(field_key, field):
    moisture = number_from_value(field.get("moisture"), IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD)
    if moisture < IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD:
        return "moisture"

    return None


def set_irrigation_run(field_key, reason, field, now=None):
    if now is None:
        now = time.time()

    run = IRRIGATION_RUNS[field_key]
    run["reason"] = reason

    if reason == "moisture":
        start_moisture = min(
            number_from_value(field.get("moisture"), IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD),
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
        or humidity > GREENHOUSE_FAN_HUMIDITY_THRESHOLD
    )
    return state


def initialize_irrigation_runtime(state):
    for field_key in ("f1", "f2", "f3"):
        field = state.get("state", {}).get(field_key)
        if not isinstance(field, dict):
            continue

        LOW_MOISTURE_LATCHES[field_key] = False
        PH_CONTROL_LATCHES[field_key] = False

        clear_irrigation_run(field_key)

    state["state"]["pumping"] = any(
        bool_from_value(state.get("state", {}).get(field_key, {}).get("irrigation"))
        for field_key in ("f1", "f2", "f3")
    )
    return state


CURRENT = initialize_irrigation_runtime(CURRENT)
CURRENT = apply_greenhouse_rules(CURRENT)


def save_state():
    with open(STATE_FILE, "w", encoding="utf-8") as file:
        json.dump(CURRENT, file, indent=2)


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


def http_json(url, method="GET", body=None):
    payload = None
    headers = {}
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = Request(url, data=payload, method=method, headers=headers)
    with urlopen(request, timeout=REQUEST_TIMEOUT) as response:
        raw = response.read().decode("utf-8", errors="replace")
        content_type = response.headers.get("Content-Type", "")
        if "application/json" in content_type:
            return json.loads(raw)

        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"raw": raw}


def http_text(url):
    request = Request(url, method="GET")
    with urlopen(request, timeout=REQUEST_TIMEOUT) as response:
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

    if "temperature" in payload:
        gh_patch["temp"] = number_from_value(payload["temperature"], CURRENT["state"]["gh"]["temp"])
    if "humidity" in payload:
        gh_patch["humidity"] = number_from_value(payload["humidity"], CURRENT["state"]["gh"]["humidity"])

    if gh_patch:
        state_patch["gh"] = gh_patch

    for field_key in ("f1", "f2", "f3"):
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
    errors = []
    for path in ("/status", "/data", "/"):
        try:
            payload = http_json(f"http://{ip_address}{path}")
            patch = apply_status_payload(payload)
            if patch:
                return patch
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
            errors.append(f"{path}: {error}")
        except Exception as error:
            errors.append(f"{path}: {error}")

    raise RuntimeError("; ".join(errors) if errors else "Unable to read ESP32 status")


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

    for key in ("irrigation", "drain", "acid", "base"):
        if key not in incoming:
            continue
        value = bool_from_value(incoming[key])
        field_patch[key] = value
        device_payload[key] = value

    return field_patch, device_payload


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


def update_current(patch, connected=None, last_error=None):
    with STATE_LOCK:
        now = time.time()
        old_irrigations = {k: CURRENT["state"].get(k, {}).get("irrigation", False) for k in ("f1", "f2", "f3")}
        merged = apply_greenhouse_rules(deep_merge(CURRENT, patch))

        for field_key in ("f1", "f2", "f3"):
            field = merged["state"][field_key]
            new_irrigation = bool_from_value(field.get("irrigation"))
            old_irrigation = old_irrigations[field_key]
            moisture_trigger_active = number_from_value(field.get("moisture"), IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD) < IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD
            existing_reason = IRRIGATION_RUNS[field_key]["reason"]
            desired_auto_reason = get_irrigation_reason(field_key, field)
            current_moisture = number_from_value(field.get("moisture"), 0.0)
            moisture_cycle_active = existing_reason == "moisture"

            if moisture_cycle_active:
                if current_moisture >= IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD:
                    field["irrigation"] = False
                    LOW_MOISTURE_LATCHES[field_key] = False
                    PH_CONTROL_LATCHES[field_key] = False
                    clear_irrigation_run(field_key)
                    new_irrigation = False
                    moisture_cycle_active = False
                else:
                    # Ignore later UI writes that try to turn irrigation off
                    # while a moisture cycle is still active.
                    field["irrigation"] = True
                    new_irrigation = True

            if new_irrigation and not old_irrigation:
                LOW_MOISTURE_LATCHES[field_key] = moisture_trigger_active
                PH_CONTROL_LATCHES[field_key] = False
                set_irrigation_run(field_key, desired_auto_reason or "manual", field, now=now)
            elif not new_irrigation and old_irrigation:
                LOW_MOISTURE_LATCHES[field_key] = moisture_trigger_active
                PH_CONTROL_LATCHES[field_key] = False
                clear_irrigation_run(field_key)

            if not moisture_trigger_active:
                LOW_MOISTURE_LATCHES[field_key] = False
            PH_CONTROL_LATCHES[field_key] = False

            if not moisture_cycle_active and not new_irrigation and moisture_trigger_active:
                field["irrigation"] = True
                LOW_MOISTURE_LATCHES[field_key] = moisture_trigger_active
                PH_CONTROL_LATCHES[field_key] = False
                set_irrigation_run(field_key, desired_auto_reason, field, now=now)

        merged["state"]["pumping"] = any(merged["state"][field_key]["irrigation"] for field_key in ("f1", "f2", "f3"))
        CURRENT.clear()
        CURRENT.update(merged)
        if connected is not None:
            CURRENT["connected"] = connected
        if last_error is not None:
            CURRENT["lastError"] = last_error
        CURRENT["lastUpdated"] = __import__("datetime").datetime.now().isoformat(timespec="seconds")
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

            for field_key in ("f1", "f2", "f3"):
                field = CURRENT.get("state", {}).get(field_key)
                if not field:
                    continue

                run_reason = IRRIGATION_RUNS[field_key]["reason"]
                moisture_cycle_active = run_reason == "moisture"
                current_moisture = number_from_value(field.get("moisture"), 0.0)

                if moisture_cycle_active and current_moisture < IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD:
                    field["irrigation"] = True

                if field.get("irrigation"):
                    if moisture_cycle_active and current_moisture >= IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD:
                        field["irrigation"] = False
                        LOW_MOISTURE_LATCHES[field_key] = False
                        PH_CONTROL_LATCHES[field_key] = False
                        clear_irrigation_run(field_key)
                        dirty = True
                        continue
                    if field.get("wl", 0) < 30.0:
                        field["wl"] = round(min(30.0, field.get("wl", 0) + 0.5), 1)
                        dirty = True
                    if moisture_cycle_active:
                        start_time = IRRIGATION_RUNS[field_key]["start_time"]
                        start_moisture = IRRIGATION_RUNS[field_key]["start_moisture"]
                        if start_time is None or start_moisture is None:
                            set_irrigation_run(field_key, "moisture", field, now=now)
                            start_time = IRRIGATION_RUNS[field_key]["start_time"]
                            start_moisture = IRRIGATION_RUNS[field_key]["start_moisture"]

                        elapsed = max(0.0, now - start_time)
                        progress = min(1.0, elapsed / MOISTURE_AUTO_IRRIGATION_DURATION_SECONDS)
                        target_moisture = start_moisture + (
                            (IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD - start_moisture) * progress
                        )
                        next_moisture = round(
                            min(
                                IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD,
                                max(current_moisture, target_moisture),
                            ),
                            1,
                        )
                        if next_moisture != current_moisture:
                            field["moisture"] = next_moisture
                            dirty = True
                        if progress >= 1.0 or next_moisture >= IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD:
                            field["irrigation"] = False
                            LOW_MOISTURE_LATCHES[field_key] = False
                            PH_CONTROL_LATCHES[field_key] = False
                            clear_irrigation_run(field_key)
                            dirty = True
                            continue
                    elif field.get("moisture", 0) < 100.0:
                        field["moisture"] = round(min(100.0, field.get("moisture", 0) + 1.0), 1)
                        dirty = True

                else:
                    if field.get("wl", 0) > 0.0:
                        field["wl"] = round(max(0.0, field.get("wl", 0) - 0.1), 1)
                        dirty = True
                    if field.get("moisture", 0) > 0.0:
                        field["moisture"] = round(max(0.0, field.get("moisture", 0) - 0.2), 1)
                        dirty = True

                moisture_trigger_active = number_from_value(field.get("moisture"), IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD) < IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD

                if not moisture_trigger_active:
                    LOW_MOISTURE_LATCHES[field_key] = False
                PH_CONTROL_LATCHES[field_key] = False

                if not moisture_cycle_active and not field.get("irrigation") and moisture_trigger_active:
                    field["irrigation"] = True
                    LOW_MOISTURE_LATCHES[field_key] = moisture_trigger_active
                    PH_CONTROL_LATCHES[field_key] = False
                    set_irrigation_run(field_key, get_irrigation_reason(field_key, field), field, now=now)
                    dirty = True

            if dirty:
                apply_greenhouse_rules(CURRENT)
                CURRENT["state"]["pumping"] = any(
                    CURRENT["state"][field_key]["irrigation"] for field_key in ("f1", "f2", "f3")
                )
                CURRENT["lastUpdated"] = __import__("datetime").datetime.now().isoformat(timespec="seconds")
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

            if not ip_address:
                self.send_json(CURRENT)
                return

            try:
                patch = fetch_device_status(ip_address)
                update_current(patch, connected=True, last_error="")
            except Exception as error:
                update_current({}, connected=False, last_error=str(error))

            self.send_json(CURRENT)
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
                field_patch, device_payload = normalize_field_body(field_key, body)
            except ValueError as error:
                self.send_json({"error": str(error)}, status=400)
                return

            update_current({"state": {field_key: field_patch}}, connected=False, last_error="")
            print_field_update(field_key)
            self.send_json({"ok": True, "field": field_key, "saved": True, "dashboard": CURRENT})
            return

        self.send_json({"error": "Not found"}, status=404)


if __name__ == "__main__":
    print(f"ESP32 bridge running on http://127.0.0.1:{PORT}")
    print("Open your React dashboard, enter the ESP32 IP, then use the irrigation button.")
    threading.Thread(target=simulation_loop, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()
