from copy import deepcopy
from http.server import ThreadingHTTPServer
import json
import os
import queue
import re
import shutil
import socket
import subprocess
import sys
import threading
import time

from urllib.parse import urlparse

import requests

from esp32connect import (
    CURRENT,
    HOST,
    PORT,
    STATE_LOCK,
    Handler,
    bool_from_value,
    moisture_to_water_level,
    normalize_linked_field_values,
    normalize_field_body,
    is_irrigation_blocked_by_ph,
    number_from_value,
    print_field_update,
    reset_state_for_shutdown,
    set_automation_enabled,
    update_current,
    simulation_loop,
    water_level_to_moisture,
)


def get_shutdown_command():
    is_root = hasattr(os, "geteuid") and os.geteuid() == 0
    print(f"[SHUTDOWN CHECK] is_root={is_root}, geteuid={os.geteuid() if hasattr(os, 'geteuid') else 'N/A'}")

    if is_root:
        print("[SHUTDOWN CHECK] Running as root, using direct shutdown command")
        return ["shutdown", "-h", "now"], None

    sudo_path = shutil.which("sudo")
    print(f"[SHUTDOWN CHECK] sudo_path={sudo_path}")
    
    if sudo_path:
        try:
            print("[SHUTDOWN CHECK] Testing sudo permissions with 'sudo -n true'")
            sudo_check = subprocess.run(
                [sudo_path, "-n", "true"],
                capture_output=True,
                text=True,
                timeout=2,
                check=False,
            )
            print(f"[SHUTDOWN CHECK] sudo test returncode={sudo_check.returncode}")
        except Exception as error:
            print(f"[SHUTDOWN CHECK] sudo test failed with exception: {error}")
            return None, f"Unable to verify sudo permission: {error}"

        if sudo_check.returncode == 0:
            print("[SHUTDOWN CHECK] Sudo passwordless working, using sudo shutdown command")
            return [sudo_path, "-n", "shutdown", "-h", "now"], None
        else:
            print(f"[SHUTDOWN CHECK] sudo test failed. stdout={sudo_check.stdout}, stderr={sudo_check.stderr}")

    return None, (
        "Shutdown permission is not available for the backend user. "
        "Run the backend with sudo, or allow passwordless shutdown for this user."
    )

try:
    from Agri_iot import close as close_modbus_controller
    from Agri_iot import control as modbus_control
    from Agri_iot import MODBUS_HOST as PLC_HOST
    from Agri_iot import MODBUS_PORT as PLC_PORT
except Exception as import_error:
    close_modbus_controller = None
    modbus_control = None
    PLC_HOST = "192.168.0.3"
    PLC_PORT = 502
    MODBUS_IMPORT_ERROR = import_error
else:
    MODBUS_IMPORT_ERROR = None

ESP_DEVICES = {
    1: "192.168.0.4",
    2: "192.168.0.5",
    3: "192.168.0.6",
    4: "192.168.0.7",
}

RELAY_COMMANDS = {
    "main_tank": {True: "r1on", False: "r1off"},
    "f1": {True: "r2on", False: "r2off"},
    "f2": {True: "r3on", False: "r3off"},
    "f3": {True: "r4on", False: "r4off"},
}

ESP_REQUEST_TIMEOUT = 3
ESP_RETRY_LIMIT = 3
ESP_RETRY_BACKOFF_SECONDS = 0.75
ESP_INTER_REQUEST_DELAY_SECONDS = 0.2
PLC_COMMAND_QUEUE_TIMEOUT_SECONDS = 1.0
ESP_COMMAND_QUEUE_TIMEOUT_SECONDS = 1.0
SHUTDOWN_DELAY_SECONDS = 5.0
AUTOMATION_FIELD_SEQUENCE = ("f1", "f2", "f3")
AUTOMATION_FIELD_RUN_SECONDS = float(os.getenv("AUTOMATION_FIELD_RUN_SECONDS", "6"))
AUTOMATION_IDLE_SLEEP_SECONDS = 0.2
MAIN_TANK_SENSOR_URL = os.getenv("MAIN_TANK_SENSOR_URL", "http://192.168.0.4/tank")
MAIN_TANK_SENSOR_TIMEOUT_SECONDS = float(os.getenv("MAIN_TANK_SENSOR_TIMEOUT", "2.0"))
MAIN_TANK_POLL_INTERVAL_SECONDS = float(os.getenv("MAIN_TANK_POLL_INTERVAL_SECONDS", "0.5"))
FARMHOUSE_FIRE_SENSOR_URL = os.getenv("FARMHOUSE_FIRE_SENSOR_URL", "http://192.168.0.7/fire")
FARMHOUSE_FIRE_SENSOR_TIMEOUT_SECONDS = float(os.getenv("FARMHOUSE_FIRE_SENSOR_TIMEOUT", "2.0"))
FARMHOUSE_FIRE_POLL_INTERVAL_SECONDS = float(os.getenv("FARMHOUSE_FIRE_POLL_INTERVAL", "1.0"))
FARMHOUSE_FIRE_SENSOR_ERROR_BACKOFF_SECONDS = float(os.getenv("FARMHOUSE_FIRE_SENSOR_ERROR_BACKOFF", "20"))
ESP32_DISTANCE_URL = os.getenv("ESP32_DISTANCE_URL", "http://192.168.0.8/distance")
ESP32_DISTANCE_TIMEOUT_SECONDS = float(os.getenv("ESP32_DISTANCE_TIMEOUT", "2.0"))
MAIN_TANK_STOP_PERCENT = 100.0
MAIN_TANK_REFILL_START_PERCENT = 20.0
MAIN_TANK_SIMULATION_STEP_PERCENT = 2.0
PLC_OFFLINE_COOLDOWN_SECONDS = float(os.getenv("PLC_OFFLINE_COOLDOWN", "20"))
MAIN_TANK_SENSOR_ERROR_BACKOFF_SECONDS = float(os.getenv("MAIN_TANK_SENSOR_ERROR_BACKOFF", "2"))
MAIN_TANK_RELAY_COMMAND_LOCK = threading.Lock()
MAIN_TANK_LAST_REQUESTED_STATE = None
SHUTDOWN_IN_PROGRESS = False
MAIN_TANK_SENSOR_PRINT_DELTA = float(os.getenv("MAIN_TANK_SENSOR_PRINT_DELTA", "5"))
FIRE_ALERT_TRUE_VALUES = {"1", "true", "on", "yes", "fire", "alert", "detected", "high"}
FIRE_ALERT_FALSE_VALUES = {"0", "false", "off", "no", "safe", "normal", "clear", "none", "low"}
FIRE_ALERT_TRUE_PHRASES = ("fire detected", "fire: yes", "fire: true", "fire: on", "fire: 1")
FIRE_ALERT_FALSE_PHRASES = (
    "no fire",
    "fire not detected",
    "no flame",
    "flame not detected",
    "fire: no",
    "fire: false",
    "fire: off",
    "fire: 0",
)

HTTP_SESSION_POOL_SIZE = 8


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def build_http_session():
    session = requests.Session()
    adapter = requests.adapters.HTTPAdapter(
        pool_connections=HTTP_SESSION_POOL_SIZE,
        pool_maxsize=HTTP_SESSION_POOL_SIZE,
    )
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


distance_http_session = build_http_session()


class ConnectionStatusTracker:
    def __init__(self, label):
        self.label = label
        self._failures = {}
        self._lock = threading.Lock()

    def report_success(self, key, detail):
        with self._lock:
            if self._failures.pop(key, None):
                print(f"[{self.label} RECOVERED] {detail}")

    def report_failure(self, key, detail):
        with self._lock:
            failure_count = self._failures.get(key, 0) + 1
            self._failures[key] = failure_count
        if failure_count == 1:
            print(f"[{self.label} ERROR] {detail}")
        elif failure_count % 10 == 0:
            print(f"[{self.label} ERROR] {detail} (repeated {failure_count} times)")


def is_plc_off_command(command):
    return command in {
        RELAY_COMMANDS["main_tank"][False],
        RELAY_COMMANDS["f1"][False],
        RELAY_COMMANDS["f2"][False],
        RELAY_COMMANDS["f3"][False],
    }


def is_shutdown_in_progress():
    with STATE_LOCK:
        return SHUTDOWN_IN_PROGRESS


