import threading
import time

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

class PLCController:
    def __init__(
        self,
        host=MODBUS_HOST,
        port=MODBUS_PORT,
        reconnect_delay=2.0,
        operation_timeout=3.0,
    ):
        self.host = host
        self.port = port
        self.reconnect_delay = reconnect_delay
        self.operation_timeout = operation_timeout
        self._client = None
        self._lock = threading.Lock()
        self._last_connect_attempt = 0.0

    def _create_client(self):
        return pymodbus.client.ModbusTcpClient(
            self.host,
            port=self.port,
            timeout=self.operation_timeout,
        )

    def _close_unlocked(self):
        if self._client is None:
            return
        try:
            self._client.close()
        except Exception:
            pass
        finally:
            self._client = None

    def close(self):
        with self._lock:
            self._close_unlocked()

    def ensure_connected(self, force_reconnect=False):
        with self._lock:
            if force_reconnect:
                self._close_unlocked()

            if self._client is not None and self._client.is_socket_open():
                return True

            now = time.time()
            if now - self._last_connect_attempt < self.reconnect_delay:
                return False

            self._last_connect_attempt = now
            self._close_unlocked()
            self._client = self._create_client()
            return bool(self._client.connect())

    def control(self, cmd):
        normalized_cmd = cmd.lower().strip()
        if normalized_cmd not in COMMAND_MAPPING:
            raise ValueError("Invalid command")

        addr, val = COMMAND_MAPPING[normalized_cmd]
        last_error = None

        for attempt in range(2):
            if not self.ensure_connected(force_reconnect=attempt > 0):
                last_error = ConnectionError(
                    f"Could not connect to Modbus server at {self.host}:{self.port}"
                )
                continue

            with self._lock:
                try:
                    result = self._client.write_coil(addr, val)
                except Exception as error:
                    last_error = error
                    self._close_unlocked()
                    continue

            if getattr(result, "isError", lambda: False)():
                last_error = RuntimeError(f"Failed to send command: {normalized_cmd}")
                self.close()
                continue

            print("Sent:", normalized_cmd)
            return {"command": normalized_cmd, "address": addr, "value": val}

        if last_error is not None:
            raise last_error
        raise RuntimeError("Unknown PLC communication failure")


controller = PLCController()


def ensure_connected(force_reconnect=False):
    return controller.ensure_connected(force_reconnect=force_reconnect)


def control(cmd):
    return controller.control(cmd)


def close():
    controller.close()


if __name__ == "__main__":
    while True:
        cmd = input("Enter command: ").lower()
        try:
            control(cmd)
        except Exception as error:
            print(error)
