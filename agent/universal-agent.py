#!/usr/bin/env python3
"""
CyberVPS Space Station - Universal Self-Healing Cross-Platform Host Agent
Universal Device Intelligence, Neofetch System Discovery & Tailscale-Style Admin
Zero external pip dependencies required - runs on pure Python 3 standard library.
"""

import os
import sys
import time
import json
import socket
import select
import random
import signal
import platform
import threading
import subprocess
import base64
import urllib.request
import urllib.error
import shutil
import stat
import csv
import io
import ssl
import struct
import urllib.parse

# Guard against None stdio streams on Windows (e.g. under pythonw or windowless subsystems)
if sys.stdout is None:
    try:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    except Exception:
        pass
if sys.stderr is None:
    try:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")
    except Exception:
        pass

try:
    import msvcrt
except ImportError:
    msvcrt = None

try:
    import ctypes
    from ctypes import wintypes
except Exception:
    ctypes = None
    wintypes = None

try:
    import winreg
except ImportError:
    winreg = None

try:
    import psutil
except ImportError:
    psutil = None

# Ensure unbuffered stdio for background logs & safe headless fallback
log_file_env = os.environ.get("CYBERVPS_LOG_FILE")
if log_file_env:
    try:
        os.makedirs(os.path.dirname(os.path.abspath(log_file_env)), exist_ok=True)
        _fp = open(log_file_env, "a", encoding="utf-8", buffering=1)
        sys.stdout = _fp
        sys.stderr = _fp
    except Exception:
        pass

if sys.stdout is None:
    try:
        sys.stdout = open(os.devnull, "w")
    except Exception:
        pass
if sys.stderr is None:
    try:
        sys.stderr = open(os.devnull, "w")
    except Exception:
        pass

if sys.version_info >= (3, 7):
    try:
        if sys.stdout and hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(line_buffering=True)
        if sys.stderr and hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(line_buffering=True)
    except Exception:
        pass

PROTOCOL_VERSION = "1.0.0"


class ConPTYTerminal:
    def __init__(self, session_id, cols=80, rows=24, shell_cmd=None, on_output=None, on_exit=None):
        self.session_id = session_id
        self.cols = int(cols)
        self.rows = int(rows)
        self.on_output = on_output
        self.on_exit = on_exit
        self.hpcon = None
        self.h_proc = None
        self.pid = 0
        self.w_in = None
        self.r_out = None
        self.running = True
        self._start(shell_cmd)

    def _start(self, shell_cmd):
        if platform.system() != "Windows" or not ctypes or not msvcrt:
            raise NotImplementedError("ConPTY requires Windows with ctypes and msvcrt")

        kernel32 = ctypes.windll.kernel32
        if not hasattr(kernel32, "CreatePseudoConsole"):
            raise NotImplementedError("CreatePseudoConsole not supported on this Windows build")

        class COORD(ctypes.Structure):
            _fields_ = [('X', ctypes.c_short), ('Y', ctypes.c_short)]

        class STARTUPINFO(ctypes.Structure):
            _fields_ = [
                ('cb', wintypes.DWORD), ('lpReserved', ctypes.c_wchar_p), ('lpDesktop', ctypes.c_wchar_p),
                ('lpTitle', ctypes.c_wchar_p), ('dwX', wintypes.DWORD), ('dwY', wintypes.DWORD),
                ('dwXSize', wintypes.DWORD), ('dwYSize', wintypes.DWORD), ('dwXCountChars', wintypes.DWORD),
                ('dwYCountChars', wintypes.DWORD), ('dwFillAttribute', wintypes.DWORD), ('dwFlags', wintypes.DWORD),
                ('wShowWindow', wintypes.WORD), ('cbReserved2', wintypes.WORD), ('lpReserved2', ctypes.c_char_p),
                ('hStdInput', wintypes.HANDLE), ('hStdOutput', wintypes.HANDLE), ('hStdError', wintypes.HANDLE)
            ]

        class STARTUPINFOEX(ctypes.Structure):
            _fields_ = [('StartupInfo', STARTUPINFO), ('lpAttributeList', ctypes.c_void_p)]

        class PROCESS_INFORMATION(ctypes.Structure):
            _fields_ = [
                ('hProcess', wintypes.HANDLE), ('hThread', wintypes.HANDLE),
                ('dwProcessId', wintypes.DWORD), ('dwThreadId', wintypes.DWORD)
            ]

        r_in, w_in = os.pipe()
        r_out, w_out = os.pipe()
        self.w_in = w_in
        self.r_out = r_out
        self.r_in = r_in
        self.w_out = w_out

        h_in = wintypes.HANDLE(msvcrt.get_osfhandle(r_in))
        h_out = wintypes.HANDLE(msvcrt.get_osfhandle(w_out))

        hpcon_val = ctypes.c_void_p()
        size = COORD(self.cols, self.rows)
        res = kernel32.CreatePseudoConsole(size, h_in, h_out, 0, ctypes.byref(hpcon_val))
        if res != 0 or not hpcon_val.value:
            for p in (r_in, w_in, r_out, w_out):
                try: os.close(p)
                except Exception: pass
            raise RuntimeError(f"CreatePseudoConsole failed (code {res})")
        self.hpcon = hpcon_val

        size_attr = ctypes.c_size_t(0)
        kernel32.InitializeProcThreadAttributeList(None, 1, 0, ctypes.byref(size_attr))
        attr_buf = (ctypes.c_char * size_attr.value)()
        kernel32.InitializeProcThreadAttributeList(attr_buf, 1, 0, ctypes.byref(size_attr))

        PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016
        kernel32.UpdateProcThreadAttribute(
            attr_buf, 0, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
            self.hpcon, ctypes.sizeof(self.hpcon), None, None
        )

        si = STARTUPINFOEX()
        si.StartupInfo.cb = ctypes.sizeof(STARTUPINFOEX)
        si.StartupInfo.dwFlags = 0x00000001 # STARTF_USESHOWWINDOW
        si.StartupInfo.wShowWindow = 0      # SW_HIDE
        si.lpAttributeList = ctypes.cast(attr_buf, ctypes.c_void_p)

        pi = PROCESS_INFORMATION()
        EXTENDED_STARTUPINFO_PRESENT = 0x00080000
        CREATE_NO_WINDOW = 0x08000000

        cmd_str = shell_cmd or "powershell.exe -NoLogo"
        if "cmd" in cmd_str.lower() and not cmd_str.lower().endswith(".exe"):
            cmd_str = "cmd.exe"

        ok = kernel32.CreateProcessW(
            None, cmd_str, None, None, False,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW, None, None,
            ctypes.byref(si), ctypes.byref(pi)
        )

        if not ok:
            self.close()
            raise RuntimeError("CreateProcessW failed for ConPTY")

        self.h_proc = pi.hProcess
        self.pid = pi.dwProcessId
        kernel32.CloseHandle(pi.hThread)

        threading.Thread(target=self._reader, daemon=True).start()

    def _reader(self):
        try:
            while self.running and self.r_out:
                data = os.read(self.r_out, 2048)
                if not data:
                    break
                if self.on_output:
                    self.on_output(self.session_id, data.decode('utf-8', errors='replace'))
        except Exception:
            pass
        finally:
            self.close()
            if hasattr(self, "on_exit") and self.on_exit:
                try:
                    self.on_exit(self.session_id)
                except Exception:
                    pass

    def write(self, data):
        if self.w_in and self.running:
            try:
                if isinstance(data, str):
                    data = data.encode('utf-8')
                os.write(self.w_in, data)
            except Exception:
                pass

    def resize(self, cols, rows):
        self.cols = int(cols)
        self.rows = int(rows)
        if self.hpcon and ctypes and hasattr(ctypes.windll.kernel32, 'ResizePseudoConsole'):
            class COORD(ctypes.Structure):
                _fields_ = [('X', ctypes.c_short), ('Y', ctypes.c_short)]
            size = COORD(self.cols, self.rows)
            ctypes.windll.kernel32.ResizePseudoConsole(self.hpcon, size)

    def close(self):
        self.running = False
        if self.h_proc:
            try:
                ctypes.windll.kernel32.TerminateProcess(self.h_proc, 0)
                ctypes.windll.kernel32.CloseHandle(self.h_proc)
            except Exception:
                pass
            self.h_proc = None
        if self.hpcon:
            try:
                ctypes.windll.kernel32.ClosePseudoConsole(self.hpcon)
            except Exception:
                pass
            self.hpcon = None
        if self.w_in:
            try: os.close(self.w_in)
            except Exception: pass
            self.w_in = None
        if self.r_out:
            try: os.close(self.r_out)
            except Exception: pass
            self.r_out = None
        if getattr(self, "r_in", None):
            try: os.close(self.r_in)
            except Exception: pass
            self.r_in = None
        if getattr(self, "w_out", None):
            try: os.close(self.w_out)
            except Exception: pass
            self.w_out = None