def mark_shutdown_in_progress():
    global SHUTDOWN_IN_PROGRESS
    with STATE_LOCK:
        SHUTDOWN_IN_PROGRESS = True


def should_main_tank_pump(tank, was_pumping=False):
    normalized_tank = number_from_value(tank, 0.0)
    if normalized_tank >= MAIN_TANK_STOP_PERCENT:
        return False
    if bool_from_value(was_pumping):
        return True
    return normalized_tank <= MAIN_TANK_REFILL_START_PERCENT


def format_worker_error(error):
    return f"{type(error).__name__}: {error}"


class PLCCooldownActiveError(ConnectionError):
    pass


def get_main_tank_pumping_state():
    with STATE_LOCK:
        tank = number_from_value(CURRENT["state"]["tank"], 0.0)

        if tank <= MAIN_TANK_REFILL_START_PERCENT:
            pumping = True
        elif tank >= MAIN_TANK_STOP_PERCENT:
            pumping = False
        else:
            manual_override = CURRENT["state"].get("mainTankManualOverride")
            if isinstance(manual_override, bool):
                pumping = manual_override
            else:
                pumping = should_main_tank_pump(tank, CURRENT["state"].get("pumping"))

        CURRENT["state"]["pumping"] = pumping
        return pumping


def queue_main_tank_relay(source="control", wait=False, force=False):
    global MAIN_TANK_LAST_REQUESTED_STATE

    pumping = get_main_tank_pumping_state()
    with MAIN_TANK_RELAY_COMMAND_LOCK:
        if not force and MAIN_TANK_LAST_REQUESTED_STATE is pumping:
            return {
                "queued": False,
                "skipped_unchanged": True,
                "command": RELAY_COMMANDS["main_tank"][pumping],
                "source": source,
                "pumping": pumping,
            }

        result = plc_worker.enqueue(RELAY_COMMANDS["main_tank"][pumping], source=source, wait=wait)
        MAIN_TANK_LAST_REQUESTED_STATE = pumping
        return result


class PLCCommandWorker:
    def __init__(self):
        self._queue = queue.Queue()
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run, name="plc-worker", daemon=True)
        self._status = ConnectionStatusTracker("PLC WORKER")
        self._offline_until = 0.0
        self._pending_commands = set()
        self._pending_lock = threading.Lock()

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop_event.set()
        self._queue.put(None)
        self._thread.join(timeout=3)

    def enqueue(self, command, source="control", wait=False, timeout=5.0):
        if is_shutdown_in_progress() and not is_plc_off_command(command):
            return {
                "queued": False,
                "skipped_shutdown": True,
                "command": command,
                "source": source,
            }

        if not wait:
            with self._pending_lock:
                if command in self._pending_commands:
                    return {
                        "queued": False,
                        "skipped_duplicate": True,
                        "command": command,
                        "source": source,
                    }
                self._pending_commands.add(command)

        message = {
            "type": "relay",
            "command": command,
            "source": source,
            "event": None,
            "result": None,
            "error": None,
        }
        if wait:
            message["event"] = threading.Event()

        self._queue.put(message)

        if not wait:
            return {"queued": True, "command": command, "source": source}

        if not message["event"].wait(timeout):
            raise TimeoutError(f"Timed out waiting for PLC command '{command}'")
        if message["error"] is not None:
            raise message["error"]
        return message["result"]

    def _run(self):
        while not self._stop_event.is_set():
            try:
                message = self._queue.get(timeout=PLC_COMMAND_QUEUE_TIMEOUT_SECONDS)
            except queue.Empty:
                continue

            if message is None:
                self._queue.task_done()
                break

            try:
                now = time.time()
                if now < self._offline_until:
                    remaining = max(0.0, self._offline_until - now)
                    raise PLCCooldownActiveError(
                        f"Skipping PLC retry for {remaining:.1f}s after recent connection failure"
                    )
                if is_shutdown_in_progress() and not is_plc_off_command(message["command"]):
                    message["result"] = {
                        "queued": False,
                        "skipped_shutdown": True,
                        "command": message["command"],
                        "source": message["source"],
                    }
                    self._status.report_success(
                        "plc",
                        f"skipped {message['command']} during shutdown",
                    )
                    continue
                result = send_relay_command(message["command"])
                message["result"] = result
                self._offline_until = 0.0
                self._status.report_success(
                    "plc",
                    f"{message['command']} -> {PLC_HOST}:{PLC_PORT}",
                )
            except Exception as error:
                message["error"] = error
                if isinstance(error, PLCCooldownActiveError):
                    pass
                elif isinstance(error, ConnectionError):
                    self._offline_until = time.time() + PLC_OFFLINE_COOLDOWN_SECONDS
                    self._status.report_failure(
                        "plc",
                        f"{message['command']} -> {PLC_HOST}:{PLC_PORT}: {format_worker_error(error)}",
                    )
                else:
                    self._status.report_failure(
                        "plc",
                        f"{message['command']} -> {PLC_HOST}:{PLC_PORT}: {format_worker_error(error)}",
                    )
            finally:
                if message["event"] is None:
                    with self._pending_lock:
                        self._pending_commands.discard(message["command"])
                if message["event"] is not None:
                    message["event"].set()
                self._queue.task_done()


class ESPCommandWorker:
    def __init__(self):
        self._queue = queue.Queue()
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run, name="esp-worker", daemon=True)
        self._session = build_http_session()
        self._last_request_at = 0.0
        self._status = ConnectionStatusTracker("ESP WORKER")
        self._pending_syncs = set()
        self._pending_lock = threading.Lock()

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop_event.set()
        self._queue.put(None)
        self._thread.join(timeout=3)
        self._session.close()

    def enqueue_sync(self, esp_num, source="control", wait=False, timeout=10.0):
        if not wait:
            with self._pending_lock:
                if esp_num in self._pending_syncs:
                    return {
                        "queued": False,
                        "skipped_duplicate": True,
                        "esp": esp_num,
                        "source": source,
                    }
                self._pending_syncs.add(esp_num)

        message = {
            "type": "sync",
            "esp_num": esp_num,
            "source": source,
            "event": None,
            "result": None,
            "error": None,
        }
        if wait:
            message["event"] = threading.Event()

        self._queue.put(message)

        if not wait:
            return {"queued": True, "esp": esp_num, "source": source}

        if not message["event"].wait(timeout):
            raise TimeoutError(f"Timed out waiting for ESP{esp_num} sync")
        if message["error"] is not None:
            raise message["error"]
        return message["result"]

    def enqueue_payload(self, esp_num, payload, source="control", wait=False, timeout=10.0):
        message = {
            "type": "payload",
            "esp_num": esp_num,
            "payload": payload,
            "source": source,
            "event": None,
            "result": None,
            "error": None,
        }
        if wait:
            message["event"] = threading.Event()

        self._queue.put(message)

        if not wait:
            return {"queued": True, "esp": esp_num, "source": source}

        if not message["event"].wait(timeout):
            raise TimeoutError(f"Timed out waiting for ESP{esp_num} payload send")
        if message["error"] is not None:
            raise message["error"]
        return message["result"]

    def _run(self):
        while not self._stop_event.is_set():
            try:
                message = self._queue.get(timeout=ESP_COMMAND_QUEUE_TIMEOUT_SECONDS)
            except queue.Empty:
                continue

            if message is None:
                self._queue.task_done()
                break

            try:
                if message["type"] == "sync":
                    payload = get_esp_payload_from_state(message["esp_num"])
                    result = self._send_payload(message["esp_num"], payload)
                else:
                    result = self._send_payload(message["esp_num"], message["payload"])
                message["result"] = result
                self._status.report_success(
                    message["esp_num"],
                    f"ESP{message['esp_num']} -> {ESP_DEVICES[message['esp_num']]}",
                )
            except Exception as error:
                message["error"] = error
                self._status.report_failure(
                    message["esp_num"],
                    f"ESP{message['esp_num']} -> {ESP_DEVICES.get(message['esp_num'], 'unknown')}: {format_worker_error(error)}",
                )
            finally:
                if message["type"] == "sync" and message["event"] is None:
                    with self._pending_lock:
                        self._pending_syncs.discard(message["esp_num"])
                if message["event"] is not None:
                    message["event"].set()
                self._queue.task_done()

    def _send_payload(self, esp_num, payload):
        if esp_num not in ESP_DEVICES:
            raise ValueError("Invalid ESP number")

        target_ip = ESP_DEVICES[esp_num]
        last_error = None

        for attempt in range(1, ESP_RETRY_LIMIT + 1):
            self._pace_requests()
            try:
                if esp_num == 4:
                    fan = str(payload["fan"]).lower()
                    url = f"http://{target_ip}/set?temp={payload['temp']}&humid={payload['humid']}&fan={fan}"
                else:
                    pump = str(payload["pump"]).lower()
                    status = str(payload.get("status", "irrigation")).lower()
                    yellow = str(payload.get("yellow", "off")).lower()
                    url = (
                        f"http://{target_ip}/set?level={payload['level']}&pump={pump}"
                        f"&moisture={payload['moisture']}&ph={payload['ph']}&status={status}"
                        f"&yellow={yellow}"
                    )

                response = self._session.get(url, timeout=ESP_REQUEST_TIMEOUT)
                response.raise_for_status()
                print(f"Sent to ESP{esp_num}: {url}")
                print(f"Response: {response.status_code}")
                return {
                    "esp": esp_num,
                    "ip": target_ip,
                    "status_code": response.status_code,
                    "url": url,
                    "body": response.text,
                }
            except (
                requests.Timeout,
                requests.ConnectionError,
                requests.HTTPError,
                socket.error,
            ) as error:
                last_error = error
                if attempt < ESP_RETRY_LIMIT:
                    time.sleep(ESP_RETRY_BACKOFF_SECONDS * attempt)
            except Exception as error:
                last_error = error
                break

        raise RuntimeError(
            f"ESP{esp_num} request failed after {ESP_RETRY_LIMIT} attempts: {format_worker_error(last_error)}"
        )

    def _pace_requests(self):
        now = time.time()
        delay = ESP_INTER_REQUEST_DELAY_SECONDS - (now - self._last_request_at)
        if delay > 0:
            time.sleep(delay)
        self._last_request_at = time.time()


