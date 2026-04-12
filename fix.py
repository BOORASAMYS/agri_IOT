import sys
with open('esp32connect.py', 'r', encoding='utf-8') as f:
    c = f.read()

tar = """def bool_from_value(value):
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
        return fallback"""

c = c.replace(tar, "")
c = c.replace("def enforce_irrigation_rule(state):", tar + "\n\n\ndef enforce_irrigation_rule(state):")

with open('esp32connect.py', 'w', encoding='utf-8') as f:
    f.write(c)

print("Fixed!")
