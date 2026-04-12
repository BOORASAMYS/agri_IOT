import sys

file_path = "d:\\agri_IOT-change\\agri_IOT\\esp32connect.py"
with open(file_path, "r", encoding="utf-8") as f:
    text = f.read()

# Replace set_pump_state
target_pump = """    with STATE_LOCK:
        CURRENT["state"]["pumping"] = pump_on
        CURRENT["state"][field_key]["irrigation"] = pump_on
        CURRENT["connected"] = True
        CURRENT["lastError"] = ""
        save_state()"""
replace_pump = """    with STATE_LOCK:
        CURRENT["state"]["pumping"] = pump_on
        CURRENT["state"][field_key]["irrigation"] = pump_on
        CURRENT["connected"] = True
        CURRENT["lastError"] = ""
        IRRIGATION_END_TIMES[field_key] = None
        save_state()"""
text = text.replace(target_pump, replace_pump)

# Replace update_current
target_update = """def update_current(patch, connected=None, last_error=None):
    with STATE_LOCK:
        merged = enforce_irrigation_rule(deep_merge(CURRENT, patch))
        CURRENT.clear()
        CURRENT.update(merged)
        if connected is not None:
            CURRENT["connected"] = connected
        if last_error is not None:
            CURRENT["lastError"] = last_error
        CURRENT["lastUpdated"] = __import__("datetime").datetime.now().isoformat(timespec="seconds")
        save_state()"""

replace_update = """def update_current(patch, connected=None, last_error=None):
    with STATE_LOCK:
        old_irrigations = {k: CURRENT["state"].get(k, {}).get("irrigation", False) for k in ("f1", "f2", "f3")}
        
        merged = enforce_irrigation_rule(deep_merge(CURRENT, patch))
        
        for field_key in ("f1", "f2", "f3"):
            new_irrigation = merged["state"][field_key]["irrigation"]
            old_irrigation = old_irrigations[field_key]
            
            if new_irrigation and not old_irrigation:
                if merged["state"][field_key]["moisture"] < IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD:
                    IRRIGATION_END_TIMES[field_key] = __import__('time').time() + 30.0
                else:
                    IRRIGATION_END_TIMES[field_key] = None

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
        __import__('time').sleep(1)
        with STATE_LOCK:
            dirty = False
            for field_key in ("f1", "f2", "f3"):
                field = CURRENT.get("state", {}).get(field_key)
                if not field: continue
                
                # Auto shutoff timer
                if field.get("irrigation") and IRRIGATION_END_TIMES.get(field_key) is not None:
                    if __import__('time').time() >= IRRIGATION_END_TIMES[field_key]:
                        field["irrigation"] = False
                        IRRIGATION_END_TIMES[field_key] = None
                        dirty = True
                
                # Dynamics
                if field.get("irrigation"):
                    if field.get("wl", 0) < 30.0:
                        field["wl"] = round(min(30.0, field.get("wl", 0) + 0.5), 1)
                        dirty = True
                    if field.get("moisture", 0) < 100.0:
                        field["moisture"] = round(min(100.0, field.get("moisture", 0) + 1.0), 1)
                        dirty = True
                else:
                    if field.get("wl", 0) > 0.0:
                        field["wl"] = round(max(0.0, field.get("wl", 0) - 0.1), 1)
                        dirty = True
                    if field.get("moisture", 0) > 0.0:
                        field["moisture"] = round(max(0.0, field.get("moisture", 0) - 0.2), 1)
                        dirty = True
                        
                # Trigger timer if moisture dips below threshold outside user intervention
                if not field.get("irrigation") and field.get("moisture", 0) < IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD:
                    field["irrigation"] = True
                    IRRIGATION_END_TIMES[field_key] = __import__('time').time() + 30.0
                    dirty = True
            
            if dirty:
                CURRENT["lastUpdated"] = __import__("datetime").datetime.now().isoformat(timespec="seconds")
                save_state()"""

text = text.replace(target_update, replace_update)

# Replace __main__
target_main = """    print("Open your React dashboard, enter the ESP32 IP, then use the irrigation button.")
    server = ThreadingHTTPServer((HOST, PORT), Handler)"""
replace_main = """    print("Open your React dashboard, enter the ESP32 IP, then use the irrigation button.")
    threading.Thread(target=simulation_loop, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)"""
text = text.replace(target_main, replace_main)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(text)

print("SUCCESS")