class ControlLoopWorker:
    def __init__(self, plc_worker, esp_worker):
        self.plc_worker = plc_worker
        self.esp_worker = esp_worker
        self._last_irrigation = {"f1": False, "f2": False, "f3": False}
        self._last_greenhouse_fan = None
        self._last_esp_payloads = {1: None, 2: None, 3: None, 4: None}
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run, name="control-worker", daemon=True)

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop_event.set()
        self._thread.join(timeout=3)

    def _run(self):
        while not self._stop_event.is_set():
            if is_shutdown_in_progress():
                break
            time.sleep(1)
            self._process_irrigation_changes()
            self._process_greenhouse_changes()
            self._process_esp_value_changes()

    def _process_irrigation_changes(self):
        changes = []
        with STATE_LOCK:
            for field_key in ("f1", "f2", "f3"):
                field = CURRENT["state"][field_key]
                if is_irrigation_blocked_by_ph(field_key, field):
                    field["irrigation"] = False
                current_value = bool(CURRENT["state"][field_key]["irrigation"])
                if current_value != self._last_irrigation[field_key]:
                    changes.append((field_key, current_value))
                self._last_irrigation[field_key] = current_value

        for field_key, is_running in changes:
            with STATE_LOCK:
                field = deepcopy(CURRENT["state"][field_key])
            moisture = number_from_value(field.get("moisture"), 0.0)
            ph = number_from_value(field.get("ph"), 7.0)
            if field_key in {"f2", "f3"} and is_running:
                print(
                    f"\n[AUTO-IRRIGATION] {field_key.upper()} started because moisture is below 30% "
                    f"(current: moisture {moisture:.1f}%)."
                )
            elif field_key in {"f2", "f3"}:
                print(
                    f"\n[AUTO-SHUTOFF] {field_key.upper()} stopped because moisture is above 60% "
                    f"(current: moisture {moisture:.1f}%)."
                )
            elif is_running:
                print(
                    f"\n[AUTO-IRRIGATION] {field_key.upper()} started because moisture is below 30% "
                    f"(current: moisture {moisture:.1f}%, pH {ph:.2f})."
                )
            else:
                print(
                    f"\n[AUTO-SHUTOFF] {field_key.upper()} stopped because moisture start condition is not satisfied "
                    f"(current: moisture {moisture:.1f}%, pH {ph:.2f})."
                )

            enqueue_field_relay_sync(field_key, source="control-loop")
            enqueue_main_tank_sync(source="control-loop")
            enqueue_esp_sync(UIBackendHandler.FIELD_TO_ESP[field_key], source="control-loop")
            print_formatted_field(field_key)

    def _process_greenhouse_changes(self):
        with STATE_LOCK:
            current_fan = bool(CURRENT["state"]["gh"].get("fanOn"))

        if self._last_greenhouse_fan is None:
            self._last_greenhouse_fan = current_fan
            return

        if current_fan == self._last_greenhouse_fan:
            return

        self._last_greenhouse_fan = current_fan
        enqueue_esp_sync(4, source="greenhouse-auto")

    def _process_esp_value_changes(self):
        for esp_num in (1, 2, 3, 4):
            try:
                payload = get_esp_payload_from_state(esp_num)
            except Exception as error:
                print(f"[ESP PAYLOAD ERROR] ESP{esp_num}: {format_worker_error(error)}")
                continue

            if payload == self._last_esp_payloads[esp_num]:
                continue

            try:
                enqueue_esp_sync(esp_num, source="value-sync")
                self._last_esp_payloads[esp_num] = deepcopy(payload)
            except Exception as error:
                print(f"[ESP SYNC ERROR] ESP{esp_num}: {format_worker_error(error)}")


class AutomationCycleWorker:
    def __init__(self):
        self._stop_event = threading.Event()
        self._wake_event = threading.Event()
        self._thread = threading.Thread(target=self._run, name="automation-cycle-worker", daemon=True)

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop_event.set()
        self._wake_event.set()
        self._thread.join(timeout=3)

    def set_enabled(self, enabled):
        enabled = bool(enabled)
        with STATE_LOCK:
            current_enabled = bool_from_value(CURRENT.get("automationEnabled"))

        if current_enabled == enabled:
            return

        set_automation_enabled(enabled)

        for field_key in AUTOMATION_FIELD_SEQUENCE:
            try:
                enqueue_field_relay_sync(field_key, source="automation-toggle")
            except Exception as error:
                print(f"[AUTOMATION TOGGLE RELAY ERROR] {field_key.upper()}: {format_worker_error(error)}")

        try:
            enqueue_main_tank_sync(source="automation-toggle")
        except Exception as error:
            print(f"[AUTOMATION TOGGLE RELAY ERROR] MAIN TANK: {format_worker_error(error)}")

        for esp_num in (1, 2, 3, 4):
            try:
                enqueue_esp_sync(esp_num, source="automation-toggle")
            except Exception as error:
                print(f"[AUTOMATION TOGGLE ESP ERROR] ESP{esp_num}: {format_worker_error(error)}")

        self._wake_event.set()

    def _apply_stop_state(self):
        update_current(
            {
                "state": {
                    "pumping": False,
                    "mainTankManualOverride": False,
                    "f1": {"irrigation": False},
                    "f2": {"irrigation": False},
                    "f3": {"irrigation": False},
                }
            },
            connected=False,
            last_error="",
        )

        for field_key in AUTOMATION_FIELD_SEQUENCE:
            try:
                enqueue_field_relay_sync(field_key, source="automation-stop")
            except Exception as error:
                print(f"[AUTOMATION STOP RELAY ERROR] {field_key.upper()}: {format_worker_error(error)}")

        try:
            enqueue_main_tank_sync(source="automation-stop")
        except Exception as error:
            print(f"[AUTOMATION STOP RELAY ERROR] MAIN TANK: {format_worker_error(error)}")

        for esp_num in (1, 2, 3, 4):
            try:
                enqueue_esp_sync(esp_num, source="automation-stop")
            except Exception as error:
                print(f"[AUTOMATION STOP ESP ERROR] ESP{esp_num}: {format_worker_error(error)}")

    def _activate_step(self, active_field_key):
        field_state_patch = {
            field_key: {"irrigation": field_key == active_field_key}
            for field_key in AUTOMATION_FIELD_SEQUENCE
        }

        update_current(
            {
                "state": {
                    "pumping": True,
                    "mainTankManualOverride": True,
                    **field_state_patch,
                }
            },
            connected=False,
            last_error="",
        )

        for field_key in AUTOMATION_FIELD_SEQUENCE:
            try:
                enqueue_field_relay_sync(field_key, source=f"automation-{active_field_key}")
            except Exception as error:
                print(f"[AUTOMATION RELAY ERROR] {field_key.upper()}: {format_worker_error(error)}")

        try:
            enqueue_main_tank_sync(source=f"automation-{active_field_key}")
        except Exception as error:
            print(f"[AUTOMATION RELAY ERROR] MAIN TANK: {format_worker_error(error)}")

        for esp_num in (1, 2, 3, 4):
            try:
                enqueue_esp_sync(esp_num, source=f"automation-{active_field_key}")
            except Exception as error:
                print(f"[AUTOMATION ESP ERROR] ESP{esp_num}: {format_worker_error(error)}")

    def _run(self):
        while not self._stop_event.is_set():
            self._wake_event.wait(timeout=AUTOMATION_IDLE_SLEEP_SECONDS)
            self._wake_event.clear()