class RelayWebSocket:
    def __init__(self, agent, target_url):
        self.agent = agent
        self.target_url = target_url
        self.sock = None
        self.connected = False
        self.authenticated = False
        self.running = True
        self._lock = threading.Lock()
        self._backoff = 2.0

    def start(self):
        t = threading.Thread(target=self._run_loop, daemon=True)
        t.start()

    def _run_loop(self):
        while self.running and self.agent.running:
            try:
                self._connect_and_read()
            except Exception as e:
                err_msg = str(e)
                if "timed out" in err_msg or "Connection refused" in err_msg or "getaddrinfo" in err_msg:
                    print(f"[*] Relay transport waiting for control plane ({err_msg}). Reconnecting in {int(self._backoff)}s...")
                else:
                    print(f"[*] Relay transport reconnecting in {int(self._backoff)}s: {err_msg}")
            finally:
                with self._lock:
                    if self.sock:
                        try: self.sock.close()
                        except Exception: pass
                        self.sock = None
                    self.connected = False
                    self.authenticated = False
                    self.agent.ws_connected = False
            time.sleep(self._backoff)
            self._backoff = min(self._backoff * 1.5, 15.0)

    def _connect_and_read(self):
        raw = self.target_url.replace("http://", "ws://").replace("https://", "wss://")
        parsed = urllib.parse.urlparse(raw)
        host = parsed.hostname
        port = parsed.port or (443 if parsed.scheme == "wss" else 80)
        path = parsed.path or "/api/v1/relay/connect"
        if parsed.query:
            path += "?" + parsed.query

        raw_s = socket.create_connection((host, port), timeout=8.0)
        if parsed.scheme == "wss":
            ctx = ssl.create_default_context()
            s = ctx.wrap_socket(raw_s, server_hostname=host)
        else:
            s = raw_s
        s.settimeout(None)

        sec_key = base64.b64encode(os.urandom(16)).decode("utf-8")
        req = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {sec_key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n"
            f"User-Agent: CyberVPS-Agent/1.0\r\n\r\n"
        )
        s.sendall(req.encode("utf-8"))

        hdr = b""
        while b"\r\n\r\n" not in hdr:
            chunk = s.recv(512)
            if not chunk:
                s.close()
                return
            hdr += chunk

        first_line = hdr.split(b"\r\n")[0].decode("utf-8", errors="ignore")
        if "101" not in first_line:
            s.close()
            return

        with self._lock:
            self.sock = s
            self.connected = True
            self.authenticated = False
            self.agent.ws_connected = False
            self.agent.ws_relay = self

        # Send Auth message
        auth_msg = {
            "type": "Auth",
            "payload": {
                "machine_id": self.agent.machine_id,
                "token": self.agent.token,
                "agent_version": PROTOCOL_VERSION,
                "hostname": socket.gethostname(),
                "os": platform.system(),
                "os_version": self.agent.device_profile.get("os_full", platform.release()),
                "arch": platform.machine(),
                "capabilities": self.agent.get_capabilities(),
                "profile": self.agent.device_profile
            }
        }
        self.send_text(json.dumps(auth_msg))

        while self.running and self.agent.running:
            head = self._recv_exact(s, 2)
            if not head or len(head) < 2:
                break
            b0, b1 = head[0], head[1]
            opcode = b0 & 0x0F
            is_masked = bool(b1 & 0x80)
            length = b1 & 0x7F

            if length == 126:
                ext = self._recv_exact(s, 2)
                if not ext: break
                length = struct.unpack("!H", ext)[0]
            elif length == 127:
                ext = self._recv_exact(s, 8)
                if not ext: break
                length = struct.unpack("!Q", ext)[0]

            mask_key = None
            if is_masked:
                mask_key = self._recv_exact(s, 4)
                if not mask_key: break

            payload = self._recv_exact(s, length)
            if len(payload) < length:
                break

            if is_masked and mask_key:
                payload = bytearray(b ^ mask_key[i % 4] for i, b in enumerate(payload))

            if opcode == 0x8:
                break
            elif opcode == 0x9:
                self._send_frame(s, 0xA, payload)
            elif opcode == 0x1:
                try:
                    text_data = payload.decode("utf-8")
                    msg = json.loads(text_data)
                    m_type = msg.get("type")
                    if m_type == "AuthAck":
                        p_ack = msg.get("payload", {})
                        if p_ack.get("success"):
                            self.authenticated = True
                            self.agent.ws_connected = True
                            self._backoff = 2.0
                            print(f"[*] Relay WebSocket verified & authenticated for [{self.agent.machine_id}]. Link ACTIVE.")
                            ports = self.agent.discover_listening_ports()
                            self.send_text(json.dumps({
                                "type": "DiscoveryReport",
                                "payload": {
                                    "machine_id": self.agent.machine_id,
                                    "token": self.agent.token,
                                    "ports": ports,
                                    "profile": self.agent.device_profile,
                                    "processes": []
                                }
                            }))
                        else:
                            err_msg = p_ack.get("error", "Authentication rejected by server")
                            print(f"[!] Authentication rejected by control plane: {err_msg}")
                            self.authenticated = False
                            self.agent.ws_connected = False
                            break
                    else:
                        self.agent.dispatch_server_command(msg)
                except Exception:
                    pass

    def _recv_exact(self, sock, num_bytes):
        buf = bytearray()
        while len(buf) < num_bytes:
            chunk = sock.recv(num_bytes - len(buf))
            if not chunk:
                return bytes(buf)
            buf.extend(chunk)
        return bytes(buf)

    def send_text(self, text_str):
        with self._lock:
            if not self.sock or not self.connected:
                return False
            try:
                data = text_str.encode("utf-8")
                self._send_frame(self.sock, 0x1, data)
                return True
            except Exception:
                self.connected = False
                return False

    def _send_frame(self, sock, opcode, data):
        length = len(data)
        header = bytearray([0x80 | opcode])
        if length < 126:
            header.append(0x80 | length)
        elif length <= 0xFFFF:
            header.append(0x80 | 126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack("!Q", length))
        mask = os.urandom(4)
        header.extend(mask)
        masked = bytearray(b ^ mask[i % 4] for i, b in enumerate(data))
        sock.sendall(bytes(header + masked))


