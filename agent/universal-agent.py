#!/usr/bin/env python3
"""
CyberVPS Space Station - Universal Self-Healing Cross-Platform Agent
Supports: Linux (root/non-root), Debian, Ubuntu, Windows PowerShell, restricted shells.
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

PROTOCOL_VERSION = "1.0.0"

class CyberVPSAgent:
    def __init__(self, server_url, token="cvps_enroll_master_token", machine_id=None):
        self.server_url = server_url.rstrip("/")
        # Convert ws:// or wss:// to http:// or https:// for HTTP-level polling/streaming
        self.http_base = self.server_url.replace("ws://", "http://").replace("wss://", "https://")
        self.token = token
        self.machine_id = machine_id or self.generate_machine_id()
        self.running = True
        self.active_terminals = {}
        self.active_tunnel_streams = {}
        self.lock = threading.Lock()
        self.uptime_start = time.time()
        
    def generate_machine_id(self):
        hostname = socket.gethostname()
        rand_suffix = "%08x" % random.randint(0, 0xFFFFFFFF)
        return f"cvps_{hostname}_{rand_suffix}"

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
            "shell": shell
        }

    def discover_listening_ports(self):
        ports = []
        # Method 1: On Linux, parse /proc/net/tcp
        if os.path.exists("/proc/net/tcp"):
            try:
                with open("/proc/net/tcp", "r") as f:
                    lines = f.readlines()[1:]
                    for line in lines:
                        parts = line.strip().split()
                        if len(parts) >= 4 and parts[3] == "0A": # 0A is TCP_LISTEN
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

        # Method 2: On Linux/Unix, ss or netstat
        if not ports:
            try:
                cmd = ["ss", "-tulpn"] if platform.system() != "Windows" else ["netstat", "-ano", "-p", "tcp"]
                out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, timeout=2).decode("utf-8", errors="ignore")
                for line in out.splitlines():
                    if "LISTEN" in line:
                        parts = line.split()
                        # Parse port
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

        # If still empty (e.g. unprivileged container or sandbox), probe common candidate ports
        candidates = [22, 80, 443, 2280, 3000, 4000, 5000, 5173, 6767, 8000, 8080, 8888, 9000, 22220, 22222, 33333]
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

        # Enrich ports with HTTP Probing (Title, Status, WebSocket)
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

    def get_system_metrics(self):
        # Platform agnostic CPU/RAM estimation
        cpu_usage = 0.0
        mem_used = 0
        mem_total = 1024 * 1024 * 1024
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
                    mem_free = mem_data.get("MemAvailable", mem_data.get("MemFree", 0))
                    mem_used = max(0, mem_total - mem_free)
            if os.path.exists("/proc/loadavg"):
                with open("/proc/loadavg", "r") as f:
                    load1 = float(f.read().split()[0])
                    cpu_usage = min(100.0, load1 * 25.0)
        except Exception:
            pass

        return {
            "uptime_seconds": int(time.time() - self.uptime_start),
            "cpu_usage": round(cpu_usage, 1),
            "memory_used_bytes": mem_used,
            "memory_total_bytes": mem_total,
            "disk_used_bytes": 10 * 1024 * 1024 * 1024,
            "disk_total_bytes": 50 * 1024 * 1024 * 1024
        }

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
            # Unix / Linux PTY
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
                r, _, _ = select.select([master_fd], [], [], 0.5)
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
                chunk = stream.read(1024)
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
            req = urllib.request.Request(
                url,
                data=json.dumps(event_data).encode("utf-8"),
                headers={"Content-Type": "application/json", "X-Machine-ID": self.machine_id},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                pass
        except Exception:
            pass

    def poll_server_commands(self):
        url = f"{self.http_base}/api/v1/relay/poll?machine_id={self.machine_id}&token={self.token}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "CyberVPS-Agent/1.0"})
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
        elif c_type == "TerminalKill":
            self.kill_terminal(payload.get("session_id"))
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
        self.send_agent_event({
            "type": "DiscoveryReport",
            "payload": {
                "machine_id": self.machine_id,
                "ports": ports,
                "processes": []
            }
        })

    def run(self):
        print(f"[*] CyberVPS Space Station Agent v{PROTOCOL_VERSION} Starting")
        print(f"[*] Machine ID: {self.machine_id}")
        print(f"[*] Server Target: {self.server_url}")

        # Send initial registration
        caps = self.get_capabilities()
        auth_payload = {
            "type": "Auth",
            "payload": {
                "machine_id": self.machine_id,
                "token": self.token,
                "agent_version": PROTOCOL_VERSION,
                "hostname": socket.gethostname(),
                "os": platform.system(),
                "os_version": platform.release(),
                "arch": platform.machine(),
                "capabilities": caps
            }
        }
        self.send_agent_event(auth_payload)
        self.send_discovery_report()

        last_hb = 0
        last_disc = 0

        while self.running:
            now = time.time()
            if now - last_hb > 10:
                metrics = self.get_system_metrics()
                self.send_agent_event({
                    "type": "Heartbeat",
                    "payload": {
                        "machine_id": self.machine_id,
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

            if now - last_disc > 30:
                self.send_discovery_report()
                last_disc = now

            # Poll for any server commands (terminals, tunnels)
            self.poll_server_commands()
            time.sleep(1)


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
    token = sys.argv[2] if len(sys.argv) > 2 else "cvps_enroll_master_token"
    mid = sys.argv[3] if len(sys.argv) > 3 else None

    agent = CyberVPSAgent(target, token, mid)
    agent.run()
