import pymodbus.client  # type: ignore

MODBUS_HOST = "192.168.0.50"
MODBUS_PORT = 502

COMMAND_MAPPING = {
    "r1on": (0, True),
    "r1off": (0, False),
    "r2on": (1, True),
    "r2off": (1, False),
    "r3on": (2, True),
    "r3off": (2, False),
    "r4on": (3, True),
    "r4off": (3, False),
    "ledon": (4, True),
    "ledoff": (4, False),
}

client = pymodbus.client.ModbusTcpClient(MODBUS_HOST, port=MODBUS_PORT)


def ensure_connected():
    if client.is_socket_open():
        return True
    return bool(client.connect())


def control(cmd):
    cmd = cmd.lower().strip()
    if cmd not in COMMAND_MAPPING:
        raise ValueError("Invalid command")

    if not ensure_connected():
        raise ConnectionError(f"Could not connect to Modbus server at {MODBUS_HOST}:{MODBUS_PORT}")

    addr, val = COMMAND_MAPPING[cmd]
    result = client.write_coil(addr, val)
    if getattr(result, "isError", lambda: False)():
        raise RuntimeError(f"Failed to send command: {cmd}")

    print("Sent:", cmd)
    return {"command": cmd, "address": addr, "value": val}


if __name__ == "__main__":
    while True:
        cmd = input("Enter command: ").lower()
        try:
            control(cmd)
        except Exception as error:
            print(error)