class MainTankSensorWorker:
    def __init__(self):
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run, name="main-tank-worker", daemon=True)
        self._session = build_http_session()
        self._status = ConnectionStatusTracker("MAIN TANK SENSOR")
        self._error_backoff_until = 0.0
        self._last_printed_value = None

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop_event.set()
        self._thread.join(timeout=3)
        self._session.close()

    def _run(self):
        while not self._stop_event.is_set():
            now = time.time()
            if now < self._error_backoff_until:
                self._stop_event.wait(self._error_backoff_until - now)
                continue

            try:
                tank_level = self._fetch_tank_level()
                measured_at = time.time()
                update_current(
                    {
                        "state": {
                            "tank": tank_level,
                            "tankSensor": {
                                "value": tank_level,
                                "online": True,
                                "lastUpdatedAt": measured_at,
                                "error": "",
                            },
                            "mainTankDataAt": measured_at,
                        }
                    }
                )
                self._error_backoff_until = 0.0
                self._status.report_success("sensor", MAIN_TANK_SENSOR_URL)
                if (
                    self._last_printed_value is None
                    or abs(tank_level - self._last_printed_value) >= MAIN_TANK_SENSOR_PRINT_DELTA
                ):
                    print(f"Tank Level: {tank_level:.1f}")
                    self._last_printed_value = tank_level
                try:
                    enqueue_main_tank_sync(source="main-tank-sensor")
                except Exception as error:
                    print(f"[MAIN TANK RELAY ERROR] {format_worker_error(error)}")
            except Exception as error:
                self._status.report_failure("sensor", f"{MAIN_TANK_SENSOR_URL}: {format_worker_error(error)}")
                self._error_backoff_until = time.time() + MAIN_TANK_SENSOR_ERROR_BACKOFF_SECONDS
                with STATE_LOCK:
                    current_tank = number_from_value(CURRENT["state"].get("tank"), 0.0)
                update_current(
                    {
                        "state": {
                            "tankSensor": {
                                "value": current_tank,
                                "online": False,
                                "lastUpdatedAt": None,
                                "error": format_worker_error(error),
                            }
                        }
                    }
                )
            self._stop_event.wait(MAIN_TANK_POLL_INTERVAL_SECONDS)

    def _fetch_tank_level(self):
        response = self._session.get(MAIN_TANK_SENSOR_URL, timeout=MAIN_TANK_SENSOR_TIMEOUT_SECONDS)
        response.raise_for_status()
        tank_level = parse_tank_level(response.text)
        return round(max(0.0, min(100.0, tank_level)), 1)


def parse_fire_alert_value(raw_value):
    text = str(raw_value or "").strip()
    normalized = text.lower()
    normalized = re.sub(r"\s+", " ", normalized)

    if normalized in FIRE_ALERT_TRUE_VALUES:
        return True
    if normalized in FIRE_ALERT_FALSE_VALUES:
        return False
    if any(phrase in normalized for phrase in FIRE_ALERT_FALSE_PHRASES):
        return False
    if any(phrase in normalized for phrase in FIRE_ALERT_TRUE_PHRASES):
        return True

    number_match = re.search(r"-?\d+(?:\.\d+)?", normalized)
    if number_match is not None:
        return float(number_match.group(0)) != 0.0

    raise ValueError(f"Could not parse fire sensor value from '{text}'")


