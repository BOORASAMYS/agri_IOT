from copy import deepcopy
from http.server import ThreadingHTTPServer
import json
import sys
import threading
from urllib.parse import urlparse

import requests

from esp32connect import (
    CURRENT,
    HOST,
    PORT,
    STATE_LOCK,
    Handler,
    bool_from_value,
    normalize_field_body,
    number_from_value,
    print_field_update,
    update_current,
    simulation_loop,
)

ESP_DEVICES = {
    1: "192.168.0.10",
    2: "192.168.0.20",
    3: "192.168.0.30",
    4: "192.168.0.40",
}


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


def get_esp_payload_from_state(esp_num):
    state = get_ui_state()

    if esp_num == 1:
        field = state["f1"]
        return {
            "level": round(field["wl"], 1),
            "pump": "on" if field["irrigation"] else "off",
            "ph": round(field["ph"], 2),
            "moisture": round(field["moisture"], 1),
        }

    if esp_num == 2:
        field = state["f2"]
        return {
            "level": round(field["wl"], 1),
            "pump": "on" if field["irrigation"] else "off",
            "ph": round(field["ph"], 2),
            "moisture": round(field["moisture"], 1),
        }

    if esp_num == 3:
        field = state["f3"]
        return {
            "level": round(field["wl"], 1),
            "pump": "on" if field["irrigation"] else "off",
            "ph": round(field["ph"], 2),
            "moisture": round(field["moisture"], 1),
        }

    if esp_num == 4:
        return {
            "level": int(round(state["tank"])),
            "pump": "on" if state["pumping"] else "off",
            "ph": int(round(state["gh"]["temp"])),
            "moisture": int(round(state["gh"]["humidity"])),
        }

    raise ValueError("Invalid ESP number")


def send_to_esp(esp_num, level, pump, ph, moisture):
    if esp_num not in ESP_DEVICES:
        raise ValueError("Invalid ESP number")

    pump = pump.lower()
    if pump not in {"on", "off"}:
        raise ValueError("Pump must be 'on' or 'off'")

    esp_ip = ESP_DEVICES[esp_num]
    url = f"http://{esp_ip}/set?level={level}&pump={pump}&ph={ph}&moisture={moisture}"
    response = requests.get(url, timeout=5)

    print(f"Sent to ESP{esp_num}: {url}")
    print(f"Response: {response.status_code}")
    return response


def send_current_ui_values(esp_num):
    payload = get_esp_payload_from_state(esp_num)
    return send_to_esp(
        esp_num,
        payload["level"],
        payload["pump"],
        payload["ph"],
        payload["moisture"],
    )


def print_selected_values():
    values = get_all_variables()
    print("\nCurrent values")
    print(f"  tank: {values['tank']}")
    print(f"  pumping: {values['pumping']}")
    print(f"  ghTemp: {values['ghTemp']}")
    print(f"  ghHumidity: {values['ghHumidity']}")
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
        return {"state": {field_key: {key: value}}}

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
        patch = build_patch_from_command(path_tokens, raw_value)
        update_current(patch, connected=False, last_error="")
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
        send_to_esp(esp_num, level, pump, ph, moisture)
        return

    if action == "push":
        if len(parts) != 2:
            raise ValueError("Use 'push <esp>'")

        esp_num = int(parts[1])
        payload = get_esp_payload_from_state(esp_num)
        print(f"\nUsing backend values for ESP{esp_num}: {payload}")
        send_current_ui_values(esp_num)
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

    def do_POST(self):
        parsed = urlparse(self.path)

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

            for key in ("fireAlert", "fanOn"):
                if key in incoming:
                    gh_patch[key] = bool_from_value(incoming[key])

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
                    "synced": False,
                },
                "dashboard": CURRENT,
            }

            try:
                payload = get_esp_payload_from_state(4)
                send_current_ui_values(4)
                response_payload["esp"]["synced"] = True
                response_payload["esp"]["payload"] = payload
            except Exception as error:
                response_payload["warning"] = f"Saved locally, but ESP sync failed: {error}"

            self.send_json(response_payload)
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
                field_patch, _ = normalize_field_body(field_key, body)
            except ValueError as error:
                self.send_json({"error": str(error)}, status=400)
                return

            update_current({"state": {field_key: field_patch}}, connected=False, last_error="")
            print_formatted_field(field_key)

            esp_num = self.FIELD_TO_ESP[field_key]
            response_payload = {
                "ok": True,
                "field": field_key,
                "saved": True,
                "esp": {
                    "number": esp_num,
                    "ip": ESP_DEVICES[esp_num],
                    "synced": False,
                },
                "dashboard": CURRENT,
            }

            try:
                payload = get_esp_payload_from_state(esp_num)
                send_current_ui_values(esp_num)
                response_payload["esp"]["synced"] = True
                response_payload["esp"]["payload"] = payload
            except Exception as error:
                response_payload["warning"] = f"Saved locally, but ESP sync failed: {error}"

            self.send_json(response_payload)
            return

        super().do_POST()


def observer_loop():
    last_irrigation = {"f1": False, "f2": False, "f3": False}
    while True:
        __import__("time").sleep(1)
        changes = []
        with STATE_LOCK:
            for k in ("f1", "f2", "f3"):
                curr = CURRENT["state"][k]["irrigation"]
                if last_irrigation[k] != curr:
                    changes.append((k, curr))
                last_irrigation[k] = curr

        for k, is_running in changes:
            if is_running:
                print(f"\n[AUTO-IRRIGATION] {k.upper()} started because an automatic threshold was crossed.")
            else:
                print(f"\n[AUTO-SHUTOFF] {k.upper()} stopped after reaching 60% moisture.")
            try:
                send_current_ui_values(UIBackendHandler.FIELD_TO_ESP[k])
            except Exception as error:
                print(f"[ESP SYNC ERROR] {k.upper()}: {error}")
            print_formatted_field(k)


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


if __name__ == "__main__":
    print(f"UI backend running on http://127.0.0.1:{PORT}")
    print("Open the dashboard and change the controls. Values will auto-sync here.")
    print("The backend stores the UI values and prints every update in this terminal.")
    print("Access all values in Python with get_ui_state(), get_field_values('f1'), or get_all_variables().")
    print("Use 'send ...' for manual ESP values or 'push <esp>' to send current backend values.")
    try:
        server = ThreadingHTTPServer((HOST, PORT), UIBackendHandler)
    except OSError as error:
        print(f"Could not start backend on port {PORT}: {error}")
        print("Another process is already using this port. Stop the old backend process, then run again.")
        raise SystemExit(1)

    if sys.stdin.isatty():
        threading.Thread(target=terminal_loop, daemon=True).start()
    else:
        print("Interactive terminal commands are disabled because stdin is not attached to a TTY.")

    threading.Thread(target=simulation_loop, daemon=True).start()
    threading.Thread(target=observer_loop, daemon=True).start()

    server.serve_forever()