class CyberVPSAgent:
    def __init__(self, server_url, token="cvps_enroll_master_token", machine_id=None):
        raw = (server_url or "https://cybervps-space-station.up.railway.app").strip().rstrip("/")
        if not (raw.startswith("http://") or raw.startswith("https://") or raw.startswith("ws://") or raw.startswith("wss://")):
            raw = "https://" + raw
        self.server_url = raw
        self.http_base = self.server_url.replace("ws://", "http://").replace("wss://", "https://")
        self.token = token
        self.machine_id = machine_id or self.generate_machine_id()
        self.running = True
        self.active_terminals = {}
        self.active_tunnel_streams = {}
        self.lock = threading.Lock()
        self.uptime_start = time.time()
        self._prev_win_times = None
        self._prev_linux_stat = None
        self.device_profile = {}
        self.ws_relay = None
        self.ws_connected = False

    def generate_machine_id(self):
        home = os.path.expanduser("~")
        mid_file = os.path.join(home, ".cybervps", "machine_id")
        try:
            if os.path.exists(mid_file):
                with open(mid_file, "r") as f:
                    saved = f.read().strip()
                    if saved:
                        return saved
        except Exception:
            pass

        hostname = socket.gethostname()
        rand_suffix = "%08x" % random.randint(0, 0xFFFFFFFF)
        new_id = f"cvps_{hostname}_{rand_suffix}"
        try:
            os.makedirs(os.path.dirname(mid_file), exist_ok=True)
            with open(mid_file, "w") as f:
                f.write(new_id)
        except Exception:
            pass
        return new_id

    # =========================================================================
    # Universal Device Intelligence (Neofetch & Tailscale-Style Discovery)
    # =========================================================================
    def discover_device_profile(self):
        hostname = socket.gethostname()
        sys_os = platform.system()
        arch = platform.machine()
        kernel_rel = platform.release()
        kernel_ver = platform.version()

        product_name = sys_os
        display_version = ""
        build_number = ""
        ubr = ""
        cpu_model = platform.processor() or "Unknown CPU"
        cpu_cores = os.cpu_count() or 1
        bios_vendor = "Unavailable"
        bios_version = "Unavailable"
        motherboard = "Unavailable"
        virtualization = "Baremetal / Physical"
        daytona_info = {}
        provider = "Self-Hosted / Generic"

        # 1. Windows Deep Discovery via Registry & CIM
        if sys_os == "Windows" and winreg:
            try:
                key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
                product_name = winreg.QueryValueEx(key, "ProductName")[0]
                try: display_version = winreg.QueryValueEx(key, "DisplayVersion")[0]
                except Exception: pass
                try: build_number = winreg.QueryValueEx(key, "CurrentBuildNumber")[0]
                except Exception: pass
                try: ubr = str(winreg.QueryValueEx(key, "UBR")[0])
                except Exception: pass
                winreg.CloseKey(key)
            except Exception:
                pass

            try:
                key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
                cpu_model = winreg.QueryValueEx(key, "ProcessorNameString")[0].strip()
                winreg.CloseKey(key)
            except Exception:
                pass

            try:
                key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\BIOS")
                try: bios_vendor = winreg.QueryValueEx(key, "BIOSVendor")[0]
                except Exception: pass
                try: bios_version = winreg.QueryValueEx(key, "BIOSVersion")[0]
                except Exception: pass
                try: motherboard = winreg.QueryValueEx(key, "BaseBoardProduct")[0]
                except Exception: pass
                winreg.CloseKey(key)
            except Exception:
                pass

        # 2. Linux Deep Discovery via /etc/os-release & /proc
        elif sys_os == "Linux":
            os_rel_file = "/etc/os-release"
            if os.path.exists(os_rel_file):
                try:
                    with open(os_rel_file, "r") as f:
                        os_data = {}
                        for line in f:
                            if "=" in line:
                                k, v = line.strip().split("=", 1)
                                os_data[k] = v.strip('"')
                        product_name = os_data.get("PRETTY_NAME", os_data.get("NAME", "Linux"))
                        display_version = os_data.get("VERSION_ID", "")
                        build_number = os_data.get("BUILD_ID", "")
                except Exception:
                    pass

            if os.path.exists("/proc/cpuinfo"):
                try:
                    with open("/proc/cpuinfo", "r") as f:
                        for line in f:
                            if "model name" in line:
                                cpu_model = line.split(":", 1)[1].strip()
                                break
                except Exception:
                    pass

            # Detect Daytona or Container Sandboxes
            if os.environ.get("DAYTONA_WS_ID") or os.environ.get("DAYTONA_SANDBOX_ID") or os.path.exists("/home/daytona"):
                provider = "Daytona Cloud Sandbox"
                virtualization = "Cloud Container / Dev Sandbox"
                daytona_info = {
                    "is_daytona": True,
                    "sandbox_id": os.environ.get("DAYTONA_SANDBOX_ID", os.environ.get("HOSTNAME", "daytona-sandbox")),
                    "workspace_id": os.environ.get("DAYTONA_WS_ID", "default"),
                    "target": os.environ.get("DAYTONA_TARGET", "us-east")
                }
            elif os.path.exists("/.dockerenv"):
                virtualization = "Docker Container"
                provider = "Container Host"
            elif os.path.exists("/sys/class/dmi/id/product_name"):
                try:
                    with open("/sys/class/dmi/id/product_name", "r") as f:
                        p_name = f.read().strip()
                        if p_name:
                            motherboard = p_name
                            if any(x in p_name.lower() for x in ["kvm", "qemu", "vmware", "virtualbox", "droplet"]):
                                virtualization = f"Virtual Machine ({p_name})"
                except Exception:
                    pass

        # 3. Network Addresses Discovery
        ip_endpoints = []
        try:
            for ip in socket.gethostbyname_ex(hostname)[2]:
                if not ip.startswith("127."):
                    ip_endpoints.append(ip)
        except Exception:
            pass

        # Public IP lookup (non-blocking 1.5s timeout)
        public_ip = "Unavailable (Private NAT)"
        try:
            req = urllib.request.Request("https://api.ipify.org?format=json", headers={"User-Agent": "CyberVPS-Agent"})
            with urllib.request.urlopen(req, timeout=1.5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data.get("ip"):
                    public_ip = data["ip"]
        except Exception:
            pass

        # OS Exact String (e.g. "Windows 10 Pro 22H2 (Build 19045.6466)")
        os_full = product_name
        if display_version:
            os_full += f" {display_version}"
        if build_number:
            full_b = f"{build_number}.{ubr}" if ubr else build_number
            os_full += f" (Build {full_b})"
        elif kernel_rel:
            os_full += f" ({kernel_rel})"

        # Tailscale-style node attributes
        attributes = {
            "node:os": sys_os.lower(),
            "node:osVersion": f"{build_number}.{ubr}" if (build_number and ubr) else (display_version or kernel_rel),
            "node:productName": product_name,
            "node:architecture": arch,
            "node:hostname": hostname,
            "node:cpuModel": cpu_model,
            "node:cpuCores": str(cpu_cores),
            "node:biosVendor": bios_vendor,
            "node:biosVersion": bios_version,
            "node:motherboard": motherboard,
            "node:virtualization": virtualization,
            "node:provider": provider,
            "node:agentVersion": PROTOCOL_VERSION,
            "node:publicIp": public_ip,
            "node:localIps": ", ".join(ip_endpoints) if ip_endpoints else "127.0.0.1",
            "node:tailscaleCompatible": "true"
        }
        if daytona_info:
            attributes["node:daytonaSandboxId"] = daytona_info.get("sandbox_id", "")
            attributes["node:daytonaWorkspace"] = daytona_info.get("workspace_id", "")

        # Neofetch formatted summary lines
        neofetch_summary = {
            "os": os_full,
            "host": f"{hostname} ({motherboard})",
            "kernel": f"{kernel_rel} ({arch})",
            "uptime_seconds": int(time.time() - self.uptime_start),
            "shell": "PowerShell 5.1 / cmd.exe" if sys_os == "Windows" else ("/bin/bash" if os.path.exists("/bin/bash") else "/bin/sh"),
            "cpu": f"{cpu_model} ({cpu_cores} Cores)",
            "bios": f"{bios_vendor} {bios_version}",
            "virtualization": virtualization,
            "provider": provider,
            "public_ip": public_ip,
            "local_ips": ip_endpoints
        }

        self.device_profile = {
            "os_full": os_full,
            "product_name": product_name,
            "display_version": display_version,
            "build_number": build_number,
            "ubr": ubr,
            "cpu_model": cpu_model,
            "cpu_cores": cpu_cores,
            "bios_vendor": bios_vendor,
            "bios_version": bios_version,
            "motherboard": motherboard,
            "virtualization": virtualization,
            "provider": provider,
            "daytona": daytona_info,
            "public_ip": public_ip,
            "local_ips": ip_endpoints,
            "attributes": attributes,
            "neofetch": neofetch_summary
        }
        return self.device_profile

    def get_capabilities(self):
        is_root = False
        try:
            is_root = (os.geteuid() == 0)
        except AttributeError:
            is_root = False

        has_systemd = os.path.exists("/run/systemd/system")
        writable_fs = False
        try:
            test_path = "/tmp/.cvps_write_test" if os.path.exists("/tmp") else ".cvps_write_test"
            with open(test_path, "w") as f:
                f.write("test")
            os.remove(test_path)
            writable_fs = True
        except Exception:
            writable_fs = False

        pty_supported = hasattr(os, "openpty") or hasattr(platform, "win32_ver")
        shell = "powershell.exe" if platform.system() == "Windows" else ("/bin/bash" if os.path.exists("/bin/bash") else "/bin/sh")

        return {
            "is_root": is_root,
            "has_systemd": has_systemd,
            "writable_fs": writable_fs,
            "pty_supported": pty_supported,
            "outbound_dns": True,
            "outbound_tls": True,
            "process_inspection": True,
            "file_manager": True,
            "service_control": True,
            "shell": shell
        }

    def discover_listening_ports(self):
        ports = []
        if os.path.exists("/proc/net/tcp"):
            try:
                with open("/proc/net/tcp", "r") as f:
                    lines = f.readlines()[1:]
                    for line in lines:
                        parts = line.strip().split()
                        if len(parts) >= 4 and parts[3] == "0A":
                            local_addr = parts[1]
                            ip_hex, port_hex = local_addr.split(":")
                            port = int(port_hex, 16)
                            if port not in [p["port"] for p in ports]:
                                ports.append({
                                    "port": port,
                                    "protocol": "TCP",
                                    "bind_address": "127.0.0.1",
                                    "pid": None,
                                    "process_name": None
                                })
            except Exception:
                pass

        if not ports:
            try:
                cmd = ["ss", "-tulpn"] if platform.system() != "Windows" else ["netstat", "-ano", "-p", "tcp"]
                out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, timeout=2).decode("utf-8", errors="ignore")
                for line in out.splitlines():
                    if "LISTEN" in line:
                        parts = line.split()
                        for part in parts:
                            if ":" in part:
                                p_str = part.split(":")[-1]
                                try:
                                    port = int(p_str)
                                    if port > 0 and port < 65536 and port not in [p["port"] for p in ports]:
                                        ports.append({
                                            "port": port,
                                            "protocol": "TCP",
                                            "bind_address": "0.0.0.0",
                                            "pid": None,
                                            "process_name": None
                                        })
                                except ValueError:
                                    continue
            except Exception:
                pass

        candidates = [22, 80, 443, 2280, 3000, 4000, 5000, 5173, 6767, 8000, 8080, 8888, 9000, 22220, 22222]
        for c in candidates:
            if not any(p["port"] == c for p in ports):
                try:
                    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    s.settimeout(0.1)
                    res = s.connect_ex(("127.0.0.1", c))
                    s.close()
                    if res == 0:
                        ports.append({
                            "port": c,
                            "protocol": "TCP",
                            "bind_address": "127.0.0.1",
                            "pid": None,
                            "process_name": None
                        })
                except Exception:
                    pass

        enriched = []
        for p in ports:
            port_num = p["port"]
            is_http, status, title, has_ws = self.probe_http(port_num)
            enriched.append({
                "port": port_num,
                "protocol": p["protocol"],
                "bind_address": p["bind_address"],
                "pid": p["pid"],
                "process_name": p["process_name"],
                "is_http": is_http,
                "http_status": status,
                "http_title": title,
                "has_websocket": has_ws,
                "last_discovered": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            })
        return enriched

    def probe_http(self, port):
        if port in [135, 137, 138, 139, 445, 5357]:
            return False, None, None, False
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(0.2)
            s.connect(("127.0.0.1", port))
            probe = f"GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUser-Agent: CyberVPS-Probe/1.0\r\nConnection: close\r\n\r\n"
            s.sendall(probe.encode("utf-8"))
            data = s.recv(4096).decode("utf-8", errors="ignore")
            s.close()

            if not data.startswith("HTTP/"):
                return False, None, None, False

            status = None
            first_line = data.splitlines()[0]
            parts = first_line.split()
            if len(parts) >= 2 and parts[1].isdigit():
                status = int(parts[1])

            title = None
            lower = data.lower()
            if "<title>" in lower and "</title>" in lower:
                s_idx = lower.find("<title>") + 7
                e_idx = lower.find("</title>", s_idx)
                title = data[s_idx:e_idx].strip()

            has_ws = "upgrade: websocket" in lower or "sec-websocket" in lower
            return True, status, title, has_ws
        except Exception:
            return False, None, None, False

    # =========================================================================
    # Genuine Hardware & Operating System Telemetry
    # =========================================================================
    def get_system_metrics(self):
        cpu_usage = 0.0
        mem_used = 0
        mem_total = 1024 * 1024 * 1024
        disk_total = 50 * 1024 * 1024 * 1024
        disk_used = 10 * 1024 * 1024 * 1024

        try:
            home = os.path.expanduser("~")
            disk_stat = shutil.disk_usage(home)
            disk_total = disk_stat.total
            disk_used = disk_stat.used
        except Exception:
            pass

        if platform.system() == "Windows" and ctypes:
            try:
                class MEMORYSTATUSEX(ctypes.Structure):
                    _fields_ = [
                        ('dwLength', ctypes.c_ulong),
                        ('dwMemoryLoad', ctypes.c_ulong),
                        ('ullTotalPhys', ctypes.c_ulonglong),
                        ('ullAvailPhys', ctypes.c_ulonglong),
                        ('ullTotalPageFile', ctypes.c_ulonglong),
                        ('ullAvailPageFile', ctypes.c_ulonglong),
                        ('ullTotalVirtual', ctypes.c_ulonglong),
                        ('ullAvailVirtual', ctypes.c_ulonglong),
                        ('sullAvailExtendedVirtual', ctypes.c_ulonglong)
                    ]
                stat_m = MEMORYSTATUSEX()
                stat_m.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
                if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat_m)):
                    mem_total = stat_m.ullTotalPhys
                    mem_used = stat_m.ullTotalPhys - stat_m.ullAvailPhys

                class FILETIME(ctypes.Structure):
                    _fields_ = [('dwLowDateTime', ctypes.c_ulong), ('dwHighDateTime', ctypes.c_ulong)]
                def _get_win_times():
                    idle, kernel, user = FILETIME(), FILETIME(), FILETIME()
                    ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user))
                    i = (idle.dwHighDateTime << 32) + idle.dwLowDateTime
                    k = (kernel.dwHighDateTime << 32) + kernel.dwLowDateTime
                    u = (user.dwHighDateTime << 32) + user.dwLowDateTime
                    return i, k, u

                if self._prev_win_times:
                    i1, k1, u1 = self._prev_win_times
                    i2, k2, u2 = _get_win_times()
                    idle_delta = i2 - i1
                    total_delta = (k2 - k1) + (u2 - u1)
                    if total_delta > 0:
                        cpu_usage = max(0.0, min(100.0, 100.0 * (1.0 - (idle_delta / total_delta))))
                    self._prev_win_times = (i2, k2, u2)
                else:
                    self._prev_win_times = _get_win_times()
            except Exception:
                pass
        else:
            try:
                if os.path.exists("/proc/meminfo"):
                    with open("/proc/meminfo", "r") as f:
                        mem_data = {}
                        for line in f:
                            parts = line.split(":")
                            if len(parts) == 2:
                                val = parts[1].strip().split()[0]
                                mem_data[parts[0]] = int(val) * 1024
                        mem_total = mem_data.get("MemTotal", mem_total)
                        mem_avail = mem_data.get("MemAvailable", mem_data.get("MemFree", 0))
                        mem_used = max(0, mem_total - mem_avail)

                if os.path.exists("/proc/stat"):
                    with open("/proc/stat", "r") as f:
                        line = f.readline().strip()
                        fields = [float(x) for x in line.split()[1:]]
                        idle = fields[3]
                        total = sum(fields)
                        if self._prev_linux_stat:
                            p_idle, p_total = self._prev_linux_stat
                            idle_delta = idle - p_idle
                            total_delta = total - p_total
                            if total_delta > 0:
                                cpu_usage = max(0.0, min(100.0, 100.0 * (1.0 - (idle_delta / total_delta))))
                        self._prev_linux_stat = (idle, total)
                elif os.path.exists("/proc/loadavg"):
                    with open("/proc/loadavg", "r") as f:
                        load1 = float(f.read().split()[0])
                        cpu_usage = min(100.0, load1 * 20.0)
            except Exception:
                pass

        return {
            "uptime_seconds": int(time.time() - self.uptime_start),
            "cpu_usage": round(cpu_usage, 1),
            "memory_used_bytes": int(mem_used),
            "memory_total_bytes": int(mem_total),
            "disk_used_bytes": int(disk_used),
            "disk_total_bytes": int(disk_total)
        }

    # =========================================================================
    # Remote File Manager Engine (FTP/SFTP-Like Capabilities)
    # =========================================================================
    def _sanitize_path(self, target_path):
        if not target_path or not str(target_path).strip():
            return os.path.abspath(os.path.expanduser("~"))
        p = str(target_path).strip()
        if "\0" in p:
            raise ValueError("Path contains invalid null byte")
        if platform.system() == "Windows":
            if p in ["/", "\\"]:
                return "C:\\"
            if len(p) == 2 and p[1] == ":":
                return p.upper() + "\\"
            if len(p) >= 3 and p[1] == ":" and p[2] in ["/", "\\"]:
                norm_p = p[:2].upper() + "\\" + p[3:].replace("/", "\\")
                return os.path.abspath(norm_p)
        expanded = os.path.expanduser(p)
        resolved = os.path.abspath(expanded)
        return resolved

    def handle_file_list(self, payload):
        req_id = payload.get("request_id")
        raw_path = payload.get("path")
        show_hidden = bool(payload.get("show_hidden", False))
        try:
            target_path = self._sanitize_path(raw_path)
            if not os.path.exists(target_path):
                raise FileNotFoundError(f"Directory not found: {target_path}")
            if not os.path.isdir(target_path):
                target_path = os.path.dirname(target_path)

            entries = []
            try:
                with os.scandir(target_path) as it:
                    for entry in it:
                        try:
                            is_hidden = entry.name.startswith(".")
                            if not is_hidden and platform.system() == "Windows":
                                try:
                                    is_hidden = bool(entry.stat().st_file_attributes & 2)
                                except Exception:
                                    pass
                            if is_hidden and not show_hidden:
                                continue

                            st = entry.stat(follow_symlinks=False)
                            is_dir = entry.is_dir(follow_symlinks=False)
                            is_symlink = entry.is_symlink()
                            size = st.st_size if not is_dir else 0
                            mtime_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(st.st_mtime))
                            mode_str = oct(st.st_mode)[-3:] if hasattr(st, "st_mode") else "755"

                            ext = os.path.splitext(entry.name)[1].lower()
                            ftype = "folder" if is_dir else "file"
                            if ext in [".txt", ".md", ".log", ".json", ".js", ".ts", ".py", ".sh", ".yaml", ".yml", ".html", ".css", ".xml", ".ini", ".conf", ".env"]:
                                ftype = "text"
                            elif ext in [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"]:
                                ftype = "image"
                            elif ext in [".zip", ".tar", ".gz", ".7z", ".rar"]:
                                ftype = "archive"

                            entries.append({
                                "name": entry.name,
                                "path": entry.path.replace("\\", "/"),
                                "native_path": entry.path,
                                "is_directory": is_dir,
                                "is_dir": is_dir,
                                "is_symlink": is_symlink,
                                "size": size,
                                "modified": mtime_iso,
                                "mtime": mtime_iso,
                                "permissions": mode_str,
                                "mode": mode_str,
                                "is_hidden": is_hidden,
                                "file_type": ftype,
                                "ext": ext
                            })
                        except Exception:
                            continue
            except PermissionError:
                pass

            entries.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))

            disk_info = {}
            try:
                du = shutil.disk_usage(target_path)
                total_gb = round(du.total / (1024**3), 1)
                free_gb = round(du.free / (1024**3), 1)
                used_gb = round(du.used / (1024**3), 1)
                disk_info = {
                    "total_gb": total_gb,
                    "free_gb": free_gb,
                    "used_gb": used_gb,
                    "total_bytes": du.total,
                    "used_bytes": du.used,
                    "free_bytes": du.free,
                    "percent_used": round((du.used / du.total) * 100, 1) if du.total > 0 else 0
                }
            except Exception:
                pass

            drives = []
            if platform.system() == "Windows":
                for d in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
                    dp = f"{d}:\\"
                    if os.path.exists(dp):
                        drives.append(dp)

            parent = os.path.dirname(target_path)
            if parent == target_path:
                parent = None

            res = {
                "current_path": target_path.replace("\\", "/"),
                "native_current_path": target_path,
                "parent_path": parent.replace("\\", "/") if parent else None,
                "items": entries,
                "entries": entries,
                "drives": drives,
                "disk": disk_info,
                "os": platform.system(),
                "sep": os.sep
            }
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": True, "result": res}
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def handle_file_read(self, payload):
        req_id = payload.get("request_id")
        raw_path = payload.get("path")
        max_bytes = payload.get("max_bytes", 5 * 1024 * 1024)
        try:
            target_path = self._sanitize_path(raw_path)
            if not os.path.isfile(target_path):
                raise FileNotFoundError(f"File not found: {target_path}")

            size = os.path.getsize(target_path)
            if size > max_bytes:
                raise ValueError(f"File size ({round(size / 1024 / 1024, 2)} MB) exceeds preview limit of 5 MB.")

            with open(target_path, "rb") as f:
                raw = f.read()

            is_binary = False
            try:
                text_content = raw.decode("utf-8")
                b64_content = None
            except UnicodeDecodeError:
                is_binary = True
                text_content = None
                b64_content = base64.b64encode(raw).decode("ascii")

            ext = os.path.splitext(target_path)[1].lower()
            res = {
                "path": target_path.replace("\\", "/"),
                "native_path": target_path,
                "filename": os.path.basename(target_path),
                "size": size,
                "is_binary": is_binary,
                "content": text_content,
                "content_base64": b64_content,
                "ext": ext
            }
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": True, "result": res}
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def handle_file_write(self, payload):
        req_id = payload.get("request_id")
        raw_path = payload.get("path")
        content = payload.get("content", "")
        is_base64 = bool(payload.get("is_base64", False))
        try:
            target_path = self._sanitize_path(raw_path)
            parent = os.path.dirname(target_path)
            if parent and not os.path.exists(parent):
                os.makedirs(parent, exist_ok=True)

            if is_base64:
                raw_bytes = base64.b64decode(content)
                with open(target_path, "wb") as f:
                    f.write(raw_bytes)
                bytes_written = len(raw_bytes)
            else:
                raw_bytes = content.encode("utf-8")
                with open(target_path, "wb") as f:
                    f.write(raw_bytes)
                bytes_written = len(raw_bytes)

            res = {
                "path": target_path.replace("\\", "/"),
                "native_path": target_path,
                "bytes_written": bytes_written
            }
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": True, "result": res}
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def handle_file_delete(self, payload):
        req_id = payload.get("request_id")
        raw_path = payload.get("path")
        recursive = bool(payload.get("recursive", False))
        try:
            target_path = self._sanitize_path(raw_path)
            if not os.path.exists(target_path):
                raise FileNotFoundError(f"Path does not exist: {target_path}")

            dangerous = {"/", "/etc", "/bin", "/sbin", "/usr", "/boot", "/lib", "c:\\", "c:\\windows", "c:\\windows\\system32"}
            if target_path.lower() in dangerous or os.path.dirname(target_path) == target_path:
                raise PermissionError("Access Denied: Deleting system root directories is forbidden.")

            if os.path.isdir(target_path):
                if recursive:
                    shutil.rmtree(target_path)
                else:
                    os.rmdir(target_path)
            else:
                os.remove(target_path)

            res = {"path": target_path.replace("\\", "/"), "deleted": True}
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": True, "result": res}
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def handle_file_rename(self, payload):
        req_id = payload.get("request_id")
        old_raw = payload.get("old_path")
        new_raw = payload.get("new_path")
        try:
            old_path = self._sanitize_path(old_raw)
            new_path = self._sanitize_path(new_raw)
            if not os.path.exists(old_path):
                raise FileNotFoundError(f"Source path not found: {old_path}")
            os.rename(old_path, new_path)
            res = {"old_path": old_path.replace("\\", "/"), "new_path": new_path.replace("\\", "/")}
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": True, "result": res}
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def handle_file_mkdir(self, payload):
        req_id = payload.get("request_id")
        raw_path = payload.get("path")
        try:
            target_path = self._sanitize_path(raw_path)
            os.makedirs(target_path, exist_ok=True)
            res = {"path": target_path.replace("\\", "/"), "created": True}
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": True, "result": res}
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def handle_file_stat(self, payload):
        req_id = payload.get("request_id")
        raw_path = payload.get("path")
        try:
            target_path = self._sanitize_path(raw_path)
            du = shutil.disk_usage(target_path)
            res = {
                "path": target_path.replace("\\", "/"),
                "total_bytes": du.total,
                "used_bytes": du.used,
                "free_bytes": du.free,
                "percent_used": round((du.used / du.total) * 100, 1) if du.total > 0 else 0
            }
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": True, "result": res}
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    # =========================================================================
    # Task Manager: Universal Process & Service Management Engine
    # =========================================================================
    def handle_process_list(self, payload):
        req_id = payload.get("request_id")
        limit = int(payload.get("limit", 150))
        search = (payload.get("search") or "").lower().strip()
        sort_by = payload.get("sort", "memory") # memory, cpu, pid, name
        try:
            procs = []
            host_cpu = 0.0
            host_mem_used = 0
            host_mem_total = 0
            cores = os.cpu_count() or 1

            if psutil:
                try:
                    host_cpu = round(psutil.cpu_percent(interval=None), 1)
                    vmem = psutil.virtual_memory()
                    host_mem_used = round(vmem.used / (1024 * 1024), 1)
                    host_mem_total = round(vmem.total / (1024 * 1024), 1)
                except Exception:
                    pass

                attrs = ['pid', 'ppid', 'name', 'username', 'status', 'memory_info', 'memory_percent', 'create_time', 'num_threads']
                for p in psutil.process_iter(attrs):
                    try:
                        p_info = p.info
                        pid = p_info['pid']
                        name = p_info['name'] or f"PID_{pid}"
                        user = p_info.get('username') or "N/A"

                        if search and (search not in name.lower() and search not in str(pid) and search not in user.lower()):
                            continue

                        raw_cpu = p.cpu_percent(interval=None)
                        norm_cpu = round(raw_cpu / cores, 1)

                        mem_bytes = p_info['memory_info'].rss if p_info.get('memory_info') else 0
                        mem_mb = round(mem_bytes / (1024 * 1024), 1)
                        mem_pct = round(p_info.get('memory_percent') or 0, 1)
                        status = p_info.get('status') or "running"

                        procs.append({
                            "pid": pid,
                            "ppid": p_info.get('ppid') or 0,
                            "name": name,
                            "user": user,
                            "cpu_percent": norm_cpu,
                            "memory_mb": mem_mb,
                            "memory_percent": mem_pct,
                            "status": status.capitalize(),
                            "threads": p_info.get('num_threads') or 1,
                            "create_time": p_info.get('create_time') or 0
                        })
                    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                        continue
            elif platform.system() == "Windows":
                try:
                    out = subprocess.check_output(["tasklist", "/V", "/FO", "CSV", "/NH"], timeout=4).decode("utf-8", errors="ignore")
                    reader = csv.reader(io.StringIO(out))
                    for row in reader:
                        if len(row) >= 8:
                            pid = int(row[1])
                            name = row[0]
                            user = row[6] if len(row) > 6 else row[2]
                            if search and (search not in name.lower() and search not in str(pid) and search not in user.lower()):
                                continue
                            mem_str = row[4].replace(",", "").replace(" K", "").replace(" ", "")
                            try:
                                mem_mb = round(int(mem_str) / 1024, 1)
                            except ValueError:
                                mem_mb = 0
                            procs.append({
                                "pid": pid,
                                "ppid": 0,
                                "name": name,
                                "user": user,
                                "cpu_percent": 0.0,
                                "memory_mb": mem_mb,
                                "memory_percent": 0.0,
                                "status": row[5] if len(row) > 5 else "Running",
                                "threads": 1,
                                "create_time": 0
                            })
                except Exception:
                    pass
            else:
                try:
                    out = subprocess.check_output(
                        ["ps", "-eo", "pid,ppid,user,%cpu,%mem,rss,stat,comm", "--no-headers"],
                        timeout=4
                    ).decode("utf-8", errors="ignore")
                    for line in out.strip().splitlines():
                        parts = line.strip().split(None, 7)
                        if len(parts) >= 8:
                            pid = int(parts[0])
                            ppid = int(parts[1])
                            user = parts[2]
                            cpu_val = float(parts[3])
                            mem_pct = float(parts[4])
                            rss_kb = int(parts[5])
                            stat_val = parts[6]
                            name = parts[7]

                            if search and (search not in name.lower() and search not in str(pid) and search not in user.lower()):
                                continue

                            procs.append({
                                "pid": pid,
                                "ppid": ppid,
                                "name": name,
                                "user": user,
                                "cpu_percent": round(cpu_val / cores, 1),
                                "memory_mb": round(rss_kb / 1024, 1),
                                "memory_percent": mem_pct,
                                "status": "Running" if "R" in stat_val or "S" in stat_val else "Sleeping",
                                "threads": 1,
                                "create_time": 0
                            })
                except Exception:
                    pass

            total_count = len(procs)

            if sort_by == "cpu":
                procs.sort(key=lambda x: x["cpu_percent"], reverse=True)
            elif sort_by == "pid":
                procs.sort(key=lambda x: x["pid"])
            elif sort_by == "name":
                procs.sort(key=lambda x: x["name"].lower())
            else:
                procs.sort(key=lambda x: x["memory_mb"], reverse=True)

            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {
                    "request_id": req_id,
                    "success": True,
                    "result": {
                        "processes": procs[:limit],
                        "total_count": total_count,
                        "host_cpu_percent": host_cpu,
                        "host_mem_used_mb": host_mem_used,
                        "host_mem_total_mb": host_mem_total,
                        "provider": "psutil" if psutil else ("windows_native" if platform.system() == "Windows" else "linux_proc")
                    }
                }
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def handle_process_kill(self, payload):
        req_id = payload.get("request_id")
        pid = int(payload.get("pid", -1))
        force = bool(payload.get("force", False))
        if pid <= 0:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": "Invalid PID specified"}
            })
            return

        if pid == os.getpid():
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": "Access Denied: Cannot kill CyberVPS Agent host process."}
            })
            return

        if platform.system() == "Windows" and pid in [0, 4]:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": f"Access Denied: PID {pid} is a protected Windows kernel process."}
            })
            return
        if platform.system() == "Linux" and pid == 1:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": "Access Denied: PID 1 is Linux init/systemd."}
            })
            return

        try:
            killed = False
            proc_name = ""
            if psutil:
                try:
                    p = psutil.Process(pid)
                    proc_name = p.name()
                    if force:
                        p.kill()
                    else:
                        p.terminate()
                    try:
                        p.wait(timeout=1.5)
                        killed = True
                    except psutil.TimeoutExpired:
                        if force:
                            p.kill()
                        killed = not p.is_running()
                except psutil.NoSuchProcess:
                    killed = True
            elif platform.system() == "Windows":
                cmd = ["taskkill", "/F" if force else "/T", "/PID", str(pid)]
                subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=4)
                killed = True
            else:
                os.kill(pid, signal.SIGKILL if force else signal.SIGTERM)
                killed = True

            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {
                    "request_id": req_id,
                    "success": True,
                    "result": {
                        "pid": pid,
                        "name": proc_name,
                        "killed": killed,
                        "force": force
                    }
                }
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def handle_process_start(self, payload):
        req_id = payload.get("request_id")
        command = payload.get("command", "").strip()
        args = payload.get("args", [])
        cwd = payload.get("cwd") or None

        if not command:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": "Executable command cannot be empty"}
            })
            return

        try:
            full_cmd = [command] + (args if isinstance(args, list) else [])
            p = subprocess.Popen(full_cmd, cwd=cwd, shell=False)
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {
                    "request_id": req_id,
                    "success": True,
                    "result": {
                        "pid": p.pid,
                        "command": command,
                        "started": True
                    }
                }
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def handle_process_details(self, payload):
        req_id = payload.get("request_id")
        pid = int(payload.get("pid", -1))
        try:
            details = {"pid": pid}
            if psutil:
                try:
                    p = psutil.Process(pid)
                    details["name"] = p.name()
                    details["ppid"] = p.ppid()
                    details["status"] = p.status().capitalize()
                    details["username"] = p.username()
                    try: details["exe"] = p.exe()
                    except Exception: details["exe"] = "Access Denied"
                    try: details["cmdline"] = " ".join(p.cmdline())
                    except Exception: details["cmdline"] = details["name"]
                    try: details["cwd"] = p.cwd()
                    except Exception: details["cwd"] = "N/A"
                    details["num_threads"] = p.num_threads()
                    details["create_time"] = p.create_time()
                    mem = p.memory_info()
                    details["memory_rss_mb"] = round(mem.rss / (1024 * 1024), 1)
                    details["memory_vms_mb"] = round(mem.vms / (1024 * 1024), 1)
                    details["cpu_percent"] = round(p.cpu_percent(None) / (os.cpu_count() or 1), 1)
                except psutil.NoSuchProcess:
                    raise FileNotFoundError(f"Process PID {pid} no longer exists")
            else:
                details["name"] = f"PID {pid}"

            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": True, "result": details}
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def handle_service_list(self, payload):
        req_id = payload.get("request_id")
        search = (payload.get("search") or "").lower().strip()
        status_filter = (payload.get("status") or "").lower().strip()
        try:
            svcs = []
            if psutil and platform.system() == "Windows" and hasattr(psutil, "win_service_iter"):
                for s in psutil.win_service_iter():
                    try:
                        name = s.name()
                        disp = s.display_name() or name
                        stat_val = s.status()
                        st_name = "Running" if stat_val == "running" else "Stopped"
                        start_t = s.start_type()

                        if search and (search not in name.lower() and search not in disp.lower()):
                            continue
                        if status_filter and status_filter != "all" and st_name.lower() != status_filter:
                            continue

                        svcs.append({
                            "name": name,
                            "display_name": disp,
                            "status": st_name,
                            "startup_type": start_t.capitalize(),
                            "binpath": getattr(s, "binpath", lambda: "")() if callable(getattr(s, "binpath", None)) else ""
                        })
                    except Exception:
                        continue
            elif platform.system() == "Windows":
                try:
                    cmd = ["powershell", "-NoProfile", "-Command", "Get-Service | Select-Object Name, DisplayName, Status, StartType | ConvertTo-Json -Compress"]
                    out = subprocess.check_output(cmd, timeout=6).decode("utf-8", errors="ignore")
                    raw_list = json.loads(out)
                    if isinstance(raw_list, dict):
                        raw_list = [raw_list]
                    for s in raw_list:
                        name = s.get("Name") or ""
                        disp = s.get("DisplayName") or name
                        status_name = "Running" if s.get("Status") == 4 or str(s.get("Status")).lower() == "running" else "Stopped"
                        if search and (search not in name.lower() and search not in disp.lower()):
                            continue
                        svcs.append({
                            "name": name,
                            "display_name": disp,
                            "status": status_name,
                            "startup_type": str(s.get("StartType", "Automatic"))
                        })
                except Exception:
                    pass
            else:
                if os.path.exists("/bin/systemctl") or os.path.exists("/usr/bin/systemctl"):
                    out = subprocess.check_output(["systemctl", "list-units", "--type=service", "--all", "--no-legend", "--no-pager"], timeout=5).decode("utf-8", errors="ignore")
                    for line in out.strip().splitlines():
                        parts = line.strip().split(None, 4)
                        if len(parts) >= 4:
                            name = parts[0].replace(".service", "")
                            status = "Running" if parts[2] == "active" and parts[3] == "running" else ("Failed" if parts[3] == "failed" else "Stopped")
                            desc = parts[4] if len(parts) >= 5 else name
                            if search and (search not in name.lower() and search not in desc.lower()):
                                continue
                            if status_filter and status_filter != "all" and status.lower() != status_filter:
                                continue
                            svcs.append({
                                "name": name,
                                "display_name": desc,
                                "status": status,
                                "startup_type": parts[1]
                            })
                else:
                    svcs = []

            svcs.sort(key=lambda x: x["name"].lower())

            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": True, "result": svcs}
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def handle_service_action(self, payload):
        req_id = payload.get("request_id")
        svc_name = (payload.get("service_name") or "").strip()
        action = (payload.get("action") or "").lower().strip()

        if action not in ["start", "stop", "restart", "enable", "disable"]:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": f"Invalid action: {action}"}
            })
            return

        if not svc_name:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": "Service name required"}
            })
            return

        try:
            output = ""
            new_status = "Unknown"
            if platform.system() == "Windows":
                ps_script = "param($a, $s) if ($a -eq 'restart') { Restart-Service -Name $s -Force } elseif ($a -eq 'start') { Start-Service -Name $s } elseif ($a -eq 'stop') { Stop-Service -Name $s -Force }; (Get-Service -Name $s).Status"
                res = subprocess.run(["powershell", "-NoProfile", "-Command", ps_script, action, svc_name], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=12)
                output = res.stdout.decode("utf-8", errors="ignore").strip()
                new_status = "Running" if "Running" in output or "4" in output else "Stopped"
            else:
                res = subprocess.run(["systemctl", action, f"{svc_name}.service"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=12)
                output = res.stdout.decode("utf-8", errors="ignore").strip()
                chk = subprocess.run(["systemctl", "is-active", f"{svc_name}.service"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
                active_out = chk.stdout.decode("utf-8", errors="ignore").strip()
                new_status = "Running" if active_out == "active" else "Stopped"

            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {
                    "request_id": req_id,
                    "success": True,
                    "result": {
                        "service": svc_name,
                        "action": action,
                        "status": new_status,
                        "output": output
                    }
                }
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    # =========================================================================
    # Terminal Session Handling
    # =========================================================================
    def start_terminal_session(self, session_id, cols=80, rows=24, shell=None):
        cols = int(cols or 80)
        rows = int(rows or 24)
        if platform.system() == "Windows":
            shell_choice = (shell or "powershell").lower().strip()
            if "cmd" in shell_choice:
                shell_cmd_list = ["cmd.exe"]
                backend_label = "cmd.exe"
            elif "pwsh" in shell_choice and shutil.which("pwsh"):
                shell_cmd_list = [shutil.which("pwsh"), "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass"]
                backend_label = "pwsh.exe"
            else:
                shell_cmd_list = ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass"]
                backend_label = "powershell.exe"

            # Guaranteed 100% hidden background process (ABSOLUTELY ZERO DESKTOP POPUP)
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = subprocess.SW_HIDE
            CREATE_NO_WINDOW = 0x08000000

            try:
                p = subprocess.Popen(
                    shell_cmd_list,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    bufsize=0,
                    creationflags=CREATE_NO_WINDOW,
                    startupinfo=startupinfo
                )
                with self.lock:
                    self.active_terminals[session_id] = {"proc": p, "type": "pipe"}

                threading.Thread(target=self._pipe_terminal_reader, args=(session_id, p.stdout), daemon=True).start()
                self.send_agent_event({
                    "type": "TerminalReady",
                    "payload": {
                        "session_id": session_id,
                        "backend": f"Background ({backend_label})",
                        "shell": backend_label,
                        "pid": p.pid,
                        "cols": cols,
                        "rows": rows
                    }
                })
            except Exception as e:
                self.send_agent_event({
                    "type": "TerminalOutput",
                    "payload": {"session_id": session_id, "data": f"\r\n[!] Failed to start background terminal: {e}\r\n"}
                })
        else:
            import pty
            master, slave = pty.openpty()
            shell_cmd = shell or ("/bin/bash" if os.path.exists("/bin/bash") else "/bin/sh")
            p = subprocess.Popen(
                [shell_cmd, "-i"],
                stdin=slave,
                stdout=slave,
                stderr=slave,
                close_fds=True,
                preexec_fn=os.setsid
            )
            os.close(slave)
            with self.lock:
                self.active_terminals[session_id] = {"proc": p, "master": master, "type": "pty"}

            try:
                import fcntl
                import termios
                import struct
                winsize = struct.pack("HHHH", int(rows), int(cols), 0, 0)
                fcntl.ioctl(master, termios.TIOCSWINSZ, winsize)
            except Exception:
                pass

            threading.Thread(target=self._pty_terminal_reader, args=(session_id, master), daemon=True).start()
            self.send_agent_event({
                "type": "TerminalReady",
                "payload": {
                    "session_id": session_id,
                    "backend": "PTY",
                    "shell": shell_cmd,
                    "pid": p.pid,
                    "cols": cols,
                    "rows": rows
                }
            })

    def _pty_terminal_reader(self, session_id, master_fd):
        try:
            while self.running:
                r, _, _ = select.select([master_fd], [], [], 0.05)
                if master_fd in r:
                    data = os.read(master_fd, 2048)
                    if not data:
                        break
                    self.send_agent_event({
                        "type": "TerminalOutput",
                        "payload": {
                            "session_id": session_id,
                            "data": data.decode("utf-8", errors="replace")
                        }
                    })
        except Exception:
            pass
        finally:
            try:
                os.close(master_fd)
            except Exception:
                pass
            with self.lock:
                term_info = self.active_terminals.pop(session_id, None)
            exit_code = 0
            if term_info and "proc" in term_info:
                try:
                    term_info["proc"].poll()
                    exit_code = term_info["proc"].returncode if term_info["proc"].returncode is not None else 0
                except Exception:
                    pass
            self.send_agent_event({
                "type": "TerminalExit",
                "payload": {"session_id": session_id, "exit_code": exit_code}
            })

    def _pipe_terminal_reader(self, session_id, stream):
        try:
            while self.running:
                with self.lock:
                    if session_id not in self.active_terminals:
                        break
                chunk = stream.read1(2048) if hasattr(stream, "read1") else stream.read(2048)
                if not chunk:
                    break
                self.send_agent_event({
                    "type": "TerminalOutput",
                    "payload": {
                        "session_id": session_id,
                        "data": chunk.decode("utf-8", errors="replace")
                    }
                })
        except Exception:
            pass
        finally:
            with self.lock:
                term_info = self.active_terminals.pop(session_id, None)
            exit_code = 0
            if term_info and "proc" in term_info:
                try:
                    term_info["proc"].poll()
                    exit_code = term_info["proc"].returncode if term_info["proc"].returncode is not None else 0
                except Exception:
                    pass
            self.send_agent_event({
                "type": "TerminalExit",
                "payload": {"session_id": session_id, "exit_code": exit_code}
            })

    def write_terminal_input(self, session_id, text):
        with self.lock:
            term = self.active_terminals.get(session_id)
        if not term:
            return
        try:
            ttype = term.get("type")
            if ttype == "conpty":
                term["term"].write(text)
            elif ttype == "pty":
                os.write(term["master"], text.encode("utf-8"))
            elif ttype == "pipe":
                term["proc"].stdin.write(text.encode("utf-8"))
                term["proc"].stdin.flush()
        except Exception:
            pass

    def resize_terminal(self, session_id, cols=80, rows=24):
        with self.lock:
            term = self.active_terminals.get(session_id)
        if not term:
            return
        try:
            ttype = term.get("type")
            if ttype == "conpty":
                term["term"].resize(cols, rows)
            elif ttype == "pty":
                import fcntl
                import termios
                import struct
                winsize = struct.pack("HHHH", int(rows), int(cols), 0, 0)
                fcntl.ioctl(term["master"], termios.TIOCSWINSZ, winsize)
        except Exception:
            pass

    def kill_terminal(self, session_id):
        with self.lock:
            term = self.active_terminals.pop(session_id, None)
        if term:
            try:
                ttype = term.get("type")
                if ttype == "conpty":
                    term["term"].close()
                elif ttype == "pty":
                    term["proc"].terminate()
                    try:
                        os.close(term["master"])
                    except Exception:
                        pass
                elif ttype == "pipe":
                    term["proc"].terminate()
            except Exception:
                pass
            self.send_agent_event({
                "type": "TerminalExit",
                "payload": {"session_id": session_id, "exit_code": 0}
            })

    # =========================================================================
    # Localhost Tunnel Proxying (HTTP & WebSocket streaming over tunnel)
    # =========================================================================
    def handle_tunnel_open(self, tunnel_id, stream_id, target_port):
        threading.Thread(
            target=self._run_tunnel_stream,
            args=(tunnel_id, stream_id, target_port),
            daemon=True
        ).start()

    def _run_tunnel_stream(self, tunnel_id, stream_id, target_port):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(3.0)
            sock.connect(("127.0.0.1", target_port))
            sock.setblocking(False)

            with self.lock:
                self.active_tunnel_streams[stream_id] = sock

            self.send_agent_event({
                "type": "TunnelStreamOpened",
                "payload": {
                    "tunnel_id": tunnel_id,
                    "stream_id": stream_id,
                    "success": True,
                    "error": None
                }
            })

            while self.running and stream_id in self.active_tunnel_streams:
                r, _, _ = select.select([sock], [], [], 0.5)
                if sock in r:
                    chunk = sock.recv(8192)
                    if not chunk:
                        break
                    b64 = base64.b64encode(chunk).decode("ascii")
                    self.send_agent_event({
                        "type": "TunnelData",
                        "payload": {
                            "tunnel_id": tunnel_id,
                            "stream_id": stream_id,
                            "data_base64": b64
                        }
                    })
        except Exception as e:
            self.send_agent_event({
                "type": "TunnelStreamOpened",
                "payload": {
                    "tunnel_id": tunnel_id,
                    "stream_id": stream_id,
                    "success": False,
                    "error": str(e)
                }
            })
        finally:
            with self.lock:
                s = self.active_tunnel_streams.pop(stream_id, None)
                if s:
                    try:
                        s.close()
                    except Exception:
                        pass
            self.send_agent_event({
                "type": "TunnelStreamClosed",
                "payload": {
                    "tunnel_id": tunnel_id,
                    "stream_id": stream_id
                }
            })

    def write_tunnel_data(self, stream_id, data_b64):
        with self.lock:
            sock = self.active_tunnel_streams.get(stream_id)
        if sock:
            try:
                raw_bytes = base64.b64decode(data_b64)
                sock.sendall(raw_bytes)
            except Exception:
                pass

    def close_tunnel_stream(self, stream_id):
        with self.lock:
            sock = self.active_tunnel_streams.pop(stream_id, None)
        if sock:
            try:
                sock.close()
            except Exception:
                pass

    # =========================================================================
    # Outbound Relay Communication & Heartbeats
    # =========================================================================
    def send_agent_event(self, event_data):
        if "payload" in event_data and isinstance(event_data["payload"], dict):
            if "token" not in event_data["payload"]:
                event_data["payload"]["token"] = self.token
            if "machine_id" not in event_data["payload"]:
                event_data["payload"]["machine_id"] = self.machine_id

        # First attempt WebSocket transmission for zero-latency streaming
        if self.ws_relay and self.ws_connected and getattr(self.ws_relay, "authenticated", False):
            try:
                if self.ws_relay.send_text(json.dumps(event_data)):
                    return
            except Exception:
                pass

        # Fallback to HTTP POST
        url = f"{self.http_base}/api/v1/relay/event"
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(event_data).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "X-Machine-ID": self.machine_id,
                    "X-Enrollment-Token": self.token,
                    "User-Agent": "CyberVPS-Agent/1.0"
                },
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=4) as resp:
                pass
        except urllib.error.HTTPError as e:
            if e.code == 401:
                print(f"[!] HTTP Relay event unauthorized (401). Invalid token.")
        except Exception:
            pass

    def poll_server_commands(self):
        url = f"{self.http_base}/api/v1/relay/poll?machine_id={self.machine_id}&token={self.token}"
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "CyberVPS-Agent/1.0",
                    "X-Machine-ID": self.machine_id,
                    "X-Enrollment-Token": self.token
                }
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                for cmd in data.get("commands", []):
                    self.dispatch_server_command(cmd)
        except urllib.error.HTTPError as e:
            if e.code == 401:
                print(f"[!] HTTP Command Poll unauthorized (401). Check enrollment token.")
        except Exception:
            pass

    def dispatch_server_command(self, cmd):
        c_type = cmd.get("type")
        payload = cmd.get("payload", {})

        if c_type == "TriggerDiscovery":
            self.send_discovery_report()
        elif c_type == "TerminalStart":
            self.start_terminal_session(
                payload.get("session_id"),
                payload.get("cols", 80),
                payload.get("rows", 24),
                payload.get("shell") or payload.get("shell_preference")
            )
        elif c_type == "TerminalInput":
            self.write_terminal_input(payload.get("session_id"), payload.get("data", ""))
        elif c_type == "TerminalResize":
            self.resize_terminal(payload.get("session_id"), payload.get("cols", 80), payload.get("rows", 24))
        elif c_type == "TerminalKill":
            self.kill_terminal(payload.get("session_id"))
        elif c_type == "FileList":
            self.handle_file_list(payload)
        elif c_type == "FileRead":
            self.handle_file_read(payload)
        elif c_type == "FileWrite":
            self.handle_file_write(payload)
        elif c_type == "FileDelete":
            self.handle_file_delete(payload)
        elif c_type == "FileRename":
            self.handle_file_rename(payload)
        elif c_type == "FileMkdir":
            self.handle_file_mkdir(payload)
        elif c_type == "FileStat":
            self.handle_file_stat(payload)
        elif c_type == "ProcessList":
            self.handle_process_list(payload)
        elif c_type == "ProcessKill":
            self.handle_process_kill(payload)
        elif c_type == "ProcessStart":
            self.handle_process_start(payload)
        elif c_type == "ProcessDetails":
            self.handle_process_details(payload)
        elif c_type == "ServiceList":
            self.handle_service_list(payload)
        elif c_type == "ServiceAction":
            self.handle_service_action(payload)
        elif c_type == "TunnelOpenStream":
            self.handle_tunnel_open(
                payload.get("tunnel_id"),
                payload.get("stream_id"),
                payload.get("target_port")
            )
        elif c_type == "TunnelData":
            self.write_tunnel_data(payload.get("stream_id"), payload.get("data_base64", ""))
        elif c_type == "TunnelCloseStream":
            self.close_tunnel_stream(payload.get("stream_id"))

    def send_discovery_report(self):
        ports = self.discover_listening_ports()
        profile = self.discover_device_profile()
        self.send_agent_event({
            "type": "DiscoveryReport",
            "payload": {
                "machine_id": self.machine_id,
                "token": self.token,
                "ports": ports,
                "profile": profile,
                "processes": []
            }
        })

    def run(self):
        pid_file = os.path.join(os.path.expanduser("~"), ".cybervps", "run", "agent.pid")
        try:
            os.makedirs(os.path.dirname(pid_file), exist_ok=True)
            with open(pid_file, "w") as f:
                f.write(str(os.getpid()))
        except Exception:
            pass

        print(f"[*] CyberVPS Space Station Agent v{PROTOCOL_VERSION} Starting", flush=True)
        print(f"[*] Machine ID: {self.machine_id}", flush=True)
        print(f"[*] Server Target: {self.server_url}", flush=True)

        profile = self.discover_device_profile()
        caps = self.get_capabilities()

        auth_payload = {
            "type": "Auth",
            "payload": {
                "machine_id": self.machine_id,
                "token": self.token,
                "agent_version": PROTOCOL_VERSION,
                "hostname": socket.gethostname(),
                "os": platform.system(),
                "os_version": profile.get("os_full", platform.release()),
                "arch": platform.machine(),
                "capabilities": caps,
                "profile": profile
            }
        }
        # Start persistent WebSocket relay client FIRST for immediate fleet enrollment
        ws_url = self.server_url.replace("http://", "ws://").replace("https://", "wss://")
        if not ws_url.endswith("/api/v1/relay/connect"):
            ws_url = ws_url.rstrip("/") + "/api/v1/relay/connect"
        print(f"[*] Connecting WebSocket relay transport to {ws_url}...", flush=True)
        self.ws_relay = RelayWebSocket(self, ws_url)
        self.ws_relay.start()
        print("[*] WebSocket relay thread active.", flush=True)

        self.send_agent_event(auth_payload)
        self.send_discovery_report()

        last_hb = 0
        last_disc = 0

        try:
            # Fast 2-second telemetry loop
            while self.running:
                try:
                    now = time.time()
                    if now - last_hb >= 2.0:
                        metrics = self.get_system_metrics()
                        self.send_agent_event({
                            "type": "Heartbeat",
                            "payload": {
                                "machine_id": self.machine_id,
                                "token": self.token,
                                "timestamp": int(now),
                                "uptime_seconds": metrics["uptime_seconds"],
                                "cpu_usage": metrics["cpu_usage"],
                                "memory_used_bytes": metrics["memory_used_bytes"],
                                "memory_total_bytes": metrics["memory_total_bytes"],
                                "disk_used_bytes": metrics["disk_used_bytes"],
                                "disk_total_bytes": metrics["disk_total_bytes"]
                            }
                        })
                        last_hb = now

                    if now - last_disc > 60:
                        self.send_discovery_report()
                        last_disc = now

                    if not self.ws_connected:
                        self.poll_server_commands()

                    with self.lock:
                        has_active_term = len(self.active_terminals) > 0
                    if has_active_term:
                        time.sleep(0.05)
                    else:
                        time.sleep(0.5)
                except Exception:
                    time.sleep(1.0)
        finally:
            try:
                if os.path.exists(pid_file):
                    with open(pid_file, "r") as f:
                        if f.read().strip() == str(os.getpid()):
                            os.remove(pid_file)
            except Exception:
                pass