class FarmhouseFireSensorWorker:
    def __init__(self):
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run, name="farmhouse-fire-worker", daemon=True)
        self._session = build_http_session()
        self._status = ConnectionStatusTracker("FARMHOUSE FIRE SENSOR")
        self._last_printed_value = None
        self._read_lock = threading.Lock()
        self._error_backoff_until = 0.0

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop_event.set()
        self._thread.join(timeout=3)
        self._session.close()

    def read_once(self):
        fire_alert, raw_value, measured_at = self._fetch_fire_alert()

        update_current(
            {
                "state": {
                    "gh": {
                        "fireAlert": fire_alert,
                        "fireSensor": {
                            "detected": fire_alert,
                            "online": True,
                            "lastUpdatedAt": measured_at,
                            "raw": raw_value,
                            "error": "",
                        },
                        "fireDataAt": measured_at,
                    }
                }
            },
            connected=False,
            last_error="",
        )
        self._error_backoff_until = 0.0
        self._status.report_success("sensor", FARMHOUSE_FIRE_SENSOR_URL)

        if self._last_printed_value is None or self._last_printed_value != fire_alert:
            print(f"Fire: {raw_value} ({'ALERT' if fire_alert else 'safe'})")
            self._last_printed_value = fire_alert

        return {
            "fireAlert": fire_alert,
            "raw": raw_value,
            "url": FARMHOUSE_FIRE_SENSOR_URL,
            "measuredAt": measured_at,
        }

    def _fetch_fire_alert(self):
        with self._read_lock:
            response = self._session.get(
                FARMHOUSE_FIRE_SENSOR_URL,
                timeout=FARMHOUSE_FIRE_SENSOR_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            raw_value = response.text.strip()
            fire_alert = parse_fire_alert_value(raw_value)
            measured_at = time.time()
            return fire_alert, raw_value, measured_at

    def _run(self):
        while not self._stop_event.is_set():
            now = time.time()
            if now < self._error_backoff_until:
                self._stop_event.wait(self._error_backoff_until - now)
                continue

            try:
                self.read_once()
            except Exception as error:
                self._status.report_failure(
                    "sensor",
                    f"{FARMHOUSE_FIRE_SENSOR_URL}: {format_worker_error(error)}",
                )
                self._error_backoff_until = time.time() + FARMHOUSE_FIRE_SENSOR_ERROR_BACKOFF_SECONDS
                update_current(
                    {
                        "state": {
                            "gh": {
                                "fireSensor": {
                                    "detected": False,
                                    "online": False,
                                    "lastUpdatedAt": None,
                                    "raw": "",
                                    "error": format_worker_error(error),
                                }
                            }
                        }
                    },
                    connected=False,
                    last_error="",
                )
            self._stop_event.wait(FARMHOUSE_FIRE_POLL_INTERVAL_SECONDS)


plc_worker = PLCCommandWorker()
esp_worker = ESPCommandWorker()
control_worker = ControlLoopWorker(plc_worker, esp_worker)
automation_worker = AutomationCycleWorker()
main_tank_sensor_worker = MainTankSensorWorker()
farmhouse_fire_sensor_worker = FarmhouseFireSensorWorker()


def parse_tank_level(raw_value):
    if isinstance(raw_value, (int, float)):
        return float(raw_value)

    if raw_value is None:
        raise ValueError("Main tank sensor returned no data")

    text = str(raw_value).strip()
    if not text:
        raise ValueError("Main tank sensor returned an empty response")

    try:
        return float(text)
    except ValueError:
        match = re.search(r"-?\d+(?:\.\d+)?", text)
        if match is None:
            raise ValueError(f"Could not parse tank level from '{text}'")
        return float(match.group(0))


def parse_distance_value(raw_value):
    if isinstance(raw_value, (int, float)):
        return float(raw_value)

    if raw_value is None:
        raise ValueError("Distance sensor returned no data")

    text = str(raw_value).strip()
    if not text:
        raise ValueError("Distance sensor returned an empty response")

    try:
        return float(text)
    except ValueError:
        match = re.search(r"-?\d+(?:\.\d+)?", text)
        if match is None:
            raise ValueError(f"Could not parse distance from '{text}'")
        return float(match.group(0))


def get_dashboard_snapshot():
    with STATE_LOCK:
        return deepcopy(CURRENT)


def get_ui_state():
    with STATE_LOCK:
        return deepcopy(CURRENT["state"])


def get_field_values(field_key):
    with STATE_LOCK:
        return deepcopy(CURRENT["state"][field_key])


def get_all_variables():
    with STATE_LOCK:
        state = CURRENT["state"]
        return {
            "tank": state["tank"],
            "pumping": state["pumping"],
            "flowRate": state["flowRate"],
            "ghTemp": state["gh"]["temp"],
            "ghHumidity": state["gh"]["humidity"],
            "ghFireAlert": state["gh"].get("fireAlert", False),
            "f1Moisture": state["f1"]["moisture"],
            "f1Ph": state["f1"]["ph"],
            "f1Wl": state["f1"]["wl"],
            "f1N": state["f1"]["n"],
            "f1P": state["f1"]["p"],
            "f1K": state["f1"]["k"],
            "f1Irrigation": state["f1"]["irrigation"],
            "f1Drain": state["f1"]["drain"],
            "f1Acid": state["f1"]["acid"],
            "f1Base": state["f1"]["base"],
            "f2Moisture": state["f2"]["moisture"],
            "f2Ph": state["f2"]["ph"],
            "f2Wl": state["f2"]["wl"],
            "f2N": state["f2"]["n"],
            "f2P": state["f2"]["p"],
            "f2K": state["f2"]["k"],
            "f2Irrigation": state["f2"]["irrigation"],
            "f2Drain": state["f2"]["drain"],
            "f2Acid": state["f2"]["acid"],
            "f2Base": state["f2"]["base"],
            "f3Moisture": state["f3"]["moisture"],
            "f3Ph": state["f3"]["ph"],
            "f3Wl": state["f3"]["wl"],
            "f3N": state["f3"]["n"],
            "f3P": state["f3"]["p"],
            "f3K": state["f3"]["k"],
            "f3Irrigation": state["f3"]["irrigation"],
            "f3Drain": state["f3"]["drain"],
            "f3Acid": state["f3"]["acid"],
            "f3Base": state["f3"]["base"],
        }


dashboard_state = CURRENT


# Tracks per-field state needed for the yellow light.
# - "drain_was_on": whether the drain was running on the previous tick.
# - "post_drain_recovery": True after a drain finishes; stays True through the
#   following irrigation cycle and is cleared when irrigation turns off.
_yellow_tracker = {
    "f1": {"drain_was_on": False, "post_drain_recovery": False},
    "f2": {"drain_was_on": False, "post_drain_recovery": False},
    "f3": {"drain_was_on": False, "post_drain_recovery": False},
}
_yellow_tracker_lock = threading.Lock()


def _update_yellow_tracker(field_key, drain_on, irrigation_on):
    """Update post-drain recovery flag and return whether yellow should be on
    due to a post-drain irrigation cycle."""
    with _yellow_tracker_lock:
        tracker = _yellow_tracker[field_key]
        # Drain just finished -> mark recovery so the next irrigation lights up.
        if tracker["drain_was_on"] and not drain_on:
            tracker["post_drain_recovery"] = True
        tracker["drain_was_on"] = drain_on
        # Irrigation turned off -> clear the recovery flag so future irrigation
        # cycles (not preceded by a drain) do NOT light the yellow LED.
        if not irrigation_on:
            tracker["post_drain_recovery"] = False
        return tracker["post_drain_recovery"] and irrigation_on


def get_esp_payload_from_state(esp_num):
    state = get_ui_state()

    if esp_num == 1:
        field = state["f1"]
        irrigation_on = bool(field["irrigation"])
        drain_on = bool(field["drain"])
        ph_value = number_from_value(field["ph"], 7.0)
        # Yellow light turns ON when:
        #  - pH is out of safe range (<4 or >10), OR
        #  - irrigation is running as part of a post-drain recovery cycle
        #    (i.e. drain just finished and pH was reset). Regular irrigation
        #    cycles (not preceded by a drain) do NOT turn the yellow light on.
        ph_alert = ph_value < 4 or ph_value > 10
        ph = number_from_value(field["ph"], 7.0)
        is_ph_fix_drain = drain_on and (ph < 4 or ph > 10)
        post_drain_irrigation = _update_yellow_tracker("f1", is_ph_fix_drain, irrigation_on)
        yellow_on = ph_alert or post_drain_irrigation
        return {
            "level": round(field["wl"], 1),
            "pump": "on" if irrigation_on else "off",
            "ph": round(field["ph"], 2),
            "moisture": round(field["moisture"], 1),
            "status": "drain" if field["drain"] else "irrigation",
            "yellow": "on" if yellow_on else "off",
        }

    if esp_num == 2:
        field = state["f2"]
        irrigation_on = bool(field["irrigation"])
        drain_on = bool(field["drain"])
        ph_value = number_from_value(field["ph"], 7.0)
        ph_alert = ph_value < 4 or ph_value > 10
        ph = number_from_value(field["ph"], 7.0)
        is_ph_fix_drain = drain_on and (ph < 4 or ph > 10)
        post_drain_irrigation = _update_yellow_tracker("f2", is_ph_fix_drain, irrigation_on)
        yellow_on = ph_alert or post_drain_irrigation
        return {
            "level": round(field["wl"], 1),
            "pump": "on" if irrigation_on else "off",
            "ph": round(field["ph"], 2),
            "moisture": round(field["moisture"], 1),
            "status": "drain" if field["drain"] else "irrigation",
            "yellow": "on" if yellow_on else "off",
        }

    if esp_num == 3:
        field = state["f3"]
        irrigation_on = bool(field["irrigation"])
        drain_on = bool(field["drain"])
        ph_value = number_from_value(field["ph"], 7.0)
        ph_alert = ph_value < 4 or ph_value > 10
        ph = number_from_value(field["ph"], 7.0)
        is_ph_fix_drain = drain_on and (ph < 4 or ph > 10)
        post_drain_irrigation = _update_yellow_tracker("f3", is_ph_fix_drain, irrigation_on)
        yellow_on = ph_alert or post_drain_irrigation
        return {
            "level": round(field["wl"], 1),
            "pump": "on" if irrigation_on else "off",
            "ph": round(field["ph"], 2),
            "moisture": round(field["moisture"], 1),
            "status": "drain" if field["drain"] else "irrigation",
            "yellow": "on" if yellow_on else "off",
        }

    if esp_num == 4:
        return {
            "temp": round(number_from_value(state["gh"]["temp"], 0.0), 1),
            "humid": round(number_from_value(state["gh"]["humidity"], 0.0), 1),
            "fan": "on" if state["gh"].get("fanOn") else "off",
        }

    raise ValueError("Invalid ESP number")


def build_manual_esp_payload(esp_num, level, pump, ph, moisture):
    if esp_num == 4:
        fan = str(pump).lower()
        if fan not in {"on", "off"}:
            raise ValueError("Fan must be 'on' or 'off'")
        return {
            "temp": round(number_from_value(level, 0.0), 1),
            "humid": round(number_from_value(ph, 0.0), 1),
            "fan": fan,
        }

    pump_value = str(pump).lower()
    if pump_value not in {"on", "off"}:
        raise ValueError("Pump must be 'on' or 'off'")
    ph_float = float(ph)
    ph_alert = ph_float < 4 or ph_float > 10
    return {
        "level": float(level),
        "pump": pump_value,
        "ph": ph_float,
        "moisture": float(moisture),
        "status": "irrigation",
        # Manual sends have no drain context, so yellow only reflects pH alert.
        "yellow": "on" if ph_alert else "off",
    }


def send_to_esp(esp_num, level, pump, ph, moisture):
    payload = build_manual_esp_payload(esp_num, level, pump, ph, moisture)
    return esp_worker.enqueue_payload(esp_num, payload, source="manual-send", wait=True)


def send_current_ui_values(esp_num):
    return esp_worker.enqueue_sync(esp_num, source="ui-sync", wait=True)


def print_selected_values():
    values = get_all_variables()
    print("\nCurrent values")
    print(f"  tank: {values['tank']}")
    print(f"  pumping: {values['pumping']}")
    print(f"  ghTemp: {values['ghTemp']}")
    print(f"  ghHumidity: {values['ghHumidity']}")
    print(f"  ghFireAlert: {values['ghFireAlert']}")
    print(f"  f1Moisture: {values['f1Moisture']} | f1Ph: {values['f1Ph']}")
    print(f"  f2Moisture: {values['f2Moisture']} | f2Ph: {values['f2Ph']}")
    print(f"  f3Moisture: {values['f3Moisture']} | f3Ph: {values['f3Ph']}")


def print_formatted_field(field_key):
    field = get_field_values(field_key)
    print(f"\n{'-'*35}")
    print(f"{field_key.upper()} FIELD         | VALUES")
    print(f"{'-'*35}")
    for key, value in field.items():
        print(f"{key:<15} | {value}")
    print(f"{'-'*35}\n")


def send_relay_command(command):
    if modbus_control is None:
        if MODBUS_IMPORT_ERROR is not None:
            raise RuntimeError(f"Agri_iot integration unavailable: {MODBUS_IMPORT_ERROR}")
        raise RuntimeError("Agri_iot integration unavailable")
    return modbus_control(command)


def sync_main_tank_relay():
    return queue_main_tank_relay(source="main-tank-sync", wait=True)


def sync_field_relay(field_key):
    if field_key not in {"f1", "f2", "f3"}:
        raise ValueError("Invalid field for relay sync")
    with STATE_LOCK:
        irrigation_on = bool(CURRENT["state"][field_key]["irrigation"])
    return plc_worker.enqueue(RELAY_COMMANDS[field_key][irrigation_on], source=f"{field_key}-sync", wait=True)


def enqueue_main_tank_sync(source="control"):
    return queue_main_tank_relay(source=source, wait=False)


def enqueue_field_relay_sync(field_key, source="control"):
    if field_key not in {"f1", "f2", "f3"}:
        raise ValueError("Invalid field for relay sync")
    with STATE_LOCK:
        irrigation_on = bool(CURRENT["state"][field_key]["irrigation"])
    return plc_worker.enqueue(RELAY_COMMANDS[field_key][irrigation_on], source=source, wait=False)


def send_all_plc_motors_off(source="shutdown"):
    off_commands = (
        ("main_tank", RELAY_COMMANDS["main_tank"][False]),
        ("f1", RELAY_COMMANDS["f1"][False]),
        ("f2", RELAY_COMMANDS["f2"][False]),
        ("f3", RELAY_COMMANDS["f3"][False]),
    )
    results = []
    errors = []

    with STATE_LOCK:
        CURRENT["state"]["pumping"] = False
        CURRENT["state"]["mainTankManualOverride"] = False
        for field_key in ("f1", "f2", "f3"):
            CURRENT["state"][field_key]["irrigation"] = False

    with MAIN_TANK_RELAY_COMMAND_LOCK:
        global MAIN_TANK_LAST_REQUESTED_STATE
        MAIN_TANK_LAST_REQUESTED_STATE = False

    for relay_name, command in off_commands:
        try:
            result = plc_worker.enqueue(command, source=source, wait=True)
            results.append({
                "relay": relay_name,
                "command": command,
                "result": result,
            })
        except Exception as error:
            errors.append({
                "relay": relay_name,
                "command": command,
                "error": str(error),
            })

    return {
        "results": results,
        "errors": errors,
    }


def enqueue_esp_sync(esp_num, source="control"):
    return esp_worker.enqueue_sync(esp_num, source=source, wait=False)


def set_main_tank_manual_override(pumping, source="control", wait=False):
    requested_pumping = bool_from_value(pumping)
    update_current(
        {
            "state": {
                "pumping": requested_pumping,
                "mainTankManualOverride": requested_pumping,
            }
        },
        connected=False,
        last_error="",
    )
    return queue_main_tank_relay(source=source, wait=wait, force=True)


def sync_main_tank_state(
    tank=None,
    pumping=None,
    manual_override=None,
    manual_override_provided=False,
    source="control",
    wait=False,
):
    state_patch = {}

    if tank is not None:
        with STATE_LOCK:
            current_tank = number_from_value(CURRENT["state"].get("tank"), 0.0)
        state_patch["tank"] = number_from_value(tank, current_tank)
        state_patch["mainTankDataAt"] = time.time()

    if pumping is not None:
        with STATE_LOCK:
            current_pumping = bool(CURRENT["state"].get("pumping"))
        state_patch["pumping"] = bool_from_value(pumping) if pumping is not None else current_pumping

    if manual_override_provided:
        state_patch["mainTankManualOverride"] = manual_override

    update_current({"state": state_patch}, connected=False, last_error="")
    return queue_main_tank_relay(source=source, wait=wait, force=manual_override_provided)


def build_patch_from_command(path_tokens, raw_value):
    with STATE_LOCK:
        state = deepcopy(CURRENT["state"])

    if not path_tokens:
        raise ValueError("Missing target path")

    if path_tokens[0] in {"tank", "pumping", "flowRate"}:
        key = path_tokens[0]
        current_value = state[key]
        value = bool_from_value(raw_value) if isinstance(current_value, bool) else number_from_value(raw_value, current_value)
        return {"state": {key: value}}

    if path_tokens[0] == "gh" and len(path_tokens) == 2:
        key = path_tokens[1]
        if key not in {"temp", "humidity", "fireAlert", "fanOn"}:
            raise ValueError("Invalid greenhouse key")
        current_value = state["gh"][key]
        value = bool_from_value(raw_value) if isinstance(current_value, bool) else number_from_value(raw_value, current_value)
        return {"state": {"gh": {key: value}}}

    if path_tokens[0] in {"f1", "f2", "f3"} and len(path_tokens) == 2:
        field_key = path_tokens[0]
        key = path_tokens[1]
        if key not in {"moisture", "ph", "wl", "n", "p", "k", "irrigation", "drain", "acid", "base"}:
            raise ValueError("Invalid field key")
        current_value = state[field_key][key]
        value = bool_from_value(raw_value) if isinstance(current_value, bool) else number_from_value(raw_value, current_value)
        field_patch = {key: value}
        if key in {"moisture", "wl", "ph"}:
            preferred_source = "moisture" if key == "moisture" else "wl" if key == "wl" else "ph"
            field_patch = normalize_linked_field_values(field_patch, preferred_source=preferred_source, field_key=field_key)
        return {"state": {field_key: field_patch}}

    raise ValueError("Unsupported path")


def handle_terminal_command(command):
    parts = command.strip().split()
    if not parts:
        return

    action = parts[0].lower()

    if action == "help":
        print("\nCommands")
        print("  show")
        print("  show f1")
        print("  show f2")
        print("  show f3")
        print("  set tank 85")
        print("  set pumping true")
        print("  set gh temp 32")
        print("  set f1 moisture 55")
        print("  set f2 ph 6.8")
        print("  set f3 irrigation true")
        print("  send 1 75 on 7 45")
        print("  push 1")
        print("  push 2")
        print("  push 3")
        print("  push 4")
        print("  exit")
        return

    if action == "show":
        if len(parts) == 1:
            print_selected_values()
            return
        if len(parts) == 2 and parts[1] in {"f1", "f2", "f3"}:
            print_formatted_field(parts[1])
            return
        raise ValueError("Use 'show' or 'show f1'")

    if action == "set":
        if len(parts) < 3:
            raise ValueError("Use 'set <path> <value>'")
        path_tokens = parts[1:-1]
        raw_value = parts[-1]
        if path_tokens and path_tokens[0] == "pumping":
            requested_pumping = bool_from_value(raw_value)
        else:
            patch = build_patch_from_command(path_tokens, raw_value)
            update_current(patch, connected=False, last_error="")
        relay_target = path_tokens[0] if path_tokens and path_tokens[0] in {"f1", "f2", "f3"} else None
        if relay_target is not None:
            enqueue_field_relay_sync(relay_target, source="terminal")
            enqueue_main_tank_sync(source="terminal")
        if path_tokens and path_tokens[0] == "pumping":
            set_main_tank_manual_override(requested_pumping, source="terminal", wait=False)
        print("\nValue updated from terminal")
        print_selected_values()
        return

    if action == "send":
        if len(parts) != 6:
            raise ValueError("Use 'send <esp> <level> <pump> <ph> <moisture>'")

        esp_num = int(parts[1])
        level = int(parts[2])
        pump = parts[3]
        ph = int(parts[4])
        moisture = int(parts[5])
        result = send_to_esp(esp_num, level, pump, ph, moisture)
        print(f"Queued manual send completed for ESP{esp_num}: {result['status_code']}")
        return

    if action == "push":
        if len(parts) != 2:
            raise ValueError("Use 'push <esp>'")

        esp_num = int(parts[1])
        payload = get_esp_payload_from_state(esp_num)
        print(f"\nUsing backend values for ESP{esp_num}: {payload}")
        result = send_current_ui_values(esp_num)
        print(f"Backend sync completed for ESP{esp_num}: {result['status_code']}")
        return

    if action in {"exit", "quit"}:
        raise SystemExit

    raise ValueError("Unknown command. Type 'help'")


class UIBackendHandler(Handler):
    FIELD_TO_ESP = {
        "f1": 1,
        "f2": 2,
        "f3": 3,
    }

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/status":
            self.send_json(get_dashboard_snapshot())
            return

        if parsed.path == "/api/distance":
            try:
                response = distance_http_session.get(
                    ESP32_DISTANCE_URL,
                    timeout=ESP32_DISTANCE_TIMEOUT_SECONDS,
                )
                response.raise_for_status()
                distance_cm = parse_distance_value(response.text)
                body = f"{distance_cm:.2f}".encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.end_headers()
                self.wfile.write(body)
            except Exception as error:
                self.send_json({"error": str(error)}, status=502)
            return

        if parsed.path == "/api/fire":
            try:
                sensor_payload = farmhouse_fire_sensor_worker.read_once()
                self.send_json({
                    "ok": True,
                    "fire": sensor_payload,
                    "dashboard": CURRENT,
                })
            except Exception as error:
                update_current(
                    {
                        "state": {
                            "gh": {
                                "fireSensor": {
                                    "online": False,
                                    "lastUpdatedAt": time.time(),
                                    "raw": "",
                                    "error": format_worker_error(error),
                                }
                            }
                        }
                    },
                    connected=False,
                    last_error="",
                )
                self.send_json({
                    "ok": False,
                    "error": str(error),
                    "dashboard": CURRENT,
                }, status=502)
            return

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/shutdown":
            print("[API SHUTDOWN] Shutdown endpoint called")
            if os.name != "posix":
                print("[API SHUTDOWN] Not running on POSIX system")
                self.send_json({"error": "System shutdown is only supported when the backend is running on Raspberry Pi/Linux."}, status=501)
                return

            shutdown_command, shutdown_error = get_shutdown_command()
            print(f"[API SHUTDOWN] get_shutdown_command returned: command={shutdown_command}, error={shutdown_error}")
            
            if shutdown_command is None:
                print(f"[API SHUTDOWN] Shutdown command is None, returning error to client")
                self.send_json({"error": shutdown_error}, status=503)
                return

            print("[API SHUTDOWN] Starting shutdown sequence...")
            mark_shutdown_in_progress()
            relay_report = send_all_plc_motors_off(source="shutdown-precheck")
            print(f"[API SHUTDOWN] Motor OFF completed: {relay_report}")
            
            if relay_report["errors"]:
                print(f"[API SHUTDOWN] Motor OFF errors: {relay_report['errors']}")
                self.send_json(
                    {
                        "error": "Failed to send OFF to all PLC motors before shutdown.",
                        "details": relay_report["errors"],
                    },
                    status=502,
                )
                return

            self.send_json(
                {
                    "ok": True,
                    "message": "All PLC motors turned OFF. Raspberry Pi shutdown started.",
                }
            )
            print(f"[API SHUTDOWN] Launching shutdown thread with command: {shutdown_command}")
            # Use daemon=False so the thread can complete the shutdown before process exits
            shutdown_thread = threading.Thread(target=perform_system_shutdown, args=(self.server, shutdown_command), daemon=False)
            shutdown_thread.start()
            return

        if parsed.path == "/api/greenhouse":
            try:
                body = self.read_body()
            except json.JSONDecodeError:
                self.send_json({"error": "Invalid JSON body"}, status=400)
                return

            if not isinstance(body, dict):
                self.send_json({"error": "Invalid greenhouse body"}, status=400)
                return

            incoming = body.get("values") if isinstance(body.get("values"), dict) else body
            current_gh = get_ui_state()["gh"]
            gh_patch = {}

            for key in ("temp", "humidity"):
                if key in incoming:
                    gh_patch[key] = number_from_value(incoming[key], current_gh[key])

            for key in ("fireAlert",):
                if key in incoming:
                    gh_patch[key] = bool_from_value(incoming[key])

            # Always recompute fanOn from temperature only (temp > 25 → ON, temp <= 25 → OFF)
            # Do not accept fanOn from the UI payload to avoid stale coupling
            resolved_temp = gh_patch.get("temp", number_from_value(current_gh.get("temp"), 0.0))
            gh_patch["fanOn"] = resolved_temp > 25.0

            if not gh_patch:
                self.send_json({"error": "No greenhouse values provided"}, status=400)
                return

            update_current({"state": {"gh": gh_patch}}, connected=False, last_error="")

            response_payload = {
                "ok": True,
                "saved": True,
                "greenhouse": CURRENT["state"]["gh"],
                "esp": {
                    "number": 4,
                    "ip": ESP_DEVICES[4],
                    "queued": False,
                },
                "dashboard": CURRENT,
            }

            try:
                payload = get_esp_payload_from_state(4)
                enqueue_esp_sync(4, source="greenhouse-api")
                response_payload["esp"]["queued"] = True
                response_payload["esp"]["payload"] = payload
            except Exception as error:
                response_payload["warning"] = f"Saved locally, but ESP sync failed: {error}"

            self.send_json(response_payload)
            return

        if parsed.path == "/api/main-tank":
            try:
                body = self.read_body()
            except json.JSONDecodeError:
                self.send_json({"error": "Invalid JSON body"}, status=400)
                return

            if not isinstance(body, dict):
                self.send_json({"error": "Invalid main tank body"}, status=400)
                return

            incoming = body.get("values") if isinstance(body.get("values"), dict) else body
            if "pumping" not in incoming and "tank" not in incoming:
                self.send_json({"error": "No main tank values provided"}, status=400)
                return

            requested_tank = None
            if "tank" in incoming:
                with STATE_LOCK:
                    current_tank = number_from_value(CURRENT["state"].get("tank"), 0.0)
                requested_tank = number_from_value(incoming.get("tank"), current_tank)

            requested_pumping = None
            if "pumping" in incoming:
                requested_pumping = bool_from_value(incoming.get("pumping"))

            manual_override_provided = "mainTankManualOverride" in incoming
            manual_override = incoming.get("mainTankManualOverride") if manual_override_provided else None
            if manual_override_provided and manual_override is not None:
                manual_override = bool_from_value(manual_override)

            response_payload = {
                "ok": True,
                "saved": True,
                "mainTank": {
                    "tank": requested_tank,
                    "pumping": requested_pumping,
                    "queued": False,
                },
                "dashboard": CURRENT,
            }

            try:
                sync_main_tank_state(
                    tank=requested_tank,
                    pumping=requested_pumping,
                    manual_override=manual_override,
                    manual_override_provided=manual_override_provided,
                    source="main-tank-api",
                    wait=False,
                )
                response_payload["mainTank"]["queued"] = True
            except Exception as error:
                response_payload["relayWarning"] = f"Saved locally, but relay sync failed: {error}"

            response_payload["dashboard"] = CURRENT
            self.send_json(response_payload)
            return

        if parsed.path == "/api/automation":
            try:
                body = self.read_body()
            except json.JSONDecodeError:
                self.send_json({"error": "Invalid JSON body"}, status=400)
                return

            enabled = bool_from_value((body or {}).get("enabled"))

            try:
                automation_worker.set_enabled(enabled)
            except Exception as error:
                self.send_json(
                    {
                        "error": f"Failed to update automation mode: {error}",
                        "dashboard": CURRENT,
                    },
                    status=500,
                )
                return

            self.send_json({
                "ok": True,
                "automationEnabled": enabled,
                "dashboard": CURRENT,
            })
            return

        if parsed.path.startswith("/api/fields/"):
            field_key = parsed.path.rsplit("/", 1)[-1]
            if field_key not in self.FIELD_TO_ESP:
                self.send_json({"error": "Invalid field"}, status=400)
                return

            try:
                body = self.read_body()
            except json.JSONDecodeError:
                self.send_json({"error": "Invalid JSON body"}, status=400)
                return

            try:
                field_patch, _, metadata = normalize_field_body(field_key, body)
            except ValueError as error:
                self.send_json({"error": str(error)}, status=400)
                return

            update_current(
                {"state": {field_key: field_patch}},
                connected=False,
                last_error="",
                field_metadata={field_key: metadata},
            )
            print_formatted_field(field_key)

            esp_num = self.FIELD_TO_ESP[field_key]
            response_payload = {
                "ok": True,
                "field": field_key,
                "saved": True,
                "esp": [],
                "dashboard": CURRENT,
            }

            try:
                enqueue_field_relay_sync(field_key, source="field-api")
            except Exception as error:
                response_payload["relayWarning"] = f"Saved locally, but relay sync failed: {error}"

            try:
                enqueue_main_tank_sync(source="field-api")
            except Exception as error:
                existing_warning = response_payload.get("relayWarning")
                main_warning = f"Main tank relay sync failed: {error}"
                response_payload["relayWarning"] = f"{existing_warning}; {main_warning}" if existing_warning else main_warning

            esp_errors = []
            for sync_field_key, sync_esp_num in self.FIELD_TO_ESP.items():
                esp_entry = {
                    "field": sync_field_key,
                    "number": sync_esp_num,
                    "ip": ESP_DEVICES[sync_esp_num],
                    "queued": False,
                }
                try:
                    payload = get_esp_payload_from_state(sync_esp_num)
                    enqueue_esp_sync(sync_esp_num, source="field-api")
                    esp_entry["queued"] = True
                    esp_entry["payload"] = payload
                except Exception as error:
                    esp_entry["error"] = str(error)
                    esp_errors.append(f"{sync_field_key}: {error}")

                response_payload["esp"].append(esp_entry)

            if esp_errors:
                response_payload["warning"] = (
                    "Saved locally, but ESP sync failed for: " + "; ".join(esp_errors)
                )

            self.send_json(response_payload)
            return

        super().do_POST()


def observer_loop():
    while True:
        time.sleep(60)


def terminal_loop():
    print("\nType 'help' for terminal commands.")
    print_selected_values()
    while True:
        try:
            command = input("\nbackend> ")
            handle_terminal_command(command)
        except SystemExit:
            print("Stopping terminal input loop.")
            break
        except KeyboardInterrupt:
            print("\nStopping terminal input loop.")
            break
        except Exception as error:
            print(f"Command error: {error}")


def shutdown_backend(server):
    print("\nManual shutdown detected. Resetting backend state to zero and switching irrigation and motor off.")

    automation_worker.stop()
    control_worker.stop()
    main_tank_sensor_worker.stop()
    farmhouse_fire_sensor_worker.stop()

    reset_state_for_shutdown()

    for field_key in ("f1", "f2", "f3"):
        try:
            sync_field_relay(field_key)
        except Exception as error:
            print(f"[SHUTDOWN RELAY ERROR] {field_key.upper()}: {error}")

    try:
        with MAIN_TANK_RELAY_COMMAND_LOCK:
            global MAIN_TANK_LAST_REQUESTED_STATE
            MAIN_TANK_LAST_REQUESTED_STATE = False
        plc_worker.enqueue(RELAY_COMMANDS["main_tank"][False], source="shutdown", wait=True)
    except Exception as error:
        print(f"[SHUTDOWN RELAY ERROR] MAIN TANK MOTOR: {error}")

    for field_key, esp_num in UIBackendHandler.FIELD_TO_ESP.items():
        try:
            send_current_ui_values(esp_num)
        except Exception as error:
            print(f"[SHUTDOWN ESP SYNC ERROR] {field_key.upper()}: {error}")

    esp_worker.stop()
    plc_worker.stop()
    if close_modbus_controller is not None:
        try:
            close_modbus_controller()
        except Exception as error:
            print(f"[PLC CLOSE ERROR] {error}")

    server.server_close()


def perform_system_shutdown(server, shutdown_command):
    try:
        server.shutdown()
    except Exception as error:
        print(f"[SERVER SHUTDOWN ERROR] {error}")

    try:
        shutdown_backend(server)
    except Exception as error:
        print(f"[BACKEND SHUTDOWN ERROR] {error}")

    print("[SYSTEM SHUTDOWN] Waiting 5 seconds before initiating shutdown...")
    time.sleep(SHUTDOWN_DELAY_SECONDS)

    shutdown_success = False
    
    # Try primary shutdown command
    try:
        print(f"[SYSTEM SHUTDOWN] Executing: {' '.join(shutdown_command)}")
        result = subprocess.run(
            shutdown_command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=10,
        )
        print(f"[SYSTEM SHUTDOWN] Command completed with exit code: {result.returncode}")
        if result.stdout:
            print(f"[SYSTEM SHUTDOWN] stdout: {result.stdout}")
        if result.stderr:
            print(f"[SYSTEM SHUTDOWN] stderr: {result.stderr}")
        
        if result.returncode == 0:
            shutdown_success = True
            print("[SYSTEM SHUTDOWN] Primary command succeeded! Waiting 10 seconds for shutdown to complete...")
            time.sleep(10)  # Give the system time to actually shut down
    except subprocess.TimeoutExpired:
        print(f"[SYSTEM SHUTDOWN ERROR] Command timed out after 10 seconds")
    except Exception as error:
        print(f"[SYSTEM SHUTDOWN ERROR] {error}")

    # Fallback: If primary command failed, try alternative methods
    if not shutdown_success:
        print("[SYSTEM SHUTDOWN] Primary command failed, trying alternative shutdown methods...")
        alternatives = [
            ["shutdown", "-h", "0"],  # Alternative shutdown syntax
            ["/sbin/shutdown", "-h", "now"],  # Absolute path
            ["systemctl", "poweroff"],  # Using systemctl
            ["poweroff"],  # Direct poweroff command
        ]
        
        for alt_cmd in alternatives:
            try:
                print(f"[SYSTEM SHUTDOWN] Trying fallback: {' '.join(alt_cmd)}")
                result = subprocess.run(
                    alt_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=5,
                )
                print(f"[SYSTEM SHUTDOWN] Fallback completed with exit code: {result.returncode}")
                if result.returncode == 0:
                    shutdown_success = True
                    print("[SYSTEM SHUTDOWN] Fallback command succeeded! Waiting 10 seconds for shutdown to complete...")
                    time.sleep(10)
                    break
            except Exception as e:
                print(f"[SYSTEM SHUTDOWN] Fallback '{alt_cmd[0]}' failed: {e}")

    if shutdown_success:
        print("[SYSTEM SHUTDOWN] Shutdown command executed successfully")
    else:
        print("[SYSTEM SHUTDOWN] All shutdown attempts failed")

    print("[SYSTEM SHUTDOWN] Exiting process with os._exit(0)")
    os._exit(0)


if __name__ == "__main__":
    print(f"UI backend running on http://127.0.0.1:{PORT}")
    print("Open the dashboard and change the controls. Values will auto-sync here.")
    print("The backend stores the UI values and prints every update in this terminal.")
    print("Access all values in Python with get_ui_state(), get_field_values('f1'), or get_all_variables().")
    print("Use 'send ...' for manual ESP values or 'push <esp>' to send current backend values.")
    try:
        server = ReusableThreadingHTTPServer((HOST, PORT), UIBackendHandler)
    except OSError as error:
        print(f"Could not start backend on port {PORT}: {error}")
        print("Another process is already using this port. Stop the old backend process, then run again.")
        raise SystemExit(1)

    if sys.stdin.isatty():
        threading.Thread(target=terminal_loop, daemon=True).start()
    else:
        print("Interactive terminal commands are disabled because stdin is not attached to a TTY.")

    plc_worker.start()
    esp_worker.start()
    control_worker.start()
    automation_worker.start()
    main_tank_sensor_worker.start()
    farmhouse_fire_sensor_worker.start()
    threading.Thread(target=simulation_loop, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        shutdown_backend(server)
