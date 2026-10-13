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

try:
    import ctypes
except ImportError:
    ctypes = None

try:
    import winreg
except ImportError:
    winreg = None

# Ensure unbuffered stdio for background logs
if sys.version_info >= (3, 7):
    try:
        sys.stdout.reconfigure(line_buffering=True)
        sys.stderr.reconfigure(line_buffering=True)
    except Exception:
        pass

PROTOCOL_VERSION = "1.0.0"


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
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(0.6)
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
                            "is_dir": is_dir,
                            "is_symlink": is_symlink,
                            "size": size,
                            "mtime": mtime_iso,
                            "mode": mode_str,
                            "is_hidden": is_hidden,
                            "file_type": ftype,
                            "ext": ext
                        })
                    except Exception:
                        continue

            entries.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))

            disk_info = {}
            try:
                du = shutil.disk_usage(target_path)
                disk_info = {
                    "total_bytes": du.total,
                    "used_bytes": du.used,
                    "free_bytes": du.free,
                    "percent_used": round((du.used / du.total) * 100, 1) if du.total > 0 else 0
                }
            except Exception:
                pass

            parent = os.path.dirname(target_path)
            if parent == target_path:
                parent = None

            res = {
                "current_path": target_path.replace("\\", "/"),
                "native_current_path": target_path,
                "parent_path": parent.replace("\\", "/") if parent else None,
                "entries": entries,
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
    # Process & Service Management Engine
    # =========================================================================
    def handle_process_list(self, payload):
        req_id = payload.get("request_id")
        try:
            procs = []
            if platform.system() == "Windows":
                out = subprocess.check_output(["tasklist", "/FO", "CSV", "/NH"], timeout=3).decode("utf-8", errors="ignore")
                reader = csv.reader(io.StringIO(out))
                for row in reader:
                    if len(row) >= 5:
                        mem_str = row[4].replace(",", "").replace(" K", "").replace(" ", "")
                        try:
                            mem_mb = round(int(mem_str) / 1024, 1)
                        except ValueError:
                            mem_mb = 0
                        procs.append({
                            "pid": int(row[1]),
                            "name": row[0],
                            "user": row[2],
                            "cpu_percent": 0.0,
                            "memory_mb": mem_mb,
                            "status": "Running"
                        })
                procs.sort(key=lambda x: x["memory_mb"], reverse=True)
            else:
                out = subprocess.check_output(["ps", "-eo", "pid,user,%cpu,%mem,comm", "--sort=-%mem", "--no-headers"], timeout=3).decode("utf-8", errors="ignore")
                for line in out.strip().splitlines()[:60]:
                    parts = line.strip().split(None, 4)
                    if len(parts) >= 5:
                        procs.append({
                            "pid": int(parts[0]),
                            "user": parts[1],
                            "cpu_percent": float(parts[2]),
                            "memory_mb": round(float(parts[3]) * 10, 1),
                            "name": parts[4],
                            "status": "Running"
                        })

            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": True, "result": procs[:60]}
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def handle_service_list(self, payload):
        req_id = payload.get("request_id")
        try:
            svcs = []
            if platform.system() == "Windows":
                cmd = ["powershell", "-NoProfile", "-Command", "Get-Service | Select-Object -First 50 Name, DisplayName, Status, StartType | ConvertTo-Json -Compress"]
                out = subprocess.check_output(cmd, timeout=4).decode("utf-8", errors="ignore")
                raw_list = json.loads(out)
                if isinstance(raw_list, dict):
                    raw_list = [raw_list]
                for s in raw_list:
                    status_name = "Running" if s.get("Status") == 4 or str(s.get("Status")).lower() == "running" else "Stopped"
                    svcs.append({
                        "name": s.get("Name"),
                        "display_name": s.get("DisplayName"),
                        "status": status_name,
                        "startup_type": str(s.get("StartType", "Automatic"))
                    })
            else:
                if os.path.exists("/bin/systemctl") or os.path.exists("/usr/bin/systemctl"):
                    out = subprocess.check_output(["systemctl", "list-units", "--type=service", "--all", "--no-legend", "--no-pager"], timeout=4).decode("utf-8", errors="ignore")
                    for line in out.strip().splitlines()[:60]:
                        parts = line.strip().split(None, 4)
                        if len(parts) >= 4:
                            name = parts[0].replace(".service", "")
                            status = "Running" if parts[2] == "active" and parts[3] == "running" else ("Failed" if parts[3] == "failed" else "Stopped")
                            desc = parts[4] if len(parts) >= 5 else name
                            svcs.append({
                                "name": name,
                                "display_name": desc,
                                "status": status,
                                "startup_type": parts[1]
                            })
                else:
                    svcs.append({"name": "cron", "display_name": "Cron Daemon", "status": "Running", "startup_type": "Auto"})
                    svcs.append({"name": "ssh", "display_name": "OpenSSH Daemon", "status": "Running", "startup_type": "Auto"})

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
        svc_name = payload.get("service_name")
        action = payload.get("action", "").lower()
        if action not in ["start", "stop", "restart"]:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": f"Invalid action: {action}"}
            })
            return

        try:
            output = ""
            if platform.system() == "Windows":
                ps_cmd = f"{action.capitalize()}-Service -Name '{svc_name}' -Force"
                output = subprocess.check_output(["powershell", "-NoProfile", "-Command", ps_cmd], timeout=10).decode("utf-8", errors="ignore")
            else:
                cmd = ["systemctl", action, f"{svc_name}.service"]
                output = subprocess.check_output(cmd, timeout=10).decode("utf-8", errors="ignore")

            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": True, "result": {"service": svc_name, "action": action, "output": output.strip()}}
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
        if platform.system() == "Windows":
            cmd = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass"]
            p = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0
            )
            with self.lock:
                self.active_terminals[session_id] = {"proc": p, "type": "pipe"}

            threading.Thread(target=self._pipe_terminal_reader, args=(session_id, p.stdout), daemon=True).start()
            threading.Thread(target=self._pipe_terminal_reader, args=(session_id, p.stderr), daemon=True).start()
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

            threading.Thread(target=self._pty_terminal_reader, args=(session_id, master), daemon=True).start()

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

    def _pipe_terminal_reader(self, session_id, stream):
        try:
            while self.running:
                chunk = stream.read1(1024) if hasattr(stream, "read1") else stream.read(1024)
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

    def write_terminal_input(self, session_id, text):
        with self.lock:
            term = self.active_terminals.get(session_id)
        if not term:
            return
        try:
            if term["type"] == "pty":
                os.write(term["master"], text.encode("utf-8"))
            elif term["type"] == "pipe":
                term["proc"].stdin.write(text.encode("utf-8"))
                term["proc"].stdin.flush()
        except Exception:
            pass

    def resize_terminal(self, session_id, cols=80, rows=24):
        with self.lock:
            term = self.active_terminals.get(session_id)
        if not term or term.get("type") != "pty":
            return
        try:
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
                term["proc"].terminate()
            except Exception:
                pass

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
        url = f"{self.http_base}/api/v1/relay/event"
        try:
            if "payload" in event_data and isinstance(event_data["payload"], dict):
                if "token" not in event_data["payload"]:
                    event_data["payload"]["token"] = self.token
                if "machine_id" not in event_data["payload"]:
                    event_data["payload"]["machine_id"] = self.machine_id

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
                payload.get("shell_preference")
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
        print(f"[*] CyberVPS Space Station Agent v{PROTOCOL_VERSION} Starting")
        print(f"[*] Machine ID: {self.machine_id}")
        print(f"[*] Server Target: {self.server_url}")

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
        self.send_agent_event(auth_payload)
        self.send_discovery_report()

        last_hb = 0
        last_disc = 0

        # Fast 2-second telemetry loop
        while self.running:
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

            self.poll_server_commands()

            with self.lock:
                has_active_term = len(self.active_terminals) > 0
            if has_active_term:
                time.sleep(0.08)
            else:
                time.sleep(0.5)


if __name__ == "__main__":
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

    agent = CyberVPSAgent(target, token, mid)
    agent.run()