if __name__ == "__main__":
    log_file_env = os.environ.get("CYBERVPS_LOG_FILE")
    if log_file_env:
        try:
            os.makedirs(os.path.dirname(os.path.abspath(log_file_env)), exist_ok=True)
            _fp = open(log_file_env, "a", encoding="utf-8")
            if hasattr(_fp, "reconfigure"):
                _fp.reconfigure(line_buffering=True, write_through=True)
            sys.stdout = _fp
            sys.stderr = _fp
        except Exception:
            pass

    target = os.environ.get("CYBERVPS_SERVER", "https://cybervps-space-station.up.railway.app")
    token = os.environ.get("CYBERVPS_TOKEN", "cvps_enroll_master_token")
    mid = os.environ.get("CYBERVPS_MACHINE_ID", None)

    cfg_path = os.environ.get("CYBERVPS_CONFIG")
    if not cfg_path:
        home = os.path.expanduser("~")
        candidate = os.path.join(home, ".cybervps", "config.json")
        if os.path.exists(candidate):
            cfg_path = candidate

    if cfg_path and os.path.exists(cfg_path):
        try:
            with open(cfg_path, "r") as f:
                cfg = json.load(f)
                if cfg.get("server_url"):
                    target = cfg["server_url"]
                if cfg.get("token"):
                    token = cfg["token"]
                if cfg.get("machine_id"):
                    mid = cfg["machine_id"]
        except Exception as e:
            print(f"[!] Warning reading config {cfg_path}: {e}")

    args = sys.argv[1:]
    i = 0
    pos_idx = 0
    while i < len(args):
        a = args[i]
        if a in ("--server", "-s") and i + 1 < len(args):
            target = args[i + 1]
            i += 2
        elif a in ("--token", "-t") and i + 1 < len(args):
            token = args[i + 1]
            i += 2
        elif a in ("--machine-id", "-m") and i + 1 < len(args):
            mid = args[i + 1]
            i += 2
        elif a in ("--config", "-c") and i + 1 < len(args):
            c_file = args[i + 1]
            if os.path.exists(c_file):
                try:
                    with open(c_file, "r") as f:
                        c_data = json.load(f)
                        if c_data.get("server_url"):
                            target = c_data["server_url"]
                        if c_data.get("token"):
                            token = c_data["token"]
                        if c_data.get("machine_id"):
                            mid = c_data["machine_id"]
                except Exception:
                    pass
            i += 2
        elif not a.startswith("-"):
            if pos_idx == 0:
                target = a
            elif pos_idx == 1:
                token = a
            elif pos_idx == 2:
                mid = a
            pos_idx += 1
            i += 1
        else:
            i += 1

    try:
        agent = CyberVPSAgent(target, token, mid)
        agent.run()
    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(1)
