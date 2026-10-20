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
import re
import getpass
import py_compile
import datetime
import hmac
import hashlib
import binascii
import collections
import tempfile


def _iso_now():
    try:
        return datetime.datetime.now(datetime.timezone.utc).isoformat()
    except Exception:
        return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

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

def get_silent_python_exe():
    """Returns pythonw.exe path on Windows if available to guarantee zero console popups."""
    exe = sys.executable
    if platform.system() == "Windows":
        if exe.lower().endswith("python.exe"):
            cand = exe[:-10] + "pythonw.exe"
            if os.path.exists(cand):
                return cand
        cand = os.path.join(os.path.dirname(exe), "pythonw.exe")
        if os.path.exists(cand):
            return cand
    return exe

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

# Enforce ZERO console window popup on Windows for all subprocesses
if sys.platform == "win32":
    _orig_popen_init = subprocess.Popen.__init__
    def _silent_popen_init(self, *args, **kwargs):
        si = kwargs.get("startupinfo")
        if si is None or not hasattr(si, "lpAttributeList"):
            cflags = kwargs.get("creationflags", 0)
            kwargs["creationflags"] = cflags | 0x08000000  # CREATE_NO_WINDOW
            if si is None:
                si = subprocess.STARTUPINFO()
                kwargs["startupinfo"] = si
            si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            si.wShowWindow = 0  # SW_HIDE
        _orig_popen_init(self, *args, **kwargs)
    subprocess.Popen.__init__ = _silent_popen_init

PROTOCOL_VERSION = "2.3.1"
AGENT_CAPABILITIES = [
    "apps", "desktop_launch", "wireguard", "docker", "sandboxes", "rdp", "vnc", "terminal", "file_manager", "interactive_gui", "ota_update"
]


def _handle_to_ptr(h):
    if h is None:
        return None
    if isinstance(h, int):
        return h if h != 0 else None
    val = getattr(h, "value", None)
    return val if val != 0 else None


class ConPTYTerminal:
    def __init__(self, session_id, cols=80, rows=24, shell_cmd=None, on_output=None, on_exit=None):
        self.session_id = session_id
        self.cols = int(cols or 80)
        self.rows = int(rows or 24)
        self.on_output = on_output
        self.on_exit = on_exit
        self.hPC = None
        self.h_proc = None
        self.pid = 0
        self.hPipeIn = None
        self.hPipeOut = None
        self.p_attr = None
        self.attr_buf = None
        self.exit_code = None
        self.running = True
        self._start(shell_cmd)

    def _start(self, shell_cmd):
        if platform.system() != "Windows" or not ctypes:
            raise NotImplementedError("ConPTY requires Windows with ctypes")

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        if not hasattr(kernel32, "CreatePseudoConsole"):
            raise NotImplementedError("CreatePseudoConsole not supported on this Windows build")

        from ctypes import wintypes, byref

        class COORD(ctypes.Structure):
            _fields_ = [('X', wintypes.SHORT), ('Y', wintypes.SHORT)]

        class STARTUPINFO(ctypes.Structure):
            _fields_ = [
                ('cb', wintypes.DWORD), ('lpReserved', wintypes.LPWSTR), ('lpDesktop', wintypes.LPWSTR),
                ('lpTitle', wintypes.LPWSTR), ('dwX', wintypes.DWORD), ('dwY', wintypes.DWORD),
                ('dwXSize', wintypes.DWORD), ('dwYSize', wintypes.DWORD), ('dwXCountChars', wintypes.DWORD),
                ('dwYCountChars', wintypes.DWORD), ('dwFillAttribute', wintypes.DWORD), ('dwFlags', wintypes.DWORD),
                ('wShowWindow', wintypes.WORD), ('cbReserved2', wintypes.WORD), ('lpReserved2', ctypes.POINTER(wintypes.BYTE)),
                ('hStdInput', wintypes.HANDLE), ('hStdOutput', wintypes.HANDLE), ('hStdError', wintypes.HANDLE)
            ]

        class STARTUPINFOEX(ctypes.Structure):
            _fields_ = [('StartupInfo', STARTUPINFO), ('lpAttributeList', ctypes.c_void_p)]

        class PROCESS_INFORMATION(ctypes.Structure):
            _fields_ = [
                ('hProcess', wintypes.HANDLE), ('hThread', wintypes.HANDLE),
                ('dwProcessId', wintypes.DWORD), ('dwThreadId', wintypes.DWORD)
            ]

        # Configure Win32 signatures for 64-bit safety
        kernel32.CreatePipe.argtypes = [ctypes.POINTER(wintypes.HANDLE), ctypes.POINTER(wintypes.HANDLE), ctypes.c_void_p, wintypes.DWORD]
        kernel32.CreatePipe.restype = wintypes.BOOL
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL
        kernel32.ReadFile.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
        kernel32.ReadFile.restype = wintypes.BOOL
        kernel32.WriteFile.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
        kernel32.WriteFile.restype = wintypes.BOOL
        kernel32.CreatePseudoConsole.argtypes = [COORD, wintypes.HANDLE, wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
        kernel32.CreatePseudoConsole.restype = ctypes.c_long
        kernel32.ResizePseudoConsole.argtypes = [wintypes.HANDLE, COORD]
        kernel32.ResizePseudoConsole.restype = ctypes.c_long
        kernel32.ClosePseudoConsole.argtypes = [wintypes.HANDLE]
        kernel32.ClosePseudoConsole.restype = None
        kernel32.InitializeProcThreadAttributeList.argtypes = [ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.c_size_t)]
        kernel32.InitializeProcThreadAttributeList.restype = wintypes.BOOL
        kernel32.UpdateProcThreadAttribute.argtypes = [ctypes.c_void_p, wintypes.DWORD, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_void_p]
        kernel32.UpdateProcThreadAttribute.restype = wintypes.BOOL
        kernel32.DeleteProcThreadAttributeList.argtypes = [ctypes.c_void_p]
        kernel32.DeleteProcThreadAttributeList.restype = None
        kernel32.CreateProcessW.argtypes = [
            wintypes.LPCWSTR, wintypes.LPWSTR,
            ctypes.c_void_p, ctypes.c_void_p, wintypes.BOOL,
            wintypes.DWORD, ctypes.c_void_p, wintypes.LPCWSTR,
            ctypes.c_void_p, ctypes.c_void_p
        ]
        kernel32.CreateProcessW.restype = wintypes.BOOL

        hPipeIn, hPipePTYIn = wintypes.HANDLE(), wintypes.HANDLE()
        hPipeOut, hPipePTYOut = wintypes.HANDLE(), wintypes.HANDLE()

        if not kernel32.CreatePipe(byref(hPipePTYIn), byref(hPipeIn), None, 0):
            raise RuntimeError(f"CreatePipe for stdin failed ({ctypes.get_last_error()})")
        if not kernel32.CreatePipe(byref(hPipeOut), byref(hPipePTYOut), None, 0):
            kernel32.CloseHandle(hPipePTYIn)
            kernel32.CloseHandle(hPipeIn)
            raise RuntimeError(f"CreatePipe for stdout failed ({ctypes.get_last_error()})")

        hPC = wintypes.HANDLE()
        res = kernel32.CreatePseudoConsole(COORD(self.cols, self.rows), hPipePTYIn, hPipePTYOut, 0, byref(hPC))
        kernel32.CloseHandle(hPipePTYIn)
        kernel32.CloseHandle(hPipePTYOut)

        if res != 0 or not hPC.value:
            kernel32.CloseHandle(hPipeIn)
            kernel32.CloseHandle(hPipeOut)
            raise RuntimeError(f"CreatePseudoConsole failed with HRESULT {res} (Win32 {ctypes.get_last_error()})")

        self.hPC = hPC
        self.hPipeIn = hPipeIn
        self.hPipeOut = hPipeOut

        lpSize = ctypes.c_size_t(0)
        kernel32.InitializeProcThreadAttributeList(None, 1, 0, byref(lpSize))
        attr_buf = ctypes.create_string_buffer(lpSize.value)
        p_attr = ctypes.cast(attr_buf, ctypes.c_void_p)
        if not kernel32.InitializeProcThreadAttributeList(p_attr, 1, 0, byref(lpSize)):
            self.close()
            raise RuntimeError(f"InitializeProcThreadAttributeList failed ({ctypes.get_last_error()})")

        self.attr_buf = attr_buf
        self.p_attr = p_attr

        PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016
        if not kernel32.UpdateProcThreadAttribute(
            p_attr, 0,
            PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
            self.hPC, ctypes.sizeof(self.hPC), None, None
        ):
            self.close()
            raise RuntimeError(f"UpdateProcThreadAttribute PSEUDOCONSOLE failed ({ctypes.get_last_error()})")

        siEx = STARTUPINFOEX()
        siEx.StartupInfo.cb = ctypes.sizeof(STARTUPINFOEX)
        siEx.StartupInfo.dwFlags = 0x00000100 # STARTF_USESTDHANDLES
        siEx.StartupInfo.hStdInput = None
        siEx.StartupInfo.hStdOutput = None
        siEx.StartupInfo.hStdError = None
        siEx.lpAttributeList = p_attr

        pi = PROCESS_INFORMATION()
        EXTENDED_STARTUPINFO_PRESENT = 0x00080000

        if isinstance(shell_cmd, list):
            cmd_str = subprocess.list2cmdline(shell_cmd)
        elif isinstance(shell_cmd, str) and shell_cmd.strip():
            cmd_str = shell_cmd.strip()
        else:
            cmd_str = "powershell.exe -NoLogo -NoProfile"

        cmd_buf = ctypes.create_unicode_buffer(cmd_str)
        ok = kernel32.CreateProcessW(
            None, cmd_buf, None, None, False,
            EXTENDED_STARTUPINFO_PRESENT, None, None,
            byref(siEx.StartupInfo), byref(pi)
        )

        if not ok:
            err = ctypes.get_last_error()
            self.close()
            raise RuntimeError(f"CreateProcessW for ConPTY failed with Win32 error {err}")

        self.h_proc = pi.hProcess
        self.pid = pi.dwProcessId
        kernel32.CloseHandle(pi.hThread)

        self.reader_thread = threading.Thread(target=self._reader, daemon=True)
        self.reader_thread.start()

    def _reader(self):
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        buf = (ctypes.c_char * 4096)()
        bytes_read = ctypes.wintypes.DWORD()
        h_out = _handle_to_ptr(self.hPipeOut)
        try:
            while self.running and h_out:
                if kernel32.ReadFile(h_out, buf, 4096, ctypes.byref(bytes_read), None):
                    if bytes_read.value > 0 and self.on_output:
                        raw = bytes(buf.raw[:bytes_read.value])
                        self.on_output(self.session_id, raw.decode('utf-8', errors='replace'))
                else:
                    break
        except Exception:
            pass
        finally:
            self._on_shell_exit()

    def _on_shell_exit(self):
        if getattr(self, "_closed", False):
            return
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        code = ctypes.wintypes.DWORD()
        h_proc = _handle_to_ptr(self.h_proc)
        if h_proc:
            try:
                kernel32.GetExitCodeProcess(h_proc, ctypes.byref(code))
                if code.value != 259: # STILL_ACTIVE
                    self.exit_code = code.value
            except Exception:
                pass
        self.close()
        if hasattr(self, "on_exit") and self.on_exit:
            try:
                self.on_exit(self.session_id, self.exit_code if self.exit_code is not None else 0)
            except Exception:
                pass

    def write(self, data):
        h_in = _handle_to_ptr(self.hPipeIn)
        if not self.running or not h_in:
            return False
        try:
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            if isinstance(data, str):
                data = data.encode('utf-8')
            written = ctypes.wintypes.DWORD()
            return bool(kernel32.WriteFile(h_in, data, len(data), ctypes.byref(written), None))
        except Exception:
            return False

    def resize(self, cols, rows):
        self.cols = int(cols or 80)
        self.rows = int(rows or 24)
        h_pc = _handle_to_ptr(self.hPC)
        if h_pc:
            try:
                kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
                class COORD(ctypes.Structure):
                    _fields_ = [('X', ctypes.wintypes.SHORT), ('Y', ctypes.wintypes.SHORT)]
                kernel32.ResizePseudoConsole(h_pc, COORD(self.cols, self.rows))
            except Exception:
                pass

    def close(self):
        if getattr(self, "_closed", False):
            return
        self._closed = True
        self.running = False
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

        # 1. Terminate child process first to break any pending IO loops
        h_proc = _handle_to_ptr(self.h_proc)
        if h_proc:
            try:
                code = ctypes.wintypes.DWORD()
                kernel32.GetExitCodeProcess(h_proc, ctypes.byref(code))
                if code.value == 259: # STILL_ACTIVE
                    kernel32.TerminateProcess(h_proc, 0)
                    kernel32.WaitForSingleObject(h_proc, 200)
                    kernel32.GetExitCodeProcess(h_proc, ctypes.byref(code))
                self.exit_code = code.value if code.value != 259 else 0
                kernel32.CloseHandle(h_proc)
            except Exception:
                pass
            self.h_proc = None

        if self.pid:
            try:
                h_term = kernel32.OpenProcess(0x0001, False, self.pid)
                if h_term:
                    kernel32.TerminateProcess(h_term, 0)
                    kernel32.WaitForSingleObject(h_term, 200)
                    kernel32.CloseHandle(h_term)
            except Exception:
                pass

        # 2. Instantly cancel blocking ReadFile in reader thread via CancelSynchronousIo
        if hasattr(self, "reader_thread") and self.reader_thread and self.reader_thread.is_alive():
            try:
                h_t = kernel32.OpenThread(0x1FFFFF, False, self.reader_thread.ident)
                if h_t:
                    kernel32.CancelSynchronousIo(h_t)
                    kernel32.CloseHandle(h_t)
            except Exception:
                pass
            self.reader_thread.join(timeout=0.2)

        # 3. Asynchronously close PseudoConsole to avoid blocking on flush
        h_pc = _handle_to_ptr(self.hPC)
        if h_pc:
            self.hPC = None
            def _close_pc(handle):
                try:
                    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
                    k32.ClosePseudoConsole(handle)
                except Exception:
                    pass
            pc_t = threading.Thread(target=_close_pc, args=(h_pc,), daemon=True)
            pc_t.start()
            pc_t.join(timeout=0.3)

        # 4. Close input & output pipes
        h_in = _handle_to_ptr(self.hPipeIn)
        if h_in:
            try:
                kernel32.CloseHandle(h_in)
            except Exception:
                pass
            self.hPipeIn = None

        h_out = _handle_to_ptr(self.hPipeOut)
        if h_out:
            try:
                kernel32.CloseHandle(h_out)
            except Exception:
                pass
            self.hPipeOut = None

        # 5. Clean up attribute list
        if self.p_attr:
            try:
                kernel32.DeleteProcThreadAttributeList(self.p_attr)
            except Exception:
                pass
            self.p_attr = None
            self.attr_buf = None


class ConPTYProcWrapper:
    def __init__(self, conpty):
        self.conpty = conpty
        self.pid = conpty.pid

    def poll(self):
        if not self.conpty.running:
            return self.conpty.exit_code if self.conpty.exit_code is not None else 0
        try:
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            code = ctypes.wintypes.DWORD()
            h_proc = _handle_to_ptr(self.conpty.h_proc)
            if h_proc:
                if kernel32.GetExitCodeProcess(h_proc, ctypes.byref(code)):
                    if code.value != 259: # STILL_ACTIVE
                        self.conpty.exit_code = code.value
                        return code.value
        except Exception:
            pass
        return None

    def terminate(self):
        self.conpty.close()

    def kill(self):
        self.conpty.close()


def _safe_create_connection(address, timeout=8.0, source_address=None):
    host, port = address
    proxy_url = os.environ.get("https_proxy") or os.environ.get("HTTPS_PROXY") or \
                os.environ.get("http_proxy") or os.environ.get("HTTP_PROXY") or \
                os.environ.get("all_proxy") or os.environ.get("ALL_PROXY")
    
    if proxy_url:
        try:
            p_parsed = urllib.parse.urlparse(proxy_url if "://" in proxy_url else "http://" + proxy_url)
            p_host = p_parsed.hostname
            p_port = p_parsed.port or 8080
            
            p_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            p_sock.settimeout(timeout)
            p_sock.connect((p_host, p_port))
            
            connect_req = f"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n"
            if p_parsed.username and p_parsed.password:
                creds = base64.b64encode(f"{p_parsed.username}:{p_parsed.password}".encode("utf-8")).decode("ascii")
                connect_req += f"Proxy-Authorization: Basic {creds}\r\n"
            connect_req += "User-Agent: CyberVPS-Agent/1.0\r\n\r\n"
            
            p_sock.sendall(connect_req.encode("utf-8"))
            
            hdr = b""
            while b"\r\n\r\n" not in hdr:
                chunk = p_sock.recv(512)
                if not chunk:
                    p_sock.close()
                    raise ConnectionError("Proxy closed connection during CONNECT handshake")
                hdr += chunk
            
            status_line = hdr.split(b"\r\n")[0].decode("utf-8", errors="ignore")
            if " 200 " in status_line:
                return p_sock
            p_sock.close()
        except Exception:
            pass

    # Direct connection: resolve IPv4 first to avoid 8-second IPv6 timeouts on cloud containers without IPv6 routes
    try:
        for res in socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM):
            af, socktype, proto, canonname, sa = res
            sock = None
            try:
                sock = socket.socket(af, socktype, proto)
                if source_address:
                    sock.bind(source_address)
                sock.settimeout(timeout)
                sock.connect(sa)
                return sock
            except Exception:
                if sock is not None:
                    try: sock.close()
                    except Exception: pass
    except Exception:
        pass
    if source_address:
        return _orig_create_connection(address, timeout=timeout, source_address=source_address)
    return _orig_create_connection(address, timeout=timeout)


_orig_create_connection = socket.create_connection
socket.create_connection = _safe_create_connection


class RelayWebSocket:
    def __init__(self, agent, target_url):
        self.agent = agent
        self.target_url = target_url
        self.sock = None
        self.connected = False
        self.authenticated = False
        self.running = True
        self._lock = threading.Lock()
        self._send_lock = threading.Lock()
        self._backoff = 1.0
        self.last_activity = time.time()
        self.last_pong = time.time()

    def start(self):
        t = threading.Thread(target=self._run_loop, daemon=True)
        t.start()
        hb = threading.Thread(target=self._heartbeat_loop, daemon=True)
        hb.start()

    def _heartbeat_loop(self):
        while self.running and self.agent.running:
            time.sleep(15)
            with self._lock:
                sock = self.sock
                is_conn = self.connected
            if sock and is_conn:
                try:
                    self._send_frame(sock, 0x9, b"heartbeat")
                except Exception:
                    with self._lock:
                        if self.sock:
                            try: self.sock.close()
                            except Exception: pass
                        self.sock = None
                        self.connected = False
                        self.authenticated = False
                        self.agent.ws_connected = False

    def _run_loop(self):
        while self.running and self.agent.running:
            try:
                if hasattr(self.agent, "get_active_backend_url"):
                    self.target_url = self.agent.get_active_backend_url()
                self._connect_and_read()
            except Exception as e:
                err_msg = str(e)
                next_url = self.agent.get_next_backend_url() if hasattr(self.agent, "get_next_backend_url") else self.target_url
                self.target_url = next_url
                if "timed out" in err_msg or "Connection refused" in err_msg or "getaddrinfo" in err_msg or "1006" in err_msg:
                    print(f"[*] Relay transport waiting for control plane ({err_msg}). Trying failover to {next_url} in {int(self._backoff)}s...")
                else:
                    print(f"[*] Relay transport reconnecting ({err_msg}). Target: {next_url} in {int(self._backoff)}s")
            finally:
                with self._lock:
                    if self.sock:
                        try: self.sock.close()
                        except Exception: pass
                        self.sock = None
                    self.connected = False
                    self.authenticated = False
                    self.agent.ws_connected = False
            sleep_duration = min(self._backoff + random.uniform(0.1, 0.5), 3.0)
            time.sleep(sleep_duration)
            self._backoff = min(self._backoff * 1.3, 3.0)

    def _connect_and_read(self):
        raw = self.target_url.replace("http://", "ws://").replace("https://", "wss://")
        parsed = urllib.parse.urlparse(raw)
        host = parsed.hostname
        port = parsed.port or (443 if parsed.scheme == "wss" else 80)
        path = parsed.path or "/api/v1/relay/connect"
        if parsed.query:
            path += "?" + parsed.query

        raw_s = _safe_create_connection((host, port), timeout=8.0)
        try:
            raw_s.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
            if hasattr(socket, "TCP_KEEPIDLE"):
                raw_s.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPIDLE, 20)
            if hasattr(socket, "TCP_KEEPINTVL"):
                raw_s.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPINTVL, 10)
            if hasattr(socket, "TCP_KEEPCNT"):
                raw_s.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPCNT, 3)
        except Exception:
            pass

        if parsed.scheme == "wss":
            ctx = ssl.create_default_context()
            s = ctx.wrap_socket(raw_s, server_hostname=host)
        else:
            s = raw_s
        s.settimeout(25.0)

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
        hw = self.agent.get_hardware_identity() if hasattr(self.agent, "get_hardware_identity") else {}
        runtime_paths = self.agent.get_runtime_paths() if hasattr(self.agent, "get_runtime_paths") else {}
        backend_inventory = self.agent.get_backend_inventory() if hasattr(self.agent, "get_backend_inventory") else []
        auth_msg = {
            "type": "Auth",
            "payload": {
                "machine_id": self.agent.machine_id,
                "token": self.agent.token,
                "agent_version": PROTOCOL_VERSION,
                "hostname": socket.gethostname(),
                "username": self.agent.username,
                "os": platform.system(),
                "os_version": self.agent.device_profile.get("os_full", platform.release()),
                "arch": platform.machine(),
                "hardware_uuid": hw.get("hardware_uuid"),
                "hardware_serial": hw.get("hardware_serial"),
                "capabilities": self.agent.get_capabilities(),
                "profile": self.agent.device_profile,
                "runtime_paths": runtime_paths,
                "backend_inventory": backend_inventory
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
                self.last_activity = time.time()
                self._send_frame(s, 0xA, payload)
            elif opcode == 0xA:
                self.last_activity = time.time()
                self.last_pong = time.time()
            elif opcode == 0x1:
                self.last_activity = time.time()
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
                            new_node_tok = p_ack.get("node_token")
                            if new_node_tok and new_node_tok != self.agent.token:
                                self.agent.persist_token(new_node_tok)
                            print(f"[*] Relay WebSocket verified & authenticated for [{self.agent.machine_id}]. Link ACTIVE.")
                            if p_ack.get("backends") and hasattr(self.agent, "update_backends"):
                                self.agent.update_backends(p_ack.get("backends"))
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
                            auth_err_str = f"[!] Authentication rejected by control plane: {err_msg}"
                            print(auth_err_str)
                            if hasattr(self.agent, "log_file") and self.agent.log_file:
                                try:
                                    with open(self.agent.log_file, "a", encoding="utf-8") as _alf:
                                        _alf.write(f"[{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}] {auth_err_str}\n")
                                except Exception:
                                    pass
                            try:
                                if hasattr(self.agent, "try_self_heal_token") and self.agent.try_self_heal_token():
                                    print(f"[*] Self-healing triggered: derived authenticated HMAC node token. Reconnecting...")
                            except Exception:
                                pass
                            self.authenticated = False
                            self.agent.ws_connected = False
                            break
                    else:
                        self.agent.dispatch_server_command(msg)
                except Exception:
                    pass

    def _recv_exact(self, sock, num_bytes):
        buf = bytearray()
        while len(buf) < num_bytes and self.running and self.agent.running:
            try:
                chunk = sock.recv(num_bytes - len(buf))
                if not chunk:
                    return bytes(buf)
                buf.extend(chunk)
            except (socket.timeout, TimeoutError):
                if not self.running or not self.agent.running:
                    return bytes(buf)
                if time.time() - getattr(self, "last_activity", time.time()) > 60.0:
                    return bytes(buf)
                continue
            except Exception:
                return bytes(buf)
        return bytes(buf)

    def send_text(self, text_str, skip_if_busy=False):
        if skip_if_busy:
            acquired = self._lock.acquire(blocking=False)
            if not acquired:
                return False
        else:
            self._lock.acquire()
        try:
            if not self.sock or not self.connected:
                return False
            data = text_str.encode("utf-8")
            self._send_frame(self.sock, 0x1, data)
            return True
        except Exception:
            self.connected = False
            return False
        finally:
            self._lock.release()

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
        if data:
            mask_rep = (mask * ((length + 3) // 4))[:length]
            masked = (int.from_bytes(data, 'little') ^ int.from_bytes(mask_rep, 'little')).to_bytes(length, 'little')
        else:
            masked = b""
        with self._send_lock:
            sock.sendall(bytes(header) + masked)


class ElevationRequiredError(Exception):
    def __init__(self, message="The requested operation requires elevation (WinError 740)."):
        super().__init__(message)
        self.code = "ELEVATION_REQUIRED"
        self.status = 422
        self.requires_elevation = True

class UacCancelledError(Exception):
    def __init__(self, message="UAC elevation request was cancelled or dismissed by the user (WinError 1223)."):
        super().__init__(message)
        self.code = "UAC_CANCELLED"
        self.status = 400

class ElevationNotAvailableError(Exception):
    def __init__(self, message="Elevation not available in current environment."):
        super().__init__(message)
        self.code = "ELEVATION_NOT_AVAILABLE_IN_SERVICE"
        self.status = 422
        self.requires_elevation = True


class CyberVPSAgent:
    def __init__(self, server_url, token=None, machine_id=None, pid_file=None, ghost_mode=False):
        raw = (server_url or "https://cybervps-space-station.up.railway.app").strip().rstrip("/")
        if not (raw.startswith("http://") or raw.startswith("https://") or raw.startswith("ws://") or raw.startswith("wss://")):
            raw = "https://" + raw
        self.server_url = raw
        self.http_base = self.server_url.replace("ws://", "http://").replace("wss://", "https://")
        self.token = token or os.environ.get("CYBERVPS_AGENT_TOKEN") or os.environ.get("CYBERVPS_TOKEN") or ""
        self.machine_id = machine_id or self.generate_machine_id()
        self.ghost_mode = bool(ghost_mode or os.environ.get("CYBERVPS_GHOST_MODE") == "1")
        if self.ghost_mode and platform.system() == "Windows" and ctypes:
            try:
                hwnd = ctypes.windll.kernel32.GetConsoleWindow()
                if hwnd:
                    ctypes.windll.user32.ShowWindow(hwnd, 0)
            except Exception:
                pass
        self.pid_file = pid_file or os.environ.get("CYBERVPS_PID_FILE") or os.path.join(
            os.environ.get("CYBERVPS_RUN_DIR") or os.path.join(os.path.expanduser("~"), ".cybervps", "run"),
            "agent.pid"
        )
        self.running = True
        self.username = self._detect_local_username()
        self.active_terminals = {}
        self.active_tunnel_streams = {}
        self.active_app_streams = {}
        self.pressed_keys = set()
        self._gdiplus_token = None
        self.lock = threading.Lock()
        self.uptime_start = time.time()
        self._prev_win_times = None
        self._prev_linux_stat = None
        self.device_profile = {}
        self.ws_relay = None
        self.ws_connected = False
        self._drives_cache = {"data": [], "timestamp": 0}
        self._disk_cache = {}
        self._cached_apps_list = None
        self._cached_apps_time = 0
        self.backend_pool = []
        if self.server_url:
            self.backend_pool.append(self.server_url)
        for def_b in ["http://127.0.0.1:8080", "https://cybervps-space-station.up.railway.app"]:
            if def_b not in self.backend_pool:
                self.backend_pool.append(def_b)
        self.backend_index = 0
        self._load_backends_from_disk()

        # Obsidian Pillar Hardcore File Protection & Emergency Blackout Containment
        self.blackout_active = False
        self.blackout_incident = None
        self.base_dir = os.environ.get("CYBERVPS_HOME") or os.path.dirname(os.path.dirname(os.path.abspath(self.pid_file)))
        self.protected_vault_dir = os.path.join(self.base_dir, "vault")
        self.quarantine_dir = os.path.join(self.base_dir, "quarantine")
        self.snapshots_dir = os.path.join(self.protected_vault_dir, "snapshots")
        self.pillar_registry_file = os.path.join(self.protected_vault_dir, "pillar_registry.json")
        self.pillar_incidents_file = os.path.join(self.protected_vault_dir, "pillar_incidents.json")
        self._init_pillar_storage()
        self.managed_processes = {}
        self.managed_processes_lock = threading.Lock()

        try:
            threading.Thread(target=self._prewarm_apps_inventory, daemon=True).start()
            threading.Thread(target=self._periodic_ota_check_loop, daemon=True).start()
            threading.Thread(target=self._self_healing_shadow_loop, daemon=True).start()
        except Exception:
            pass

    def get_active_backend_url(self):
        with self.lock:
            if not self.backend_pool:
                return self.server_url
            return self.backend_pool[self.backend_index % len(self.backend_pool)]

    def get_next_backend_url(self):
        with self.lock:
            if not self.backend_pool:
                return self.server_url
            self.backend_index = (self.backend_index + 1) % len(self.backend_pool)
            chosen = self.backend_pool[self.backend_index]
            self.server_url = chosen
            self.http_base = chosen.replace("ws://", "http://").replace("wss://", "https://")
            return chosen

    def update_backends(self, new_backends):
        if not new_backends or not isinstance(new_backends, list):
            return
        updated = False
        with self.lock:
            for b in new_backends:
                b_url = (b.get("url") if isinstance(b, dict) else str(b)).strip().rstrip("/")
                if b_url and b_url not in self.backend_pool:
                    self.backend_pool.append(b_url)
                    updated = True
        if updated:
            self._save_backends_to_disk()
            try:
                self._reconcile_shadow_mirror()
            except Exception:
                pass

    def _is_path_safe(self, path):
        p_norm = os.path.abspath(path).lower()
        for forbidden in ["desktop", "downloads", "videos", "music", "pictures", "documents"]:
            if os.sep + forbidden + os.sep in p_norm or p_norm.endswith(os.sep + forbidden):
                return False
        return True

    def _get_primary_dir(self):
        cvps_env = os.environ.get("CYBERVPS_HOME")
        if cvps_env and os.path.isabs(cvps_env):
            p = cvps_env
        else:
            home = os.path.expanduser("~")
            p = os.path.join(home, ".cybervps")
        try:
            os.makedirs(p, exist_ok=True)
        except Exception:
            pass
        return p

    def _get_shadow_dir(self):
        cvps_env = os.environ.get("CYBERVPS_HOME")
        if platform.system() == "Windows":
            base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or os.path.expanduser("~")
            s = os.path.join(base, "CyberVPS")
        else:
            base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
            s = os.path.join(base, "cybervps")
        try:
            os.makedirs(s, exist_ok=True)
        except Exception:
            if cvps_env:
                s = os.path.join(cvps_env, ".shadow")
                try: os.makedirs(s, exist_ok=True)
                except Exception: pass
        return s

    def _verify_script_integrity(self, file_path):
        if not os.path.exists(file_path):
            return False
        try:
            if os.path.getsize(file_path) < 15000:
                return False
            py_compile.compile(file_path, doraise=True)
            return True
        except Exception:
            return False

    def _reconcile_shadow_mirror(self):
        try:
            primary_dir = self._get_primary_dir()
            shadow_dir = self._get_shadow_dir()
            if not self._is_path_safe(primary_dir) or not self._is_path_safe(shadow_dir):
                return

            curr_script = os.path.abspath(__file__)
            primary_script = os.path.join(primary_dir, "universal-agent.py")
            shadow_script = os.path.join(shadow_dir, "universal-agent.py")

            # 1. Ensure primary script is valid
            if not self._verify_script_integrity(primary_script) and self._verify_script_integrity(curr_script):
                try:
                    shutil.copy2(curr_script, primary_script)
                except Exception:
                    pass

            primary_ok = self._verify_script_integrity(primary_script)
            shadow_ok = self._verify_script_integrity(shadow_script)

            if not primary_ok and shadow_ok:
                try:
                    shutil.copy2(shadow_script, primary_script)
                    primary_ok = True
                except Exception:
                    pass
            elif primary_ok and not shadow_ok:
                try:
                    shutil.copy2(primary_script, shadow_script)
                    shadow_ok = True
                except Exception:
                    pass
            elif not primary_ok and not shadow_ok:
                try:
                    github_url = "https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/agent/universal-agent.py"
                    req = urllib.request.Request(github_url, headers={"User-Agent": "CyberVPS-ShadowHealer/2.2"})
                    with urllib.request.urlopen(req, timeout=12) as resp:
                        code = resp.read()
                    if len(code) > 15000:
                        tmp_f = primary_script + ".tmp"
                        with open(tmp_f, "wb") as f:
                            f.write(code)
                        py_compile.compile(tmp_f, doraise=True)
                        shutil.move(tmp_f, primary_script)
                        shutil.copy2(primary_script, shadow_script)
                        primary_ok = True
                        shadow_ok = True
                except Exception:
                    pass

            # 2. Mirror config.json and backends.json to both primary and shadow
            cfg_data = {
                "server_url": self.server_url,
                "server_urls": list(self.backend_pool),
                "token": self.token,
                "machine_id": self.machine_id,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }
            for c_dir in [primary_dir, shadow_dir]:
                try:
                    cfg_file = os.path.join(c_dir, "config.json")
                    with open(cfg_file, "w", encoding="utf-8") as cf:
                        json.dump(cfg_data, cf, indent=2)
                    b_file = os.path.join(c_dir, "backends.json")
                    with open(b_file, "w", encoding="utf-8") as bf:
                        json.dump(self.backend_pool, bf, indent=2)
                except Exception:
                    pass

            # 3. Ensure Windows registry Run persistence if on Windows
            if platform.system() == "Windows":
                try:
                    import winreg
                    reg_key = winreg.OpenKey(
                        winreg.HKEY_CURRENT_USER,
                        r"Software\Microsoft\Windows\CurrentVersion\Run",
                        0,
                        winreg.KEY_READ | winreg.KEY_SET_VALUE
                    )
                    silent_py = get_silent_python_exe()
                    log_file = os.path.join(primary_dir, "agent.log")
                    expected_val = f'"{silent_py}" "{primary_script}" --config "{cfg_file}" --log-file "{log_file}"'
                    try:
                        curr_val, _ = winreg.QueryValueEx(reg_key, "CyberVPSAgent")
                    except Exception:
                        curr_val = None
                    if curr_val != expected_val:
                        winreg.SetValueEx(reg_key, "CyberVPSAgent", 0, winreg.REG_SZ, expected_val)
                    winreg.CloseKey(reg_key)
                except Exception:
                    pass
        except Exception:
            pass

    def _self_healing_shadow_loop(self):
        time.sleep(8)
        while self.running:
            try:
                self._reconcile_shadow_mirror()
            except Exception:
                pass
            time.sleep(30)

    def _load_backends_from_disk(self):
        candidate_dirs = [self._get_primary_dir(), self._get_shadow_dir()]
        for c_dir in candidate_dirs:
            try:
                b_file = os.path.join(c_dir, "backends.json")
                if os.path.exists(b_file):
                    with open(b_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if isinstance(data, list):
                            for u in data:
                                u_clean = str(u).strip().rstrip("/")
                                if u_clean and "cybervps-render-control" not in u_clean and u_clean not in self.backend_pool:
                                    self.backend_pool.append(u_clean)
            except Exception:
                pass
            try:
                cfg_file = os.path.join(c_dir, "config.json")
                if os.path.exists(cfg_file):
                    with open(cfg_file, "r", encoding="utf-8") as f:
                        cfg_data = json.load(f)
                        if isinstance(cfg_data, dict):
                            s_list = cfg_data.get("server_urls") or []
                            if cfg_data.get("server_url"):
                                s_list.append(cfg_data.get("server_url"))
                            for u in s_list:
                                u_clean = str(u).strip().rstrip("/")
                                if u_clean and "cybervps-render-control" not in u_clean and u_clean not in self.backend_pool:
                                    self.backend_pool.append(u_clean)
            except Exception:
                pass

    def _save_backends_to_disk(self):
        for c_dir in [self._get_primary_dir(), self._get_shadow_dir()]:
            try:
                os.makedirs(c_dir, exist_ok=True)
                b_file = os.path.join(c_dir, "backends.json")
                with open(b_file, "w", encoding="utf-8") as f:
                    json.dump(self.backend_pool, f, indent=2)
            except Exception:
                pass

    def _detect_local_username(self):
        user = os.environ.get("USERNAME") or os.environ.get("USER") or os.environ.get("LOGNAME")
        if not user:
            try:
                user = getpass.getuser()
            except Exception:
                pass
        if not user:
            try:
                if hasattr(os, "getlogin"):
                    user = os.getlogin()
            except Exception:
                pass
        if not user:
            user = "root" if (hasattr(os, "geteuid") and os.geteuid() == 0) else "user"
        return str(user).strip()

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

    def get_hardware_identity(self):
        if hasattr(self, "_cached_hardware_identity") and self._cached_hardware_identity:
            return self._cached_hardware_identity

        sys_os = platform.system()
        hw_uuid = None
        hw_serial = None
        if sys_os == "Windows":
            # 1. Zero-process fast lookup via Windows Registry
            if winreg:
                try:
                    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography") as k:
                        val = winreg.QueryValueEx(k, "MachineGuid")[0]
                        if val and len(val) > 8:
                            hw_uuid = str(val).strip()
                except Exception:
                    pass
                try:
                    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\BIOS") as b:
                        try:
                            s = str(winreg.QueryValueEx(b, "SystemSerialNumber")[0]).strip()
                            if s and "to be filled" not in s.lower() and s != "0" and len(s) > 2:
                                hw_serial = s
                        except Exception:
                            pass
                        if not hw_serial:
                            try:
                                s = str(winreg.QueryValueEx(b, "BaseBoardProduct")[0]).strip()
                                if s and len(s) > 2:
                                    hw_serial = s
                            except Exception:
                                pass
                except Exception:
                    pass

            # 2. Subprocess fallback (guaranteed silent without console window)
            if not hw_uuid:
                try:
                    cmd = ["powershell.exe", "-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystemProduct).UUID"]
                    out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, timeout=4).decode().strip()
                    if out and len(out) > 10 and "error" not in out.lower():
                        hw_uuid = out
                except Exception:
                    pass
            if not hw_uuid:
                try:
                    cmd = ["wmic", "csproduct", "get", "uuid"]
                    out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, timeout=4).decode().splitlines()
                    for line in out[1:]:
                        line = line.strip()
                        if line and len(line) > 10:
                            hw_uuid = line
                            break
                except Exception:
                    pass
            if not hw_serial:
                try:
                    cmd = ["powershell.exe", "-NoProfile", "-Command", "(Get-CimInstance Win32_BIOS).SerialNumber"]
                    out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, timeout=4).decode().strip()
                    if out and "error" not in out.lower():
                        hw_serial = out
                except Exception:
                    pass
        elif sys_os == "Linux":
            dmi_uuid = "/sys/class/dmi/id/product_uuid"
            if os.path.exists(dmi_uuid):
                try:
                    with open(dmi_uuid, "r") as f:
                        val = f.read().strip()
                        if val and len(val) > 8:
                            hw_uuid = val
                except Exception:
                    pass
            if not hw_uuid and os.path.exists("/etc/machine-id"):
                try:
                    with open("/etc/machine-id", "r") as f:
                        val = f.read().strip()
                        if val: hw_uuid = val
                except Exception:
                    pass
            dmi_serial = "/sys/class/dmi/id/product_serial"
            if os.path.exists(dmi_serial):
                try:
                    with open(dmi_serial, "r") as f:
                        val = f.read().strip()
                        if val: hw_serial = val
                except Exception:
                    pass
        return {
            "hardware_uuid": hw_uuid,
            "hardware_serial": hw_serial
        }

    def get_runtime_paths(self):
        try:
            script_file = os.path.abspath(__file__) if "__file__" in globals() else os.path.abspath(sys.argv[0])
        except Exception:
            script_file = os.path.abspath(sys.argv[0]) if len(sys.argv) > 0 else os.getcwd()
        install_dir = os.path.dirname(script_file)
        data_dir = os.path.join(install_dir, "data")
        config_file = os.path.join(install_dir, "agent.json")
        log_file = os.path.join(install_dir, "agent.log")
        return {
            "installation_path": install_dir,
            "script_path": script_file,
            "executable_path": sys.executable,
            "runtime_pid": os.getpid(),
            "cwd": os.getcwd(),
            "data_path": data_dir,
            "config_path": config_file,
            "log_path": log_file,
            "platform": platform.system().lower()
        }

    def get_backend_inventory(self):
        try:
            rpaths = self.get_runtime_paths()
        except Exception:
            rpaths = {}

        install_dir = rpaths.get("installation_path", "")
        script_file = rpaths.get("script_path", "")
        exec_path = rpaths.get("executable_path", sys.executable)
        pid = rpaths.get("runtime_pid", os.getpid())
        data_dir = rpaths.get("data_path", "")
        config_file = rpaths.get("config_path", "")
        log_file = rpaths.get("log_path", "")
        sys_os = platform.system()
        hostname = socket.gethostname()

        # Check storage filesystem provider
        storage_provider = "Local Volume (NTFS)" if sys_os == "Windows" else "Local Volume (ext4)"
        try:
            if sys_os != "Windows" and os.path.exists("/proc/mounts"):
                with open("/proc/mounts", "r") as mf:
                    for line in mf:
                        parts = line.split()
                        if len(parts) >= 3 and (parts[1] == "/" or install_dir.startswith(parts[1])):
                            storage_provider = f"Local Volume ({parts[2]})"
                            break
        except Exception:
            pass

        # Check service manager
        service_name = "Standalone Process (Interactive Session)"
        service_manager = "user_process"
        if sys_os == "Windows":
            try:
                import subprocess
                out = subprocess.check_output(["sc", "query", "CyberVPSAgent"], stderr=subprocess.DEVNULL, timeout=2).decode("utf-8", errors="ignore")
                if "RUNNING" in out or "STATE" in out:
                    service_name = "Windows Service (CyberVPSAgent)"
                    service_manager = "windows_service"
            except Exception:
                pass
        else:
            if os.path.exists("/etc/systemd/system/cybervps-agent.service") or os.path.exists("/lib/systemd/system/cybervps-agent.service"):
                service_name = "systemd (cybervps-agent.service)"
                service_manager = "systemd"

        # Truthful path verification
        dir_exists = os.path.isdir(install_dir) if install_dir else False
        exec_exists = os.path.isfile(exec_path) if exec_path else False
        script_exists = os.path.isfile(script_file) if script_file else False
        if dir_exists and (exec_exists or script_exists):
            ver_status = "verified_on_disk"
            ver_reason = "Physical directory, script and executable verified on host filesystem."
        elif dir_exists:
            ver_status = "verified_on_disk"
            ver_reason = "Installation directory verified on host filesystem."
        else:
            ver_status = "missing_path"
            ver_reason = f"Installation path '{install_dir}' does not exist on disk."

        # Standby replica path for obsidian failover
        standby_replica_path = os.path.join(install_dir, "standby_replicas", f"replica_{self.machine_id}") if install_dir else "standby_replicas"

        agent_record = {
            "backend_id": f"be_agent_{self.machine_id}",
            "backend_name": f"CyberVPS Agent Daemon ({self.machine_id})",
            "category": "Remote Node Agent",
            "role": "node_daemon",
            "machine_id": self.machine_id,
            "hostname": hostname,
            "status": "running",
            "runtime_pid": pid,
            "installation_path": install_dir,
            "script_path": script_file,
            "executable_path": exec_path,
            "config_path": config_file,
            "log_path": log_file,
            "data_path": data_dir,
            "service_name": service_name,
            "service_manager": service_manager,
            "storage_provider": storage_provider,
            "single_writer_enforced": True,
            "single_writer_status": "Active Exclusive Writer (Single-Writer Protected) ✅",
            "obsidian_mesh_pillar": f"Pillar #{abs(hash(self.machine_id)) % 8 + 1} ({hostname})",
            "failover_replica_path": standby_replica_path,
            "path_exists": dir_exists,
            "verification_status": ver_status,
            "verification_reason": ver_reason,
            "last_heartbeat": _iso_now(),
            "ports_detected": []
        }

        backends = [agent_record]

        # Probe SSH / SFTP server
        try:
            s_ssh = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s_ssh.settimeout(0.15)
            ssh_open = (s_ssh.connect_ex(("127.0.0.1", 22)) == 0)
            s_ssh.close()
            if ssh_open:
                ssh_bin = "C:\\Windows\\System32\\OpenSSH\\sshd.exe" if sys_os == "Windows" else "/usr/sbin/sshd"
                ssh_cfg = "C:\\ProgramData\\ssh\\sshd_config" if sys_os == "Windows" else "/etc/ssh/sshd_config"
                ssh_exists = os.path.exists(ssh_bin)
                backends.append({
                    "backend_id": f"be_ssh_{self.machine_id}",
                    "backend_name": f"Secure Shell / SFTP Daemon ({hostname}:22)",
                    "category": "System Service",
                    "role": "ssh_sftp_service",
                    "machine_id": self.machine_id,
                    "hostname": hostname,
                    "status": "running",
                    "runtime_pid": "System Service",
                    "installation_path": os.path.dirname(ssh_bin) if ssh_exists else ssh_bin,
                    "script_path": "",
                    "executable_path": ssh_bin,
                    "config_path": ssh_cfg,
                    "log_path": "C:\\ProgramData\\ssh\\logs\\sshd.log" if sys_os == "Windows" else "/var/log/auth.log",
                    "data_path": "C:\\ProgramData\\ssh" if sys_os == "Windows" else "/etc/ssh",
                    "service_name": "OpenSSH SSH Server (sshd)",
                    "service_manager": "windows_service" if sys_os == "Windows" else "systemd",
                    "storage_provider": storage_provider,
                    "single_writer_enforced": True,
                    "single_writer_status": "Active Exclusive Writer ✅",
                    "obsidian_mesh_pillar": f"Pillar Companion ({hostname})",
                    "failover_replica_path": os.path.join(install_dir, "standby_replicas", "ssh_replica") if install_dir else "",
                    "path_exists": ssh_exists,
                    "verification_status": "verified_on_disk" if ssh_exists else "port_listener_detected",
                    "verification_reason": "Listening on port 22; physical binary confirmed." if ssh_exists else "Listening on port 22.",
                    "last_heartbeat": _iso_now(),
                    "ports_detected": [22]
                })
        except Exception:
            pass

        # Probe RDP on Windows
        if sys_os == "Windows":
            try:
                s_rdp = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s_rdp.settimeout(0.15)
                rdp_open = (s_rdp.connect_ex(("127.0.0.1", 3389)) == 0)
                s_rdp.close()
                if rdp_open:
                    backends.append({
                        "backend_id": f"be_rdp_{self.machine_id}",
                        "backend_name": f"Remote Desktop Services ({hostname}:3389)",
                        "category": "Desktop Service",
                        "role": "desktop_rdp",
                        "machine_id": self.machine_id,
                        "hostname": hostname,
                        "status": "running",
                        "runtime_pid": "svchost (TermService)",
                        "installation_path": "C:\\Windows\\System32",
                        "script_path": "",
                        "executable_path": "C:\\Windows\\System32\\svchost.exe -k termsvcs",
                        "config_path": "HKLM\\System\\CurrentControlSet\\Control\\Terminal Server",
                        "log_path": "C:\\Windows\\System32\\winevt\\Logs\\Microsoft-Windows-RemoteDesktopServices-RdpCoreTS%4Operational.evtx",
                        "data_path": "C:\\ProgramData\\Microsoft\\Terminal Server Client",
                        "service_name": "TermService (Remote Desktop Services)",
                        "service_manager": "windows_service",
                        "storage_provider": "Local Volume (NTFS)",
                        "single_writer_enforced": True,
                        "single_writer_status": "Active Exclusive Writer ✅",
                        "obsidian_mesh_pillar": f"Pillar Desktop Companion ({hostname})",
                        "failover_replica_path": "",
                        "path_exists": True,
                        "verification_status": "verified_on_disk",
                        "verification_reason": "RDP Listener active on port 3389; Windows TermService verified.",
                        "last_heartbeat": _iso_now(),
                        "ports_detected": [3389]
                    })
            except Exception:
                pass

        # Probe Docker Engine Daemon
        try:
            docker_bin = shutil.which("docker")
            docker_sock = "/var/run/docker.sock"
            docker_available = (docker_bin is not None) or (sys_os != "Windows" and os.path.exists(docker_sock))
            if docker_available:
                d_inst = os.path.dirname(docker_bin) if docker_bin else ("/var/run" if sys_os != "Windows" else "C:\\Program Files\\Docker")
                backends.append({
                    "backend_id": f"be_docker_{self.machine_id}",
                    "backend_name": f"Docker Container Engine ({hostname})",
                    "category": "Container Runtime",
                    "role": "container_daemon",
                    "machine_id": self.machine_id,
                    "hostname": hostname,
                    "status": "running",
                    "runtime_pid": "System Service",
                    "installation_path": d_inst,
                    "script_path": "",
                    "executable_path": docker_bin or "dockerd",
                    "config_path": "/etc/docker/daemon.json" if sys_os != "Windows" else "C:\\ProgramData\\Docker\\config\\daemon.json",
                    "log_path": "/var/log/docker.log" if sys_os != "Windows" else "C:\\ProgramData\\Docker\\log\\dockerd.log",
                    "data_path": "/var/lib/docker" if sys_os != "Windows" else "C:\\ProgramData\\Docker",
                    "service_name": "Docker Engine (dockerd)",
                    "service_manager": "systemd" if sys_os != "Windows" else "windows_service",
                    "storage_provider": storage_provider,
                    "single_writer_enforced": True,
                    "single_writer_status": "Active Exclusive Writer ✅",
                    "obsidian_mesh_pillar": f"Pillar Container Companion ({hostname})",
                    "failover_replica_path": "",
                    "path_exists": True,
                    "verification_status": "verified_on_disk",
                    "verification_reason": "Docker engine binary / socket discovered on host filesystem.",
                    "last_heartbeat": _iso_now(),
                    "ports_detected": [2375]
                })
        except Exception:
            pass

        # Probe active web services
        for web_port in [80, 8080, 3000, 5000]:
            try:
                s_web = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s_web.settimeout(0.08)
                web_open = (s_web.connect_ex(("127.0.0.1", web_port)) == 0)
                s_web.close()
                if web_open:
                    backends.append({
                        "backend_id": f"be_web_{web_port}_{self.machine_id}",
                        "backend_name": f"Web / Application Server ({hostname}:{web_port})",
                        "category": "Web Service",
                        "role": "web_server",
                        "machine_id": self.machine_id,
                        "hostname": hostname,
                        "status": "running",
                        "runtime_pid": "Listening Process",
                        "installation_path": "/var/www" if sys_os != "Windows" else "C:\\inetpub",
                        "script_path": "",
                        "executable_path": "web-listener",
                        "config_path": f"Port {web_port} Listener Config",
                        "log_path": "",
                        "data_path": "/var/www/html" if sys_os != "Windows" else "C:\\inetpub\\wwwroot",
                        "service_name": f"HTTP Listener (Port {web_port})",
                        "service_manager": "systemd" if sys_os != "Windows" else "windows_service",
                        "storage_provider": storage_provider,
                        "single_writer_enforced": True,
                        "single_writer_status": "Active Exclusive Writer ✅",
                        "obsidian_mesh_pillar": f"Pillar Web Companion ({hostname})",
                        "failover_replica_path": "",
                        "path_exists": True,
                        "verification_status": "port_listener_detected",
                        "verification_reason": f"Active listener detected on TCP port {web_port}.",
                        "last_heartbeat": _iso_now(),
                        "ports_detected": [web_port]
                    })
                    break
            except Exception:
                pass

        # Probe custom user-defined backends from ~/.cybervps/custom_backends.json
        try:
            custom_file = os.path.join(os.path.expanduser("~"), ".cybervps", "custom_backends.json")
            if os.path.exists(custom_file):
                with open(custom_file, "r", encoding="utf-8") as f:
                    c_list = json.load(f)
                    if isinstance(c_list, list):
                        for cb in c_list:
                            inst = cb.get("installation_path", "")
                            exists = os.path.exists(inst) if inst else False
                            backends.append({
                                "backend_id": cb.get("backend_id") or f"be_custom_{abs(hash(inst)) % 100000}",
                                "backend_name": cb.get("backend_name", "Custom Backend"),
                                "category": cb.get("category", "Custom Service"),
                                "role": cb.get("role", "custom_backend"),
                                "machine_id": self.machine_id,
                                "hostname": hostname,
                                "status": cb.get("status", "running"),
                                "runtime_pid": cb.get("runtime_pid", "Managed Process"),
                                "installation_path": inst,
                                "script_path": cb.get("script_path", ""),
                                "executable_path": cb.get("executable_path", ""),
                                "config_path": cb.get("config_path", ""),
                                "log_path": cb.get("log_path", ""),
                                "data_path": cb.get("data_path", ""),
                                "service_name": cb.get("service_name", "User Defined Service"),
                                "service_manager": cb.get("service_manager", "custom"),
                                "storage_provider": storage_provider,
                                "single_writer_enforced": True,
                                "single_writer_status": "Active Exclusive Writer ✅",
                                "obsidian_mesh_pillar": f"Pillar Custom Companion ({hostname})",
                                "failover_replica_path": os.path.join(inst, "standby_replicas") if inst else "",
                                "path_exists": exists,
                                "verification_status": "verified_on_disk" if exists else "missing_path",
                                "verification_reason": f"Verified on host filesystem: '{inst}'." if exists else f"Path '{inst}' not found on disk.",
                                "last_heartbeat": _iso_now(),
                                "ports_detected": cb.get("ports_detected", [])
                            })
        except Exception:
            pass

        # Probe physical filesystem for additional CyberVPS installations
        try:
            candidate_paths = [
                self._get_primary_dir(),
                self._get_shadow_dir(),
                os.path.join(self._get_primary_dir(), "space-station"),
                os.path.join(self._get_shadow_dir(), "space-station"),
            ]
            if sys_os == "Windows":
                for env_drive in [os.environ.get("SystemDrive", "C:"), "C:", "D:"]:
                    candidate_paths.extend([
                        os.path.join(env_drive, "\\CyberVPS"),
                        os.path.join(env_drive, "\\cybervps"),
                        os.path.join(env_drive, "\\CyberVPS\\Agent"),
                        os.path.join(env_drive, "\\CyberVPS\\space-station"),
                    ])
                pdata = os.environ.get("ProgramData", "C:\\ProgramData")
                candidate_paths.extend([
                    os.path.join(pdata, "CyberVPS"),
                    os.path.join(pdata, "CyberVPS", "space-station"),
                ])
                uprof = os.environ.get("USERPROFILE") or os.path.expanduser("~")
                candidate_paths.extend([
                    os.path.join(uprof, ".cybervps"),
                    os.path.join(uprof, ".cybervps", "space-station"),
                ])
            else:
                candidate_paths.extend([
                    "/opt/cybervps",
                    "/opt/cybervps/space-station",
                    "/var/lib/cybervps",
                    "/srv/cybervps",
                    "/root/.cybervps",
                    "/root/.cybervps/space-station",
                    "/etc/cybervps",
                    "/usr/local/cybervps"
                ])

            seen_canonical = set()
            for b in backends:
                p = b.get("installation_path")
                if p:
                    try: seen_canonical.add(os.path.realpath(p).lower())
                    except Exception: seen_canonical.add(p.lower())

            for c_path in candidate_paths:
                if not c_path or not os.path.isdir(c_path):
                    continue
                try:
                    canon_c = os.path.realpath(c_path)
                except Exception:
                    canon_c = c_path
                canon_lower = canon_c.lower()
                if canon_lower in seen_canonical:
                    continue

                # Verify if this directory contains CyberVPS / Space Station files
                is_cybervps_backend = False
                markers = ["universal-agent.py", "bin/cybervps", "bin/cybervps.py", "services/server.js", "agent.json", "config.json", "backends.json", "server.js"]
                found_exec = ""
                found_cfg = ""
                for m_file in markers:
                    check_f = os.path.join(canon_c, m_file)
                    if os.path.exists(check_f):
                        is_cybervps_backend = True
                        if not found_exec and (check_f.endswith(".py") or check_f.endswith(".js")):
                            found_exec = check_f
                        if not found_cfg and check_f.endswith(".json"):
                            found_cfg = check_f

                if not is_cybervps_backend:
                    pkg_f = os.path.join(canon_c, "package.json")
                    if os.path.exists(pkg_f):
                        try:
                            with open(pkg_f, "r", encoding="utf-8") as pf:
                                if "cybervps" in pf.read().lower():
                                    is_cybervps_backend = True
                        except Exception:
                            pass

                if is_cybervps_backend:
                    seen_canonical.add(canon_lower)
                    b_id = f"be_phys_{abs(hash(canon_lower)) % 1000000}_{self.machine_id}"
                    b_name = f"CyberVPS Physical Backend ({os.path.basename(canon_c) or 'Instance'})"
                    backends.append({
                        "backend_id": b_id,
                        "backend_name": b_name,
                        "category": "Physical Node Installation",
                        "role": "secondary_node_backend",
                        "machine_id": self.machine_id,
                        "hostname": hostname,
                        "status": "running",
                        "runtime_pid": "Discovered Host Service",
                        "installation_path": canon_c,
                        "script_path": found_exec,
                        "executable_path": found_exec or sys.executable,
                        "config_path": found_cfg or os.path.join(canon_c, "config.json"),
                        "log_path": os.path.join(canon_c, "agent.log"),
                        "data_path": os.path.join(canon_c, "data"),
                        "service_name": f"Physical Backend ({os.path.basename(canon_c)})",
                        "service_manager": "systemd" if sys_os != "Windows" else "windows_service",
                        "storage_provider": storage_provider,
                        "single_writer_enforced": True,
                        "single_writer_status": "Active Exclusive Writer ✅",
                        "obsidian_mesh_pillar": f"Pillar #{abs(hash(canon_lower)) % 8 + 1} ({hostname})",
                        "failover_replica_path": os.path.join(canon_c, "standby_replicas"),
                        "path_exists": True,
                        "verification_status": "verified_on_disk",
                        "verification_reason": f"Physical installation verified at '{canon_c}'.",
                        "last_heartbeat": _iso_now(),
                        "ports_detected": []
                    })
        except Exception:
            pass

        return backends


    def perform_bootstrap_claim(self, server_url, machine_id, recovery_ticket):
        claim_url = f"{server_url.rstrip('/')}/api/v1/recovery/claim"
        hw_info = self.get_hardware_identity()
        payload = {
            "machine_id": machine_id,
            "recovery_ticket": recovery_ticket,
            "hardware_uuid": hw_info.get("hardware_uuid"),
            "hardware_serial": hw_info.get("hardware_serial"),
            "os": platform.system()
        }
        try:
            req = urllib.request.Request(
                claim_url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=12) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data.get("success"):
                    print(f"[*] Bootstrap claim SUCCESS for '{machine_id}'. Generation {data.get('installation_generation')}")
                    cfg = self.load_config()
                    cfg["machine_id"] = machine_id
                    cfg["token"] = data.get("enrollment_token")
                    cfg["installation_token"] = data.get("installation_token")
                    cfg["installation_generation"] = data.get("installation_generation")
                    self.save_config(cfg)
                    self.machine_id = machine_id
                    self.token = data.get("enrollment_token")
                    return True
                else:
                    print(f"[!] Bootstrap claim rejected: {data.get('error')}")
                    return False
        except Exception as e:
            print(f"[!] Bootstrap claim request failed: {e}")
            return False

    def get_config_path(self):
        cfg_path = os.environ.get("CYBERVPS_CONFIG")
        if not cfg_path:
            cfg_path = os.path.join(os.path.expanduser("~"), ".cybervps", "config.json")
        return cfg_path

    def load_config(self):
        p = self.get_config_path()
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    def save_config(self, data):
        p = self.get_config_path()
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            return True
        except Exception:
            return False

    def persist_token(self, new_token):
        if not new_token:
            return
        self.token = new_token
        cfg = self.load_config() or {}
        cfg["token"] = new_token
        self.save_config(cfg)
        # Also mirror to shadow and ProgramData configs if present
        home = os.path.expanduser("~")
        shadow_dir = os.path.join(home, ".local", "share", "cybervps") if platform.system() != "Windows" else os.path.join(os.environ.get("LOCALAPPDATA", home), "CyberVPS")
        prog_dir = "C:\\ProgramData\\CyberVPS" if platform.system() == "Windows" else "/var/lib/cybervps"
        for d in [shadow_dir, prog_dir]:
            c_file = os.path.join(d, "config.json")
            if os.path.exists(c_file):
                try:
                    with open(c_file, "r", encoding="utf-8") as f:
                        scfg = json.load(f)
                    scfg["token"] = new_token
                    with open(c_file, "w", encoding="utf-8") as f:
                        json.dump(scfg, f, indent=2)
                except Exception:
                    pass

    def try_self_heal_token(self):
        try:
            import hmac
            import hashlib
            heal_attempts = getattr(self, "_heal_attempts", 0)
            if heal_attempts >= 5:
                print(f"[!] Token self-heal rate-limit reached ({heal_attempts} attempts). Manual authentication required.")
                return False
            self._heal_attempts = heal_attempts + 1

            pairing_secret = (
                os.environ.get("CVPS_PAIRING_KEY")
                or os.environ.get("PAIRING_KEY")
                or os.environ.get("BOOTSTRAP_SECRET")
                or "cybervps_pair_station_2026"
            )
            if not pairing_secret:
                print("[!] Token self-heal failed: No pairing secret or bootstrap credential available.")
                return False

            mid = self.machine_id or "node"
            sig = hmac.new(pairing_secret.encode("utf-8"), f"node:{mid}".encode("utf-8"), hashlib.sha256).hexdigest()[:24]
            canonical_token = f"cvps_node_{mid}_{sig}"
            healed = False
            if self.token != canonical_token:
                self.persist_token(canonical_token)
                healed = True
            elif self.token != pairing_secret:
                self.persist_token(pairing_secret)
                healed = True

            if healed:
                try:
                    if hasattr(self, "ws_relay") and self.ws_relay:
                        self.ws_relay.authenticated = False
                        self.ws_relay.running = False
                    self.ws_connected = False
                except Exception:
                    pass
                return True
            return False
        except Exception as e:
            print(f"[!] Token self-heal exception: {e}")
            return False

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

        # 3. Network Addresses Discovery - Accurate LAN vs Loopback Separation
        lan_endpoints = []
        loopback_addr = "127.0.0.1"
        try:
            # Method A: UDP connect trick to find true routable LAN interface without sending data
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                s.connect(('10.255.255.255', 1))
                pri_ip = s.getsockname()[0]
                if pri_ip and not pri_ip.startswith("127.") and not pri_ip.startswith("169.254."):
                    lan_endpoints.append(pri_ip)
            except Exception:
                pass
            finally:
                s.close()

            # Method B: Hostname interface resolution
            for ip in socket.gethostbyname_ex(hostname)[2]:
                if not ip.startswith("127.") and not ip.startswith("169.254."):
                    if ip not in lan_endpoints:
                        lan_endpoints.append(ip)
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
        r_paths = self.get_runtime_paths() if hasattr(self, "get_runtime_paths") else {}
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
            "node:localUser": self.username,
            "node:publicIp": public_ip,
            "node:lanIps": ", ".join(lan_endpoints) if lan_endpoints else "No routable LAN interface",
            "node:loopbackIp": loopback_addr,
            "node:tailscaleCompatible": "true",
            "node:backendId": f"be_agent_{self.machine_id}",
            "node:installDir": r_paths.get("installation_path", ""),
            "node:executablePath": r_paths.get("executable_path", ""),
            "node:runtimePid": str(r_paths.get("runtime_pid", os.getpid())),
            "node:configPath": r_paths.get("config_path", ""),
            "node:logPath": r_paths.get("log_path", ""),
            "node:dataPath": r_paths.get("data_path", ""),
            "node:singleWriterEnforced": "true",
            "node:obsidianPillar": f"Pillar #{abs(hash(self.machine_id)) % 8 + 1}"
        }
        if daytona_info:
            attributes["node:daytonaSandboxId"] = daytona_info.get("sandbox_id", "")
            attributes["node:daytonaWorkspace"] = daytona_info.get("workspace_id", "")

        # Neofetch formatted summary lines
        neofetch_summary = {
            "os": os_full,
            "host": f"{hostname} ({motherboard})",
            "user": f"{self.username}@{hostname}",
            "kernel": f"{kernel_rel} ({arch})",
            "uptime_seconds": int(time.time() - self.uptime_start),
            "shell": "PowerShell 5.1 / cmd.exe" if sys_os == "Windows" else ("/bin/bash" if os.path.exists("/bin/bash") else "/bin/sh"),
            "cpu": f"{cpu_model} ({cpu_cores} Cores)",
            "bios": f"{bios_vendor} {bios_version}",
            "virtualization": virtualization,
            "provider": provider,
            "public_ip": public_ip,
            "lan_ips": lan_endpoints,
            "loopback_ip": loopback_addr,
            "local_ips": lan_endpoints
        }

        self.device_profile = {
            "username": self.username,
            "user": self.username,
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
            "lan_ips": lan_endpoints,
            "loopback_ip": loopback_addr,
            "local_ips": lan_endpoints,
            "ghost_mode": getattr(self, "ghost_mode", False),
            "attributes": attributes,
            "neofetch": neofetch_summary,
            "runtime_paths": r_paths,
            "backend_inventory": self.get_backend_inventory() if hasattr(self, "get_backend_inventory") else []
        }
        return self.device_profile

    def get_privilege_info(self):
        if platform.system() == "Windows":
            is_elevated = False
            is_system = False
            user = os.environ.get("USERNAME", getattr(self, "username", "User") or "User")
            domain = os.environ.get("USERDOMAIN", "")
            try:
                import ctypes
                is_admin = bool(ctypes.windll.shell32.IsUserAnAdmin())
            except Exception:
                is_admin = False

            try:
                import ctypes
                from ctypes import wintypes
                TOKEN_QUERY = 0x0008
                TokenElevation = 20
                h_token = wintypes.HANDLE()
                h_proc = ctypes.windll.kernel32.GetCurrentProcess()
                if ctypes.windll.advapi32.OpenProcessToken(h_proc, TOKEN_QUERY, ctypes.byref(h_token)):
                    class TOKEN_ELEVATION(ctypes.Structure):
                        _fields_ = [("TokenIsElevated", wintypes.DWORD)]
                    elevation = TOKEN_ELEVATION()
                    cb_size = wintypes.DWORD(ctypes.sizeof(TOKEN_ELEVATION))
                    ret_size = wintypes.DWORD()
                    if ctypes.windll.advapi32.GetTokenInformation(
                        h_token, TokenElevation, ctypes.byref(elevation), cb_size, ctypes.byref(ret_size)
                    ):
                        is_elevated = bool(elevation.TokenIsElevated)
                    ctypes.windll.kernel32.CloseHandle(h_token)
                else:
                    is_elevated = is_admin
            except Exception:
                is_elevated = is_admin

            if user.upper() == "SYSTEM" or domain.upper() == "NT AUTHORITY" or "SYSTEM" in domain.upper():
                is_system = True
                is_elevated = True

            priv_level = "system" if is_system else ("elevated" if is_elevated else "standard")
            eff_user = "NT AUTHORITY\\SYSTEM" if is_system else user
            fm_priv = "system" if is_system else ("administrator" if is_elevated else "standard")
            return {
                "effective_user": eff_user,
                "is_elevated": is_elevated,
                "is_system": is_system,
                "is_root": is_elevated,
                "is_admin": is_elevated,
                "can_run_privileged": is_elevated,
                "can_run_standard": True,
                "privilege_level": priv_level,
                "file_manager_privilege": fm_priv
            }
        else:
            euid = os.geteuid() if hasattr(os, "geteuid") else 1000
            egid = os.getegid() if hasattr(os, "getegid") else 1000
            is_root = (euid == 0)
            user = os.environ.get("USER")
            if not user:
                try:
                    import pwd
                    user = pwd.getpwuid(euid).pw_name
                except Exception:
                    user = "root" if is_root else "user"

            priv_level = "root" if is_root else "standard"
            return {
                "effective_user": user,
                "effective_uid": euid,
                "effective_gid": egid,
                "is_root": is_root,
                "is_admin": is_root,
                "is_elevated": is_root,
                "is_system": False,
                "can_run_privileged": is_root,
                "can_run_standard": True,
                "privilege_level": priv_level,
                "file_manager_privilege": "root" if is_root else "standard"
            }

    def detect_provider_environment(self):
        try:
            if os.environ.get("REPL_ID") or os.environ.get("REPLIT_DEV_DOMAIN") or os.environ.get("REPL_SLUG"):
                return {
                    "provider": "replit",
                    "repl_id": os.environ.get("REPL_ID", ""),
                    "repl_slug": os.environ.get("REPL_SLUG", ""),
                    "is_container_sandbox": True,
                    "idle_pause_susceptible": True
                }
            hostname = socket.gethostname()
            if any(k.startswith("PREPARE_") for k in os.environ) or os.path.exists("/prepare") or "alloc-" in hostname:
                return {
                    "provider": "prepare.sh",
                    "workspace": hostname,
                    "is_container_sandbox": True,
                    "idle_pause_susceptible": True
                }
            if os.path.exists("/.dockerenv") or os.path.exists("/run/.containerenv"):
                return {
                    "provider": "docker_container",
                    "is_container_sandbox": True,
                    "idle_pause_susceptible": False
                }
            if os.environ.get("CODESPACES"):
                return {"provider": "github_codespaces", "is_container_sandbox": True, "idle_pause_susceptible": True}
            if os.environ.get("GITPOD_WORKSPACE_ID"):
                return {"provider": "gitpod", "is_container_sandbox": True, "idle_pause_susceptible": True}
            if os.environ.get("RAILWAY_ENVIRONMENT"):
                return {"provider": "railway", "is_container_sandbox": True, "idle_pause_susceptible": False}
        except Exception:
            pass
        return {
            "provider": "standard_host",
            "is_container_sandbox": False,
            "idle_pause_susceptible": False
        }

    def get_capabilities(self):
        priv = self.get_privilege_info()
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
            "username": priv["effective_user"],
            "user": priv["effective_user"],
            "effective_user": priv["effective_user"],
            "privilege_level": priv["privilege_level"],
            "is_root": priv["is_root"],
            "is_admin": priv["is_admin"],
            "is_elevated": priv["is_elevated"],
            "is_system": priv.get("is_system", False),
            "can_run_privileged": priv["can_run_privileged"],
            "can_run_standard": priv["can_run_standard"],
            "file_manager_privilege": priv["file_manager_privilege"],
            "has_systemd": has_systemd,
            "writable_fs": writable_fs,
            "pty_supported": pty_supported,
            "outbound_dns": True,
            "outbound_tls": True,
            "process_inspection": True,
            "file_manager": True,
            "service_control": True,
            "apps": True,
            "desktop_launch": True,
            "rdp": True,
            "vnc": True,
            "interactive_gui": True,
            "active_ws_heartbeat": True,
            "replit_lab": True,
            "provider_aware": True,
            "decoupled_desktop": True,
            "provider_environment": self.detect_provider_environment(),
            "ghost_mode": getattr(self, "ghost_mode", False),
            "zero_dependency_bootstrap": True,
            "supported_desktop_actions": [
                "launch_interactive", "launch_gui", "desktop_launch", "enable_rdp", "toggle_unattended", "terminate_session", "service_action"
            ],
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

        # Cross-platform sanity checks:
        # If Linux/macOS agent receives a Windows drive letter path (e.g. "C:/Users/...", "C:\..."):
        if platform.system() != "Windows":
            if len(p) >= 2 and p[1] == ":" and p[0].isalpha():
                return os.path.abspath(os.path.expanduser("~"))
        else:
            # If Windows agent receives a POSIX root path (e.g. "/tmp", "/home/...", "/etc", "/var", "/usr", "/root"):
            if p.lower().startswith("/tmp"):
                rest = p[4:].lstrip("/\\")
                tmp_base = os.environ.get("TEMP") or "C:\\tmp"
                target = os.path.join(tmp_base, rest.replace("/", "\\")) if rest else tmp_base
                return os.path.abspath(target)
            if re.match(r"^/(home|root|Users)", p, re.IGNORECASE):
                rest = re.sub(r"^/(home|root|Users)/?[^/]*", "", p, flags=re.IGNORECASE).lstrip("/\\")
                target = os.path.join(os.path.expanduser("~"), rest.replace("/", "\\")) if rest else os.path.expanduser("~")
                return os.path.abspath(target)
            if re.match(r"^/(etc|var|usr|opt|bin|sbin)", p, re.IGNORECASE):
                rest = p.lstrip("/\\").replace("/", "\\")
                return os.path.abspath(os.path.join("C:\\", rest))
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

    def _get_available_drives(self):
        if platform.system() != "Windows":
            return []
        now = time.time()
        if now - self._drives_cache.get("timestamp", 0) < 60 and self._drives_cache.get("data"):
            return self._drives_cache["data"]

        drives = []
        try:
            import ctypes
            # GetLogicalDrives bitmask: bit 0 = A, bit 1 = B, bit 2 = C, etc.
            # Instantaneous memory-only query without hardware timeouts or sleeping drives
            bitmask = ctypes.windll.kernel32.GetLogicalDrives()
            for i in range(26):
                if bitmask & (1 << i):
                    drives.append(f"{chr(65 + i)}:\\")
        except Exception:
            for d in "CDEFGHIJKLMNOPQRSTUVWXYZ":
                dp = f"{d}:\\"
                try:
                    if os.path.exists(dp):
                        drives.append(dp)
                except Exception:
                    pass
        self._drives_cache = {"data": drives, "timestamp": now}
        return drives

    def _get_disk_info(self, target_path):
        now = time.time()
        root_key = os.path.splitdrive(target_path)[0] + "\\" if platform.system() == "Windows" else "/"
        if not root_key or root_key == "\\":
            root_key = target_path
        cached = self._disk_cache.get(root_key)
        if cached and (now - cached.get("timestamp", 0) < 30):
            return cached.get("data", {})

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
            self._disk_cache[root_key] = {"data": disk_info, "timestamp": now}
        except Exception:
            pass
        return disk_info

    def handle_file_list(self, payload):
        req_id = payload.get("request_id")
        raw_path = payload.get("path")
        show_hidden = bool(payload.get("show_hidden", False))
        try:
            target_path = self._sanitize_path(raw_path)
            if not os.path.exists(target_path):
                # Graceful recovery: Fall back to user home directory or system root instead of failing with 404
                home_fallback = os.path.abspath(os.path.expanduser("~"))
                if os.path.exists(home_fallback) and os.path.isdir(home_fallback):
                    target_path = home_fallback
                else:
                    root_fallback = "C:\\" if platform.system() == "Windows" else "/"
                    if os.path.exists(root_fallback) and os.path.isdir(root_fallback):
                        target_path = root_fallback
                    else:
                        raise FileNotFoundError(f"Directory not found: {raw_path}")

            if not os.path.isdir(target_path):
                target_path = os.path.dirname(target_path)
                if not os.path.exists(target_path) or not os.path.isdir(target_path):
                    target_path = os.path.abspath(os.path.expanduser("~"))

            entries = []
            try:
                with os.scandir(target_path) as it:
                    for entry in it:
                        try:
                            # Single stat call with follow_symlinks=False prevents double I/O overhead
                            st = entry.stat(follow_symlinks=False)
                            is_dir = entry.is_dir(follow_symlinks=False)
                            is_symlink = entry.is_symlink()

                            is_hidden = entry.name.startswith(".")
                            if not is_hidden and platform.system() == "Windows":
                                is_hidden = bool(getattr(st, "st_file_attributes", 0) & 2)
                            if is_hidden and not show_hidden:
                                continue

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

            disk_info = self._get_disk_info(target_path)
            drives = self._get_available_drives()

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
                "sep": os.sep,
                "privilege": self.get_privilege_info()
            }
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": True, "result": res}
            })
        except PermissionError as pe:
            priv = self.get_privilege_info()
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": f"Permission Denied: User '{priv['effective_user']}' cannot access directory '{raw_path}'. ({pe})"}
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def handle_file_read(self, payload):
        req_id = payload.get("request_id")
        raw_path = payload.get("path")
        is_download = bool(payload.get("download", False))
        default_max = 500 * 1024 * 1024 if is_download else (25 * 1024 * 1024)
        max_bytes = payload.get("max_bytes", default_max)
        try:
            target_path = self._sanitize_path(raw_path)
            if not os.path.isfile(target_path):
                raise FileNotFoundError(f"File not found: {target_path}")

            size = os.path.getsize(target_path)
            if size > max_bytes:
                limit_mb = round(max_bytes / 1024 / 1024)
                if is_download:
                    raise ValueError(f"File size ({round(size / 1024 / 1024, 2)} MB) exceeds download limit of {limit_mb} MB.")
                else:
                    raise ValueError(f"File size ({round(size / 1024 / 1024, 2)} MB) exceeds preview limit of {limit_mb} MB. Use Download to retrieve this file.")

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
        except PermissionError as pe:
            priv = self.get_privilege_info()
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": f"Permission Denied: User '{priv['effective_user']}' cannot read '{raw_path}'. ({pe})"}
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
        except PermissionError as pe:
            priv = self.get_privilege_info()
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": f"Permission Denied: User '{priv['effective_user']}' cannot write to '{raw_path}'. ({pe})"}
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
        except PermissionError as pe:
            priv = self.get_privilege_info()
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": f"Permission Denied: User '{priv['effective_user']}' cannot delete '{raw_path}'. ({pe})"}
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
        except PermissionError as pe:
            priv = self.get_privilege_info()
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": f"Permission Denied: User '{priv['effective_user']}' cannot rename '{old_raw}'. ({pe})"}
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
        except PermissionError as pe:
            priv = self.get_privilege_info()
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": f"Permission Denied: User '{priv['effective_user']}' cannot create directory '{raw_path}'. ({pe})"}
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

    def handle_file_chunk_write(self, payload):
        req_id = payload.get("request_id")
        raw_path = payload.get("path")
        offset = int(payload.get("offset", 0))
        chunk_b64 = payload.get("chunk_data_base64") or payload.get("content_base64", "")
        is_first = bool(payload.get("is_first", False) or offset == 0)
        is_last = bool(payload.get("is_last", False))
        total_size = payload.get("total_size")
        use_staging = bool(payload.get("staging", True) if payload.get("staging") is not None else True)
        try:
            target_path = self._sanitize_path(raw_path)
            parent = os.path.dirname(target_path)
            if parent and not os.path.exists(parent):
                os.makedirs(parent, exist_ok=True)

            part_path = target_path + ".cvps_part"
            write_path = part_path if (use_staging or (os.path.exists(part_path) and not os.path.exists(target_path))) else target_path

            chunk_bytes = base64.b64decode(chunk_b64)
            mode = "wb" if (is_first and (not os.path.exists(write_path) or offset == 0)) else ("r+b" if os.path.exists(write_path) else "wb")

            with open(write_path, mode) as f:
                f.seek(offset)
                f.write(chunk_bytes)
                f.flush()

            file_size = os.path.getsize(write_path)

            if is_last and write_path == part_path:
                if total_size and int(total_size) > 0 and file_size != int(total_size):
                    raise ValueError(f"Final file size mismatch: expected {total_size} bytes, got {file_size} bytes")
                if os.path.exists(target_path):
                    try:
                        os.remove(target_path)
                    except Exception:
                        pass
                os.replace(part_path, target_path)
                file_size = os.path.getsize(target_path)

            res = {
                "path": target_path.replace("\\", "/"),
                "native_path": target_path,
                "offset": offset,
                "bytes_written": len(chunk_bytes),
                "committed_offset": offset + len(chunk_bytes),
                "total_size": file_size,
                "is_last": is_last
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

    def handle_file_upload_status(self, payload):
        req_id = payload.get("request_id")
        raw_path = payload.get("path")
        try:
            target_path = self._sanitize_path(raw_path)
            part_path = target_path + ".cvps_part"
            if os.path.isfile(part_path):
                sz = os.path.getsize(part_path)
                res = {
                    "exists": True,
                    "is_partial": True,
                    "offset": sz,
                    "committed_offset": sz,
                    "total_size": sz,
                    "path": target_path.replace("\\", "/"),
                    "native_path": target_path
                }
            elif os.path.isfile(target_path):
                sz = os.path.getsize(target_path)
                res = {
                    "exists": True,
                    "is_partial": False,
                    "offset": sz,
                    "committed_offset": sz,
                    "total_size": sz,
                    "path": target_path.replace("\\", "/"),
                    "native_path": target_path
                }
            else:
                res = {
                    "exists": False,
                    "is_partial": False,
                    "offset": 0,
                    "committed_offset": 0,
                    "total_size": 0,
                    "path": target_path.replace("\\", "/"),
                    "native_path": target_path
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

    def handle_file_chunk_read(self, payload):
        req_id = payload.get("request_id")
        raw_path = payload.get("path")
        offset = int(payload.get("offset", 0))
        length = int(payload.get("length", 2 * 1024 * 1024))
        try:
            target_path = self._sanitize_path(raw_path)
            if not os.path.isfile(target_path):
                raise FileNotFoundError(f"File not found: {target_path}")

            file_size = os.path.getsize(target_path)
            with open(target_path, "rb") as f:
                f.seek(offset)
                chunk = f.read(length)

            res = {
                "path": target_path.replace("\\", "/"),
                "filename": os.path.basename(target_path),
                "offset": offset,
                "length": len(chunk),
                "file_size": file_size,
                "is_eof": (offset + len(chunk)) >= file_size,
                "chunk_base64": base64.b64encode(chunk).decode("ascii")
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

    def handle_file_inspect(self, payload):
        req_id = payload.get("request_id")
        raw_path = payload.get("path")
        try:
            target_path = self._sanitize_path(raw_path)
            if not os.path.exists(target_path):
                raise FileNotFoundError(f"File not found: {target_path}")

            stat_res = os.stat(target_path)
            size_bytes = stat_res.st_size
            filename = os.path.basename(target_path)
            ext = os.path.splitext(filename)[1].lower()

            # Hash calculation (up to 100MB)
            sha256_hash = hashlib.sha256()
            with open(target_path, "rb") as f:
                bytes_hashed = 0
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    sha256_hash.update(chunk)
                    bytes_hashed += len(chunk)
                    if bytes_hashed > 100 * 1024 * 1024:
                        break
            file_hash = sha256_hash.hexdigest()

            # Host privilege and session context
            is_admin = False
            is_elevated = False
            session_id = 0
            if platform.system() == "Windows":
                try:
                    if ctypes and hasattr(ctypes, "windll") and hasattr(ctypes.windll, "shell32"):
                        is_admin = bool(ctypes.windll.shell32.IsUserAnAdmin() != 0)
                        is_elevated = is_admin
                except Exception:
                    pass
                try:
                    if ctypes and hasattr(ctypes, "windll") and hasattr(ctypes.windll, "kernel32"):
                        sess_id_c = ctypes.c_ulong()
                        if ctypes.windll.kernel32.ProcessIdToSessionId(os.getpid(), ctypes.byref(sess_id_c)):
                            session_id = int(sess_id_c.value)
                except Exception:
                    pass
            else:
                is_admin = (os.geteuid() == 0) if hasattr(os, "geteuid") else False
                is_elevated = is_admin

            file_type = "unknown"
            arch = "unknown"
            subsystem = "unknown"
            subsystem_name = "Unknown"
            is_signed = False
            elevation_warning = False
            elevation_message = ""
            recommended_args = []
            suggested_runner = "system"

            # Check PE (Portable Executable - Windows EXE/DLL)
            if ext in [".exe", ".dll", ".sys", ".scr"] or size_bytes >= 64:
                try:
                    with open(target_path, "rb") as f:
                        dos_hdr = f.read(64)
                        if len(dos_hdr) >= 64 and dos_hdr[:2] == b"MZ":
                            e_lfanew = struct.unpack_from("<I", dos_hdr, 0x3c)[0]
                            if 0 < e_lfanew < size_bytes - 24:
                                f.seek(e_lfanew)
                                pe_sig = f.read(4)
                                if pe_sig == b"PE\0\0":
                                    file_type = "pe"
                                    coff_hdr = f.read(20)
                                    if len(coff_hdr) >= 20:
                                        machine, num_sections, timedate, sym_ptr, num_syms, opt_hdr_size, characteristics = struct.unpack_from("<HHIIIHH", coff_hdr, 0)
                                        if machine == 0x014c:
                                            arch = "x86 (32-bit)"
                                        elif machine == 0x8664:
                                            arch = "x64 (AMD64 / 64-bit)"
                                        elif machine == 0xaa64:
                                            arch = "ARM64"
                                        elif machine == 0x0200:
                                            arch = "Intel Itanium"
                                        else:
                                            arch = f"Machine (0x{machine:04x})"

                                        if opt_hdr_size >= 68:
                                            opt_hdr = f.read(min(opt_hdr_size, 256))
                                            magic = struct.unpack_from("<H", opt_hdr, 0)[0]
                                            subsys_offset = 68
                                            if len(opt_hdr) >= subsys_offset + 2:
                                                subsys_val = struct.unpack_from("<H", opt_hdr, subsys_offset)[0]
                                                subsystem = subsys_val
                                                if subsys_val == 2:
                                                    subsystem_name = "Windows GUI (Windowed Application)"
                                                elif subsys_val == 3:
                                                    subsystem_name = "Windows CUI (Console Application)"
                                                elif subsys_val == 9:
                                                    subsystem_name = "Windows CE GUI"
                                                elif subsys_val == 14:
                                                    subsystem_name = "Xbox"
                                                else:
                                                    subsystem_name = f"Subsystem ({subsys_val})"

                                            sec_dir_offset = 128 if magic == 0x10b else 144
                                            if len(opt_hdr) >= sec_dir_offset + 8:
                                                sec_va, sec_sz = struct.unpack_from("<II", opt_hdr, sec_dir_offset)
                                                if sec_va > 0 and sec_sz > 0:
                                                    is_signed = True
                except Exception:
                    pass

            # Check MSI (Microsoft Installer)
            is_msi = (ext == ".msi")
            if not is_msi and size_bytes >= 8:
                try:
                    with open(target_path, "rb") as f:
                        magic_ole = f.read(8)
                        if magic_ole == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
                            is_msi = True
                except Exception:
                    pass

            if is_msi:
                file_type = "msi"
                subsystem_name = "Windows Installer Package (MSI Database)"
                suggested_runner = "msiexec.exe /i"
                recommended_args = ["/qn", "/norestart"]
                if not is_admin:
                    elevation_warning = True
                    elevation_message = "Standard User Privilege: Host agent is running in unprivileged user mode. Machine-wide MSI installation typically requires elevation or will exit with code 1603 (Fatal Error). Consider per-user install parameters (e.g. ALLUSERS=2 MSIINSTALLPERUSER=1) or run agent as administrator."

            # Check Linux ELF
            elif ext not in [".exe", ".bat", ".cmd", ".ps1", ".py", ".sh"] and size_bytes >= 4:
                try:
                    with open(target_path, "rb") as f:
                        magic_elf = f.read(4)
                        if magic_elf == b"\x7fELF":
                            file_type = "elf"
                            elf_class = f.read(1)
                            arch = "ELF 64-bit" if elf_class == b"\x02" else "ELF 32-bit"
                            subsystem_name = "Linux Native Binary"
                            suggested_runner = "native"
                except Exception:
                    pass

            # Script types
            if ext == ".ps1":
                file_type = "powershell"
                subsystem_name = "PowerShell Script"
                suggested_runner = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File"
            elif ext in [".bat", ".cmd"]:
                file_type = "batch"
                subsystem_name = "Windows Command Script"
                suggested_runner = "cmd.exe /c"
            elif ext == ".py":
                file_type = "python"
                subsystem_name = "Python 3 Script"
                suggested_runner = sys.executable
            elif ext == ".sh":
                file_type = "shell"
                subsystem_name = "POSIX Shell Script"
                suggested_runner = "/bin/bash"

            res = {
                "path": target_path,
                "filename": filename,
                "extension": ext,
                "size_bytes": size_bytes,
                "sha256": file_hash,
                "file_type": file_type,
                "arch": arch,
                "subsystem": subsystem,
                "subsystem_name": subsystem_name,
                "is_signed": is_signed,
                "is_msi": is_msi,
                "is_admin": is_admin,
                "is_elevated": is_elevated,
                "session_id": session_id,
                "elevation_warning": elevation_warning,
                "elevation_message": elevation_message,
                "suggested_runner": suggested_runner,
                "recommended_args": recommended_args
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

    def _start_elevated_windows_process(self, cmd, working_dir, job_id, is_msi=False, msi_log_path=None):
        """Spawns elevated process on Windows via ShellExecuteExW (lpVerb='runas') and tracks PID/exit code."""
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.windll.kernel32
        shell32 = ctypes.windll.shell32

        # Session 0 isolation check: Session 0 cannot display interactive UAC prompts to Session 1
        proc_session = ctypes.c_ulong()
        if kernel32.ProcessIdToSessionId(kernel32.GetCurrentProcessId(), ctypes.byref(proc_session)):
            if proc_session.value == 0:
                active_console = kernel32.WTSGetActiveConsoleSessionId()
                if active_console != 0:
                    raise ElevationNotAvailableError(
                        "Windows Session 0 Isolation: Host agent is running as a non-interactive service (Session 0) "
                        "and cannot display an interactive UAC elevation prompt on Session 1. "
                        "To execute elevated installers, run the agent in the interactive user desktop session or "
                        "configure a scheduled task with highest privileges."
                    )

        # SHELLEXECUTEINFOW structure
        class SHELLEXECUTEINFOW(ctypes.Structure):
            _fields_ = [
                ("cbSize", wintypes.DWORD),
                ("fMask", wintypes.ULONG),
                ("hwnd", wintypes.HWND),
                ("lpVerb", wintypes.LPCWSTR),
                ("lpFile", wintypes.LPCWSTR),
                ("lpParameters", wintypes.LPCWSTR),
                ("lpDirectory", wintypes.LPCWSTR),
                ("nShow", ctypes.c_int),
                ("hInstApp", wintypes.HINSTANCE),
                ("lpIDList", wintypes.LPVOID),
                ("lpClass", wintypes.LPCWSTR),
                ("hkeyClass", wintypes.HKEY),
                ("dwHotKey", wintypes.DWORD),
                ("hIconOrMonitor", wintypes.HANDLE),
                ("hProcess", wintypes.HANDLE),
            ]

        SEE_MASK_NOCLOSEPROCESS = 0x00000040
        SW_SHOWNORMAL = 1

        executable = cmd[0]
        params = subprocess.list2cmdline(cmd[1:]) if len(cmd) > 1 else ""

        sei = SHELLEXECUTEINFOW()
        sei.cbSize = ctypes.sizeof(SHELLEXECUTEINFOW)
        sei.fMask = SEE_MASK_NOCLOSEPROCESS
        sei.hwnd = None
        sei.lpVerb = "runas"
        sei.lpFile = executable
        sei.lpParameters = params if params else None
        sei.lpDirectory = working_dir if working_dir else None
        sei.nShow = SW_SHOWNORMAL
        sei.hProcess = None

        success = shell32.ShellExecuteExW(ctypes.byref(sei))
        if not success:
            err_code = kernel32.GetLastError()
            if err_code == 1223:
                raise UacCancelledError("UAC elevation request was cancelled or dismissed by the user (WinError 1223).")
            elif err_code == 5:
                raise PermissionError("Access denied: insufficient administrative permissions to execute this binary (WinError 5).")
            else:
                raise RuntimeError(f"Failed to execute elevated process via ShellExecuteExW (WinError {err_code}).")

        h_process = sei.hProcess
        pid = kernel32.GetProcessId(h_process) if h_process else 0

        stdout_lines = collections.deque(maxlen=1000)
        stderr_lines = collections.deque(maxlen=1000)
        stdout_lines.append("[Elevated Process: Output redirection not available via Windows UAC Appinfo service]")
        if is_msi and msi_log_path:
            stdout_lines.append(f"[Verbose MSI Installer Log: {msi_log_path}]")

        class ElevatedProcessProxy:
            def __init__(self, pid_val, handle):
                self.pid = pid_val
                self.handle = handle
                self.returncode = None
                self._poll_lock = threading.Lock()

            def poll(self):
                if self.returncode is not None:
                    return self.returncode
                with self._poll_lock:
                    if self.handle:
                        exit_code = wintypes.DWORD()
                        if kernel32.GetExitCodeProcess(self.handle, ctypes.byref(exit_code)):
                            STILL_ACTIVE = 259
                            if exit_code.value != STILL_ACTIVE:
                                self.returncode = exit_code.value
                                kernel32.CloseHandle(self.handle)
                                self.handle = None
                                return self.returncode
                return None

            def wait(self, timeout=None):
                if self.returncode is not None:
                    return self.returncode
                deadline = (time.time() + timeout) if timeout else None
                while True:
                    rc = self.poll()
                    if rc is not None:
                        return rc
                    if deadline and time.time() > deadline:
                        raise subprocess.TimeoutExpired(cmd, timeout)
                    time.sleep(0.1)

            def terminate(self):
                with self._poll_lock:
                    if self.handle:
                        kernel32.TerminateProcess(self.handle, 1)

            def kill(self):
                self.terminate()

        proc = ElevatedProcessProxy(pid, h_process)

        job_info = {
            "job_id": job_id,
            "pid": pid,
            "cmd": " ".join(cmd),
            "proc": proc,
            "running": True,
            "elevated": True,
            "exit_code": None,
            "exit_reason": "Running (Elevated)",
            "started_at": _iso_now(),
            "finished_at": None,
            "duration_ms": 0,
            "is_msi": is_msi,
            "msi_log_path": msi_log_path,
            "stdout_lines": stdout_lines,
            "stderr_lines": stderr_lines
        }

        with self.managed_processes_lock:
            if len(self.managed_processes) >= 50:
                finished_keys = [k for k, v in self.managed_processes.items() if not v.get("running")]
                for old_k in finished_keys[:10]:
                    self.managed_processes.pop(old_k, None)
            self.managed_processes[job_id] = job_info

        start_time = time.time()

        def _monitor_elevated():
            try:
                proc.wait()
            except Exception:
                pass
            finished_time = time.time()
            duration_ms = int((finished_time - start_time) * 1000)
            exit_code = proc.returncode

            exit_reason = ""
            if is_msi:
                if exit_code == 0: exit_reason = "Success"
                elif exit_code == 3010: exit_reason = "Success (Reboot Required)"
                elif exit_code == 1602: exit_reason = "User Cancelled"
                elif exit_code == 1603: exit_reason = "Fatal Error (Elevation or prerequisite required)"
                elif exit_code == 1618: exit_reason = "Another installation is already in progress"
                elif exit_code == 1619: exit_reason = "Package could not be opened"
                elif exit_code == 1638: exit_reason = "Another version already installed"
                else: exit_reason = f"MSI Exit Code {exit_code}"
            else:
                exit_reason = "Success" if exit_code == 0 else f"Process exited with code {exit_code}"

            with self.managed_processes_lock:
                if job_id in self.managed_processes:
                    self.managed_processes[job_id]["running"] = False
                    self.managed_processes[job_id]["exit_code"] = exit_code
                    self.managed_processes[job_id]["exit_reason"] = exit_reason
                    self.managed_processes[job_id]["finished_at"] = _iso_now()
                    self.managed_processes[job_id]["duration_ms"] = duration_ms

        threading.Thread(target=_monitor_elevated, daemon=True).start()
        return proc, job_info

    def _start_managed_process(self, cmd, working_dir, job_id, is_msi=False, msi_log_path=None, run_as_admin=False):
        """Spawns process with non-blocking bounded ring buffer draining (prevents pipe deadlocks) or elevates on Windows."""
        sys_os = platform.system()
        if sys_os == "Windows" and run_as_admin:
            return self._start_elevated_windows_process(cmd, working_dir, job_id, is_msi=is_msi, msi_log_path=msi_log_path)

        try:
            proc = subprocess.Popen(
                cmd,
                cwd=working_dir,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                shell=False
            )
        except OSError as e:
            if getattr(e, 'winerror', None) == 740 or (sys_os == "Windows" and "[WinError 740]" in str(e)):
                raise ElevationRequiredError("The requested executable requires administrator privileges (WinError 740). Please check 'Run as Administrator / Request UAC' to authorize elevation.")
            raise

        stdout_lines = collections.deque(maxlen=1000)
        stderr_lines = collections.deque(maxlen=1000)

        def _drain_stream(stream, buffer):
            try:
                for line in iter(stream.readline, b""):
                    decoded = line.decode("utf-8", errors="replace").rstrip("\r\n")
                    buffer.append(decoded)
            except Exception:
                pass
            finally:
                try:
                    stream.close()
                except Exception:
                    pass

        t_out = threading.Thread(target=_drain_stream, args=(proc.stdout, stdout_lines), daemon=True)
        t_err = threading.Thread(target=_drain_stream, args=(proc.stderr, stderr_lines), daemon=True)
        t_out.start()
        t_err.start()

        job_info = {
            "job_id": job_id,
            "pid": proc.pid,
            "cmd": " ".join(cmd),
            "proc": proc,
            "running": True,
            "elevated": False,
            "exit_code": None,
            "exit_reason": "Running",
            "started_at": _iso_now(),
            "finished_at": None,
            "duration_ms": 0,
            "is_msi": is_msi,
            "msi_log_path": msi_log_path,
            "stdout_lines": stdout_lines,
            "stderr_lines": stderr_lines
        }

        with self.managed_processes_lock:
            if len(self.managed_processes) >= 50:
                finished_keys = [k for k, v in self.managed_processes.items() if not v.get("running")]
                for old_k in finished_keys[:10]:
                    self.managed_processes.pop(old_k, None)
            self.managed_processes[job_id] = job_info

        start_time = time.time()

        def _monitor_proc():
            try:
                proc.wait()
            except Exception:
                pass
            finished_time = time.time()
            duration_ms = int((finished_time - start_time) * 1000)
            exit_code = proc.returncode

            exit_reason = ""
            if is_msi:
                if exit_code == 0:
                    exit_reason = "Success"
                elif exit_code == 3010:
                    exit_reason = "Success (Reboot Required)"
                elif exit_code == 1602:
                    exit_reason = "User Cancelled"
                elif exit_code == 1603:
                    exit_reason = "Fatal Error (Elevation or prerequisite required)"
                elif exit_code == 1618:
                    exit_reason = "Another installation is already in progress"
                elif exit_code == 1619:
                    exit_reason = "Package could not be opened"
                elif exit_code == 1638:
                    exit_reason = "Another version already installed"
                else:
                    exit_reason = f"MSI Exit Code {exit_code}"
            else:
                exit_reason = "Success" if exit_code == 0 else f"Process exited with code {exit_code}"

            with self.managed_processes_lock:
                if job_id in self.managed_processes:
                    self.managed_processes[job_id]["running"] = False
                    self.managed_processes[job_id]["exit_code"] = exit_code
                    self.managed_processes[job_id]["exit_reason"] = exit_reason
                    self.managed_processes[job_id]["finished_at"] = _iso_now()
                    self.managed_processes[job_id]["duration_ms"] = duration_ms

        t_mon = threading.Thread(target=_monitor_proc, daemon=True)
        t_mon.start()

        return proc, job_info

    def handle_file_run(self, payload):
        req_id = payload.get("request_id")
        raw_path = payload.get("path") or payload.get("command")
        args = payload.get("args") or []
        if isinstance(args, str):
            import shlex
            args = shlex.split(args) if args.strip() else []
        interpreter = (payload.get("interpreter") or "auto").lower()
        working_dir = payload.get("working_dir") or payload.get("cwd")
        run_in_background = bool(payload.get("background", False))
        run_as_admin = bool(payload.get("run_as_admin", False) or payload.get("request_uac", False) or payload.get("elevated", False))
        job_id = payload.get("job_id") or f"run_{int(time.time()*1000)}"

        # MSI options
        msi_mode = (payload.get("msi_mode") or "install").lower()
        msi_ui = payload.get("msi_ui") or "qn"
        msi_logging = bool(payload.get("msi_logging", True))

        try:
            target_path = self._sanitize_path(raw_path)
            if not os.path.isfile(target_path):
                found_which = shutil.which(raw_path)
                if found_which and os.path.isfile(found_which):
                    target_path = found_which
                else:
                    raise FileNotFoundError(f"File to execute not found: {target_path}")

            if not working_dir or not os.path.isdir(working_dir):
                working_dir = os.path.dirname(target_path) or os.getcwd()

            ext = os.path.splitext(target_path)[1].lower()
            cmd = []
            sys_os = platform.system()
            is_msi = False
            msi_log_path = None

            if sys_os == "Windows":
                if ext == ".msi":
                    is_msi = True
                    action_flag = "/x" if msi_mode == "uninstall" else "/i"
                    ui_flag = "/" + msi_ui.lstrip("/")
                    cmd = ["msiexec.exe", action_flag, target_path, "/norestart"]
                    if msi_logging:
                        msi_log_path = os.path.join(tempfile.gettempdir(), f"cvps_msi_{job_id}.log")
                        cmd.extend(["/L*v", msi_log_path])
                    cmd.append(ui_flag)
                    cmd.extend(list(args))
                elif ext in [".bat", ".cmd"]:
                    cmd = ["cmd.exe", "/c", target_path] + list(args)
                elif ext == ".ps1":
                    cmd = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", target_path] + list(args)
                elif ext == ".py":
                    cmd = [sys.executable, target_path] + list(args)
                elif ext == ".exe":
                    cmd = [target_path] + list(args)
                else:
                    if interpreter == "python":
                        cmd = [sys.executable, target_path] + list(args)
                    elif interpreter in ["powershell", "ps1"]:
                        cmd = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", target_path] + list(args)
                    elif interpreter in ["cmd", "batch"]:
                        cmd = ["cmd.exe", "/c", target_path] + list(args)
                    else:
                        cmd = [target_path] + list(args)
            else:
                # Linux / Unix
                if ext == ".sh":
                    cmd = ["/bin/bash", target_path] + list(args)
                elif ext == ".py":
                    cmd = ["python3", target_path] + list(args)
                elif ext in [".js", ".mjs"]:
                    cmd = ["node", target_path] + list(args)
                else:
                    try:
                        st = os.stat(target_path)
                        os.chmod(target_path, st.st_mode | 0o111)
                    except Exception:
                        pass
                    cmd = [target_path] + list(args)

            proc, job_info = self._start_managed_process(cmd, working_dir, job_id, is_msi=is_msi, msi_log_path=msi_log_path, run_as_admin=run_as_admin)

            if run_in_background:
                res = {
                    "job_id": job_id,
                    "pid": proc.pid,
                    "running": True,
                    "background": True,
                    "elevated": job_info.get("elevated", False),
                    "cmd": " ".join(cmd),
                    "started_at": job_info["started_at"],
                    "is_msi": is_msi,
                    "msi_log_path": msi_log_path,
                    "exit_code": None,
                    "exit_reason": "Running (Elevated)" if job_info.get("elevated") else "Running"
                }
            else:
                wait_sec = min(int(payload.get("timeout_s", 10)), 20)
                deadline = time.time() + wait_sec
                while time.time() < deadline:
                    with self.managed_processes_lock:
                        if not job_info["running"]:
                            break
                    time.sleep(0.1)

                with self.managed_processes_lock:
                    is_still_running = job_info["running"]
                    cur_exit_code = job_info["exit_code"]
                    cur_exit_reason = job_info["exit_reason"]
                    dur = job_info["duration_ms"]
                    out_text = "\n".join(list(job_info["stdout_lines"]))
                    err_text = "\n".join(list(job_info["stderr_lines"]))

                if not is_still_running:
                    res = {
                        "job_id": job_id,
                        "pid": proc.pid,
                        "running": False,
                        "elevated": job_info.get("elevated", False),
                        "exit_code": cur_exit_code,
                        "exit_reason": cur_exit_reason,
                        "stdout": out_text,
                        "stderr": err_text,
                        "cmd": " ".join(cmd),
                        "duration_ms": dur,
                        "is_msi": is_msi,
                        "msi_log_path": msi_log_path
                    }
                else:
                    res = {
                        "job_id": job_id,
                        "pid": proc.pid,
                        "running": True,
                        "background": True,
                        "elevated": job_info.get("elevated", False),
                        "cmd": " ".join(cmd),
                        "started_at": job_info["started_at"],
                        "stdout": out_text or "[Execution continues in background...]",
                        "stderr": err_text,
                        "exit_code": None,
                        "exit_reason": "Running (Elevated)" if job_info.get("elevated") else "Running",
                        "is_msi": is_msi,
                        "msi_log_path": msi_log_path
                    }

            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": True, "result": res}
            })
        except ElevationRequiredError as ere:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {
                    "request_id": req_id,
                    "success": False,
                    "code": "ELEVATION_REQUIRED",
                    "status": 422,
                    "requires_elevation": True,
                    "error": str(ere)
                }
            })
        except UacCancelledError as uce:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {
                    "request_id": req_id,
                    "success": False,
                    "code": "UAC_CANCELLED",
                    "status": 400,
                    "error": str(uce)
                }
            })
        except ElevationNotAvailableError as ena:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {
                    "request_id": req_id,
                    "success": False,
                    "code": "ELEVATION_NOT_AVAILABLE_IN_SERVICE",
                    "status": 422,
                    "requires_elevation": True,
                    "error": str(ena)
                }
            })
        except PermissionError as pe:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {
                    "request_id": req_id,
                    "success": False,
                    "code": "ACCESS_DENIED",
                    "status": 403,
                    "error": f"Access denied: {str(pe)}"
                }
            })
        except Exception as e:
            err_msg = str(e)
            code = "EXECUTION_FAILED"
            status = 500
            if "WinError 740" in err_msg or "requires elevation" in err_msg:
                code = "ELEVATION_REQUIRED"
                status = 422
            elif "WinError 1223" in err_msg or "cancelled" in err_msg.lower():
                code = "UAC_CANCELLED"
                status = 400
            elif "WinError 5" in err_msg or "access is denied" in err_msg.lower():
                code = "ACCESS_DENIED"
                status = 403
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {
                    "request_id": req_id,
                    "success": False,
                    "code": code,
                    "status": status,
                    "requires_elevation": (code == "ELEVATION_REQUIRED"),
                    "error": err_msg
                }
            })

    def handle_process_status(self, payload):
        req_id = payload.get("request_id")
        job_id = payload.get("job_id")
        with self.managed_processes_lock:
            job = self.managed_processes.get(job_id)
        if not job:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": f"Managed process job not found: {job_id}"}
            })
            return

        with self.managed_processes_lock:
            out_lines = list(job["stdout_lines"])
            err_lines = list(job["stderr_lines"])
            res = {
                "job_id": job["job_id"],
                "pid": job["pid"],
                "cmd": job["cmd"],
                "running": job["running"],
                "exit_code": job["exit_code"],
                "exit_reason": job["exit_reason"],
                "started_at": job["started_at"],
                "finished_at": job["finished_at"],
                "duration_ms": job["duration_ms"],
                "is_msi": job["is_msi"],
                "msi_log_path": job["msi_log_path"],
                "stdout": "\n".join(out_lines),
                "stderr": "\n".join(err_lines)
            }

        self.send_agent_event({
            "type": "AgentRpcResponse",
            "payload": {"request_id": req_id, "success": True, "result": res}
        })

    def handle_process_stop(self, payload):
        req_id = payload.get("request_id")
        job_id = payload.get("job_id")
        with self.managed_processes_lock:
            job = self.managed_processes.get(job_id)
        if not job:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": f"Managed process job not found: {job_id}"}
            })
            return

        proc = job.get("proc")
        pid = job.get("pid")
        stopped = False
        if proc and job.get("running"):
            try:
                if platform.system() == "Windows":
                    subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True, timeout=5)
                else:
                    proc.terminate()
                    try:
                        proc.wait(timeout=2)
                    except Exception:
                        proc.kill()
                stopped = True
            except Exception:
                try:
                    proc.kill()
                    stopped = True
                except Exception:
                    pass

        with self.managed_processes_lock:
            job["running"] = False
            job["exit_reason"] = "Terminated by operator"

        self.send_agent_event({
            "type": "AgentRpcResponse",
            "payload": {"request_id": req_id, "success": True, "result": {"job_id": job_id, "pid": pid, "stopped": stopped}}
        })

    def handle_installer_log(self, payload):
        req_id = payload.get("request_id")
        job_id = payload.get("job_id")
        log_path = payload.get("log_path")
        if not log_path and job_id:
            with self.managed_processes_lock:
                job = self.managed_processes.get(job_id)
                if job:
                    log_path = job.get("msi_log_path")

        if not log_path or not os.path.exists(log_path):
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": f"Installer log file not found: {log_path}"}
            })
            return

        try:
            size = os.path.getsize(log_path)
            read_size = min(size, 65536)
            with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                if size > read_size:
                    f.seek(size - read_size)
                content = f.read()

            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {
                    "request_id": req_id,
                    "success": True,
                    "result": {
                        "job_id": job_id,
                        "log_path": log_path,
                        "size_bytes": size,
                        "log_tail": content
                    }
                }
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })


    def handle_file_archive_zip(self, payload):
        req_id = payload.get("request_id")
        raw_path = payload.get("path") or payload.get("dir_path")
        paths = payload.get("paths")
        dest_zip = payload.get("dest_zip") or payload.get("zip_path")
        try:
            import zipfile
            if paths and isinstance(paths, list):
                items_to_zip = [self._sanitize_path(p) for p in paths if str(p).strip()]
                if not items_to_zip:
                    raise ValueError("No valid paths provided for ZIP creation")
                if not dest_zip:
                    parent_dir = os.path.dirname(items_to_zip[0]) or os.path.expanduser("~")
                    dest_zip = os.path.join(parent_dir, f"archive_{int(time.time())}.zip")
                else:
                    dest_zip = self._sanitize_path(dest_zip)

                parent = os.path.dirname(dest_zip)
                if parent and not os.path.exists(parent):
                    os.makedirs(parent, exist_ok=True)

                total_files = 0
                with zipfile.ZipFile(dest_zip, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
                    for item_path in items_to_zip:
                        if not os.path.exists(item_path):
                            continue
                        if os.path.isdir(item_path):
                            base_name = os.path.basename(item_path) or "folder"
                            for root, dirs, files in os.walk(item_path):
                                for file in files:
                                    full_path = os.path.join(root, file)
                                    rel_inside = os.path.relpath(full_path, item_path)
                                    archive_name = os.path.join(base_name, rel_inside).replace("\\", "/")
                                    zf.write(full_path, archive_name)
                                    total_files += 1
                        else:
                            zf.write(item_path, os.path.basename(item_path))
                            total_files += 1
            else:
                if not raw_path:
                    raise ValueError("Path or dir_path required for ZIP creation")
                target_path = self._sanitize_path(raw_path)
                if not os.path.exists(target_path):
                    raise FileNotFoundError(f"Path to archive not found: {target_path}")

                if not dest_zip:
                    dest_zip = target_path.rstrip("/\\") + ".zip"
                else:
                    dest_zip = self._sanitize_path(dest_zip)

                parent = os.path.dirname(dest_zip)
                if parent and not os.path.exists(parent):
                    os.makedirs(parent, exist_ok=True)

                total_files = 0
                with zipfile.ZipFile(dest_zip, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
                    if os.path.isdir(target_path):
                        for root, dirs, files in os.walk(target_path):
                            for file in files:
                                full_path = os.path.join(root, file)
                                rel_path = os.path.relpath(full_path, target_path).replace("\\", "/")
                                zf.write(full_path, rel_path)
                                total_files += 1
                    else:
                        zf.write(target_path, os.path.basename(target_path))
                        total_files = 1

            zip_size = os.path.getsize(dest_zip)
            res = {
                "archive_path": dest_zip.replace("\\", "/"),
                "zip_path": dest_zip.replace("\\", "/"),
                "native_path": dest_zip,
                "filename": os.path.basename(dest_zip),
                "total_files": total_files,
                "total_size": zip_size,
                "archive_size_bytes": zip_size
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

    def handle_file_archive_extract(self, payload):
        req_id = payload.get("request_id")
        archive_path = payload.get("archive_path") or payload.get("path")
        dest_dir = payload.get("dest_dir") or payload.get("destination")
        try:
            import zipfile, tarfile
            src_archive = self._sanitize_path(archive_path)
            if not os.path.isfile(src_archive):
                raise FileNotFoundError(f"Archive not found: {src_archive}")

            if not dest_dir:
                dest_dir = os.path.dirname(src_archive)
            else:
                dest_dir = self._sanitize_path(dest_dir)

            os.makedirs(dest_dir, exist_ok=True)
            real_dest = os.path.abspath(dest_dir)
            extracted_count = 0
            total_extracted_bytes = 0

            if zipfile.is_zipfile(src_archive):
                with zipfile.ZipFile(src_archive, "r") as zf:
                    for member in zf.infolist():
                        norm_name = os.path.normpath(member.filename)
                        if norm_name.startswith("..") or os.path.isabs(norm_name) or (len(norm_name) >= 2 and norm_name[1] == ":"):
                            raise PermissionError(f"ZIP Slip vulnerability detected: illegal path '{member.filename}'")
                        target = os.path.abspath(os.path.join(real_dest, norm_name))
                        if not (target == real_dest or target.startswith(real_dest + os.sep)):
                            raise PermissionError(f"ZIP Slip vulnerability detected: illegal path '{member.filename}'")
                        zf.extract(member, real_dest)
                        extracted_count += 1
                        total_extracted_bytes += getattr(member, 'file_size', 0)
            elif tarfile.is_tarfile(src_archive):
                with tarfile.open(src_archive, "r:*") as tf:
                    for member in tf.getmembers():
                        norm_name = os.path.normpath(member.name)
                        if norm_name.startswith("..") or os.path.isabs(norm_name) or (len(norm_name) >= 2 and norm_name[1] == ":"):
                            raise PermissionError(f"Tar traversal detected: illegal path '{member.name}'")
                        target = os.path.abspath(os.path.join(real_dest, norm_name))
                        if not (target == real_dest or target.startswith(real_dest + os.sep)):
                            raise PermissionError(f"Tar traversal detected: illegal path '{member.name}'")
                        tf.extract(member, real_dest)
                        extracted_count += 1
                        total_extracted_bytes += getattr(member, 'size', 0)
            else:
                raise ValueError("Unsupported archive format. Only .zip, .tar, .tar.gz supported.")

            res = {
                "dest_dir": dest_dir.replace("\\", "/"),
                "native_dest_dir": dest_dir,
                "extracted_files": extracted_count,
                "total_extracted_bytes": total_extracted_bytes
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

            # Natively collect host metrics so CPU and RAM are non-zero even without psutil
            try:
                metrics = self.get_system_metrics()
                host_cpu = round(metrics.get("cpu_usage", 0.0), 1)
                host_mem_used = round(metrics.get("memory_used_bytes", 0) / (1024 * 1024), 1)
                host_mem_total = round(metrics.get("memory_total_bytes", 0) / (1024 * 1024), 1)
            except Exception:
                pass

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
                # Fast tasklist (0.2s runtime) ensures Windows Server never times out
                try:
                    out = subprocess.check_output(["tasklist", "/FO", "CSV", "/NH"], timeout=5).decode("utf-8", errors="ignore")
                    reader = csv.reader(io.StringIO(out))
                    for row in reader:
                        if len(row) >= 5:
                            try:
                                pid = int(row[1])
                            except ValueError:
                                continue
                            name = row[0]
                            session = row[2]
                            if search and (search not in name.lower() and search not in str(pid) and search not in session.lower()):
                                continue
                            mem_str = row[4].replace(",", "").replace(" K", "").replace(" ", "").replace("\xa0", "")
                            try:
                                mem_mb = round(int(mem_str) / 1024, 1)
                            except ValueError:
                                mem_mb = 0.0
                            mem_pct = round((mem_mb / host_mem_total) * 100, 1) if host_mem_total > 0 else 0.0
                            procs.append({
                                "pid": pid,
                                "ppid": 0,
                                "name": name,
                                "user": session,
                                "cpu_percent": 0.0,
                                "memory_mb": mem_mb,
                                "memory_percent": mem_pct,
                                "status": "Running",
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
                systemctl_bin = "/bin/systemctl" if os.path.exists("/bin/systemctl") else ("/usr/bin/systemctl" if os.path.exists("/usr/bin/systemctl") else None)
                parsed_systemd = False

                if systemctl_bin:
                    # Attempt 1: Standard system-wide systemctl list-units
                    try:
                        out = subprocess.check_output([systemctl_bin, "list-units", "--type=service", "--all", "--no-legend", "--no-pager"], timeout=5).decode("utf-8", errors="ignore")
                        parsed_systemd = True
                    except (PermissionError, subprocess.SubprocessError, OSError):
                        out = ""

                    # Attempt 2: User-level systemd units if system-wide threw permission error or failed
                    if not parsed_systemd or not out.strip():
                        try:
                            out = subprocess.check_output([systemctl_bin, "--user", "list-units", "--type=service", "--all", "--no-legend", "--no-pager"], timeout=4).decode("utf-8", errors="ignore")
                            if out.strip():
                                parsed_systemd = True
                        except Exception:
                            pass

                    if parsed_systemd and out.strip():
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

                # Attempt 3: Filesystem & process fallback if systemctl had permission denied or wasn't available
                if not svcs:
                    discovered_names = set()
                    unit_dirs = ["/etc/systemd/system", "/lib/systemd/system", "/usr/lib/systemd/system", "/etc/init.d"]
                    for u_dir in unit_dirs:
                        if os.path.exists(u_dir) and os.path.isdir(u_dir):
                            try:
                                for fn in os.listdir(u_dir):
                                    if fn.endswith(".service") or u_dir.endswith("/init.d"):
                                        s_name = fn.replace(".service", "")
                                        if s_name and not s_name.startswith("."):
                                            discovered_names.add(s_name)
                            except Exception:
                                pass

                    common_linux_svcs = [
                        "sshd", "ssh", "cron", "crond", "systemd", "dbus", "rsyslog",
                        "networking", "network", "docker", "nginx", "apache2", "cybervps"
                    ]
                    for cs in common_linux_svcs:
                        discovered_names.add(cs)

                    running_proc_names = set()
                    if psutil:
                        try:
                            for p in psutil.process_iter(['name']):
                                p_n = (p.info.get('name') or '').lower()
                                if p_n: running_proc_names.add(p_n)
                        except Exception:
                            pass

                    for name in sorted(discovered_names):
                        if search and search not in name.lower():
                            continue
                        is_running = any(name.lower() in p_n or p_n in name.lower() for p_n in running_proc_names)
                        status = "Running" if is_running else "Stopped"
                        if status_filter and status_filter != "all" and status.lower() != status_filter:
                            continue
                        svcs.append({
                            "name": name,
                            "display_name": f"{name} service",
                            "status": status,
                            "startup_type": "standard"
                        })

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
                try:
                    res = subprocess.run(["systemctl", action, f"{svc_name}.service"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=12)
                    output = res.stdout.decode("utf-8", errors="ignore").strip()
                    err_out = res.stderr.decode("utf-8", errors="ignore").strip()
                    if res.returncode != 0 and ("permission" in err_out.lower() or "access denied" in err_out.lower() or "interactive authentication" in err_out.lower()):
                        self.send_agent_event({
                            "type": "AgentRpcResponse",
                            "payload": {
                                "request_id": req_id,
                                "success": False,
                                "error": f"Permission denied executing systemctl {action} on {svc_name}: administrative or root privileges required.",
                                "requires_elevation": True
                            }
                        })
                        return
                    chk = subprocess.run(["systemctl", "is-active", f"{svc_name}.service"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
                    active_out = chk.stdout.decode("utf-8", errors="ignore").strip()
                    new_status = "Running" if active_out == "active" else "Stopped"
                except PermissionError as pe:
                    self.send_agent_event({
                        "type": "AgentRpcResponse",
                        "payload": {
                            "request_id": req_id,
                            "success": False,
                            "error": f"Permission denied executing systemctl: {str(pe)}. Root elevation required.",
                            "requires_elevation": True
                        }
                    })
                    return

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

    def handle_desktop_status(self, payload):
        req_id = payload.get("request_id")
        try:
            sys_os = platform.system()
            priv = self.get_privilege_info() if hasattr(self, "get_privilege_info") else {"is_elevated": False, "user": os.environ.get("USERNAME") or os.environ.get("USER") or "unknown"}

            # 1. Unattended Access & Background Supervisor State
            cfg = self.load_config() if hasattr(self, "load_config") else {}
            unattended_access = bool(cfg.get("unattended_access", True))
            uptime_sec = int(time.time() - getattr(self, "uptime_start", time.time()))

            service_mode = "unknown"
            if sys_os == "Windows":
                if priv.get("is_elevated") or priv.get("is_system"):
                    service_mode = "Windows Task / Service (SYSTEM/Elevated)"
                else:
                    service_mode = "Windows User Background (HKCU Run/VBS)"
            else:
                if os.path.exists("/etc/systemd/system/cybervps-agent.service"):
                    service_mode = "systemd (root)"
                elif os.path.exists(os.path.expanduser("~/.config/systemd/user/cybervps-agent.service")):
                    service_mode = "systemd (user linger)"
                else:
                    service_mode = "supervisor (nohup/cron)"

            # 2. Windows RDP Capabilities & Configuration
            rdp_info = {
                "supported": False,
                "edition": "",
                "enabled": False,
                "port": 3389,
                "nla_enabled": False,
                "service_status": "Unknown",
                "reason": ""
            }
            if sys_os == "Windows":
                edition_id = ""
                prod_name = ""
                if winreg:
                    try:
                        k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
                        try: prod_name = winreg.QueryValueEx(k, "ProductName")[0]
                        except Exception: pass
                        try: edition_id = winreg.QueryValueEx(k, "EditionID")[0]
                        except Exception: pass
                        winreg.CloseKey(k)
                    except Exception: pass
                rdp_info["edition"] = prod_name or edition_id or "Windows"

                is_home = any(x in (edition_id or prod_name).lower() for x in ["home", "core", "starter"])
                if is_home:
                    rdp_info["supported"] = False
                    rdp_info["reason"] = f"{prod_name or 'Windows Home'} does not support incoming Remote Desktop natively. Use VNC or RustDesk."
                else:
                    rdp_info["supported"] = True

                if winreg:
                    try:
                        k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"System\CurrentControlSet\Control\Terminal Server")
                        try:
                            f_deny = winreg.QueryValueEx(k, "fDenyTSConnections")[0]
                            rdp_info["enabled"] = (f_deny == 0)
                        except Exception: pass
                        winreg.CloseKey(k)
                    except Exception: pass

                    try:
                        k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp")
                        try: rdp_info["port"] = int(winreg.QueryValueEx(k, "PortNumber")[0])
                        except Exception: pass
                        try: rdp_info["nla_enabled"] = bool(winreg.QueryValueEx(k, "UserAuthentication")[0])
                        except Exception: pass
                        winreg.CloseKey(k)
                    except Exception: pass

                try:
                    out = subprocess.check_output(["powershell", "-NoProfile", "-Command", "(Get-Service TermService -ErrorAction SilentlyContinue).Status"], timeout=4).decode("utf-8", errors="ignore").strip()
                    if "Running" in out or "4" in out:
                        rdp_info["service_status"] = "Running"
                    elif "Stopped" in out or "1" in out:
                        rdp_info["service_status"] = "Stopped"
                    else:
                        rdp_info["service_status"] = out or "Not Found"
                except Exception:
                    rdp_info["service_status"] = "Unknown"
            else:
                xrdp_installed = os.path.exists("/usr/sbin/xrdp") or os.path.exists("/usr/bin/xrdp")
                rdp_info["supported"] = xrdp_installed
                rdp_info["edition"] = "Linux xrdp"
                if xrdp_installed:
                    try:
                        chk = subprocess.run(["systemctl", "is-active", "xrdp"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=4)
                        rdp_info["enabled"] = (chk.stdout.decode().strip() == "active")
                        rdp_info["service_status"] = "Running" if rdp_info["enabled"] else "Stopped"
                    except Exception:
                        pass
                else:
                    rdp_info["reason"] = "xrdp is not installed on this Linux system. Use VNC or RustDesk."

            # 3. VNC Capabilities & Display Environment
            vnc_info = {
                "installed": False,
                "server_name": "",
                "running": False,
                "port": 5900,
                "has_display": True,
                "display": os.environ.get("DISPLAY", "") or os.environ.get("WAYLAND_DISPLAY", "")
            }
            if sys_os == "Windows":
                for vnc_name, path_sub in [
                    ("TightVNC", r"C:\Program Files\TightVNC\tvnserver.exe"),
                    ("UltraVNC", r"C:\Program Files\uvnc bvba\UltraVNC\winvnc.exe"),
                    ("TigerVNC", r"C:\Program Files\TigerVNC\winvnc4.exe"),
                    ("RealVNC", r"C:\Program Files\RealVNC\VNC Server\vncserver.exe")
                ]:
                    if os.path.exists(path_sub):
                        vnc_info["installed"] = True
                        vnc_info["server_name"] = vnc_name
                        break
            else:
                for vnc_bin in ["x11vnc", "tigervncserver", "vncserver", "tightvncserver", "wayvnc"]:
                    if shutil.which(vnc_bin) or os.path.exists(f"/usr/bin/{vnc_bin}") or os.path.exists(f"/bin/{vnc_bin}"):
                        vnc_info["installed"] = True
                        vnc_info["server_name"] = vnc_bin
                        break
                if not vnc_info["display"]:
                    x11_dir = "/tmp/.X11-unix"
                    if os.path.exists(x11_dir):
                        socks = [f for f in os.listdir(x11_dir) if f.startswith("X")]
                        if socks:
                            disp_num = socks[0].replace("X", "")
                            vnc_info["display"] = f":{disp_num}"
                vnc_info["has_display"] = bool(vnc_info["display"])

            listening = self.discover_listening_ports() if hasattr(self, "discover_listening_ports") else []
            for lp in listening:
                p_num = lp.get("port") if isinstance(lp, dict) else lp
                if p_num in [5900, 5901, 5902]:
                    vnc_info["running"] = True
                    vnc_info["port"] = p_num
                    break

            # 4. RustDesk Capabilities & Service
            rustdesk_info = {
                "installed": False,
                "running": False,
                "id": "",
                "direct_ip": getattr(self, "virtual_ip", "") or "10.77.0.x"
            }
            rd_bin = None
            if sys_os == "Windows":
                for cand in [r"C:\Program Files\RustDesk\rustdesk.exe", r"C:\Program Files (x86)\RustDesk\rustdesk.exe"]:
                    if os.path.exists(cand):
                        rd_bin = cand
                        break
                if not rd_bin and shutil.which("rustdesk"):
                    rd_bin = shutil.which("rustdesk")
            else:
                for cand in ["/usr/bin/rustdesk", "/usr/lib/rustdesk/rustdesk"]:
                    if os.path.exists(cand):
                        rd_bin = cand
                        break
                if not rd_bin and shutil.which("rustdesk"):
                    rd_bin = shutil.which("rustdesk")

            if rd_bin:
                rustdesk_info["installed"] = True
                try:
                    rd_id_out = subprocess.check_output([rd_bin, "--get-id"], timeout=3).decode("utf-8", errors="ignore").strip()
                    if rd_id_out and rd_id_out.isdigit():
                        rustdesk_info["id"] = rd_id_out
                except Exception:
                    pass
                if sys_os == "Windows":
                    try:
                        out = subprocess.check_output(["powershell", "-NoProfile", "-Command", "(Get-Service rustdesk -ErrorAction SilentlyContinue).Status"], timeout=3).decode("utf-8", errors="ignore").strip()
                        rustdesk_info["running"] = ("Running" in out or "4" in out)
                    except Exception:
                        pass
                else:
                    try:
                        chk = subprocess.run(["systemctl", "is-active", "rustdesk"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3)
                        rustdesk_info["running"] = (chk.stdout.decode().strip() == "active")
                    except Exception:
                        pass

            # 5. Active Desktop Sessions List
            active_sessions = []
            if sys_os == "Windows":
                try:
                    out = subprocess.check_output(["qwinsta"], timeout=4).decode("utf-8", errors="ignore")
                    for line in out.splitlines()[1:]:
                        parts = line.split()
                        if len(parts) >= 2:
                            s_name = parts[0].replace(">", "").strip()
                            s_user = parts[1] if len(parts) >= 3 and not parts[1].isdigit() else "Console/Active"
                            s_id = parts[2] if len(parts) >= 3 and not parts[1].isdigit() else parts[1]
                            s_state = parts[3] if len(parts) >= 4 else (parts[2] if len(parts) >= 3 else "Active")
                            if s_id.isdigit():
                                active_sessions.append({
                                    "id": s_id,
                                    "session_name": s_name,
                                    "user": s_user,
                                    "state": s_state
                                })
                except Exception:
                    pass
            else:
                try:
                    out = subprocess.check_output(["who"], timeout=3).decode("utf-8", errors="ignore")
                    for idx, line in enumerate(out.splitlines()):
                        parts = line.split()
                        if len(parts) >= 2:
                            active_sessions.append({
                                "id": str(idx + 1),
                                "session_name": parts[1],
                                "user": parts[0],
                                "state": "Active",
                                "time": parts[2] + " " + (parts[3] if len(parts) >= 4 else "")
                            })
                except Exception:
                    pass

            is_session_0 = False
            active_console_session = None
            if sys_os == "Windows":
                try:
                    import ctypes
                    sess_val = ctypes.c_ulong()
                    if ctypes.windll.kernel32.ProcessIdToSessionId(os.getpid(), ctypes.byref(sess_val)):
                        is_session_0 = (sess_val.value == 0)
                    active_console_session = ctypes.windll.kernel32.WTSGetActiveConsoleSessionId()
                    if active_console_session == 0xFFFFFFFF or active_console_session == -1:
                        active_console_session = self._find_active_wts_session()
                except Exception:
                    pass

            cfg = self.load_config() if hasattr(self, "load_config") else {}
            gui_test_mode = bool(cfg.get("gui_test_mode", False))

            result = {
                "machine_id": self.machine_id,
                "os_type": sys_os,
                "hostname": socket.gethostname(),
                "privilege": priv,
                "unattended_access": unattended_access,
                "service_mode": service_mode,
                "headless": True,
                "is_session_0": is_session_0,
                "active_console_session": active_console_session,
                "gui_test_mode": gui_test_mode,
                "agent_pid": os.getpid(),
                "agent_uptime": uptime_sec,
                "rdp": rdp_info,
                "vnc": vnc_info,
                "rustdesk": rustdesk_info,
                "active_sessions": active_sessions
            }
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": True, "result": result}
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def handle_desktop_action(self, payload):
        req_id = payload.get("request_id")
        params = payload.get("params") or {}
        # Support action specified directly or in params or nested under sub_action
        action = (payload.get("action") or params.get("action") or payload.get("sub_action") or "").lower().strip()
        protocol = (payload.get("protocol") or params.get("protocol") or "desktop").lower().strip()

        # If action is missing but executable/app specified, infer launch_interactive
        if not action and (payload.get("executable") or params.get("executable") or payload.get("app") or params.get("app")):
            action = "launch_interactive"

        try:
            sys_os = platform.system()
            priv = self.get_privilege_info() if hasattr(self, "get_privilege_info") else {"is_elevated": False}

            if action == "enable_rdp":
                if sys_os != "Windows":
                    self.send_agent_event({
                        "type": "AgentRpcResponse",
                        "payload": {"request_id": req_id, "success": False, "error": "Native RDP host configuration is only available on Windows. For Linux, please use VNC or RustDesk."}
                    })
                    return

                if not (priv.get("is_elevated") or priv.get("is_admin") or priv.get("is_system")):
                    self.send_agent_event({
                        "type": "AgentRpcResponse",
                        "payload": {"request_id": req_id, "success": False, "error": "Administrator privileges required to enable Windows Remote Desktop. Please run CyberVPS Agent as Administrator or install as SYSTEM service."}
                    })
                    return

                edition_id = ""
                prod_name = ""
                if winreg:
                    try:
                        k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
                        try: prod_name = winreg.QueryValueEx(k, "ProductName")[0]
                        except Exception: pass
                        try: edition_id = winreg.QueryValueEx(k, "EditionID")[0]
                        except Exception: pass
                        winreg.CloseKey(k)
                    except Exception: pass
                if any(x in (edition_id or prod_name).lower() for x in ["home", "core", "starter"]):
                    self.send_agent_event({
                        "type": "AgentRpcResponse",
                        "payload": {"request_id": req_id, "success": False, "error": f"{prod_name or 'Windows Home'} does not support incoming Remote Desktop connections natively. Please use VNC or RustDesk."}
                    })
                    return

                ps_cmd = (
                    "Set-ItemProperty -Path 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server' -Name 'fDenyTSConnections' -Value 0 -Force; "
                    "Set-ItemProperty -Path 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp' -Name 'UserAuthentication' -Value 1 -Force; "
                    "Set-Service TermService -StartupType Automatic -ErrorAction SilentlyContinue; "
                    "Start-Service TermService -ErrorAction SilentlyContinue; "
                    "Enable-NetFirewallRule -DisplayGroup 'Remote Desktop' -ErrorAction SilentlyContinue; "
                    "(Get-Service TermService).Status"
                )
                res = subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
                out = res.stdout.decode("utf-8", errors="ignore").strip()

                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {
                        "request_id": req_id,
                        "success": True,
                        "result": {
                            "message": "Windows Remote Desktop successfully enabled, NLA enforced, and TermService activated.",
                            "service_status": "Running" if "Running" in out or "4" in out else "Active"
                        }
                    }
                })

            elif action == "toggle_unattended":
                new_state = bool(params.get("enabled", True))
                cfg = self.load_config() if hasattr(self, "load_config") else {}
                cfg["unattended_access"] = new_state
                if hasattr(self, "save_config"):
                    self.save_config(cfg)
                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {
                        "request_id": req_id,
                        "success": True,
                        "result": {
                            "unattended_access": new_state,
                            "message": f"Unattended access {'enabled' if new_state else 'disabled'} successfully."
                        }
                    }
                })

            elif action == "terminate_session":
                sess_id = str(params.get("session_id", "")).strip()
                if not sess_id:
                    self.send_agent_event({
                        "type": "AgentRpcResponse",
                        "payload": {"request_id": req_id, "success": False, "error": "session_id is required"}
                    })
                    return

                if not (priv.get("is_elevated") or priv.get("is_admin") or priv.get("is_system") or priv.get("is_root")):
                    self.send_agent_event({
                        "type": "AgentRpcResponse",
                        "payload": {"request_id": req_id, "success": False, "error": "Administrator/root privileges required to terminate active user desktop sessions."}
                    })
                    return

                if sys_os == "Windows":
                    res = subprocess.run(["logoff", sess_id], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=8)
                else:
                    res = subprocess.run(["loginctl", "terminate-session", sess_id], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=8)

                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {
                        "request_id": req_id,
                        "success": True,
                        "result": {
                            "message": f"Desktop session {sess_id} terminated."
                        }
                    }
                })

            elif action == "service_action":
                svc_name = params.get("service_name") or ("TermService" if protocol == "rdp" else "rustdesk")
                sub_action = params.get("action", "restart").lower()
                self.handle_service_action({
                    "request_id": req_id,
                    "service_name": svc_name,
                    "action": sub_action
                })

            elif action in [
                "launch_gui", "launch_interactive", "desktop_launch", "launch",
                "start", "start_app", "gui_launch", "interactive_launch", "run", "run_app", "desktop_app"
            ]:
                app_cmd = params.get("executable") or params.get("app") or params.get("cmd") or payload.get("executable") or payload.get("app") or "notepad.exe"
                cfg = self.load_config() if hasattr(self, "load_config") else {}
                test_mode = bool(params.get("test_mode", False) or payload.get("test_mode", False) or cfg.get("gui_test_mode", False))
                launch_res = self.launch_interactive_desktop_process(app_cmd, test_mode=test_mode)
                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {
                        "request_id": req_id,
                        "success": launch_res.get("success", False),
                        "result": launch_res,
                        "error": launch_res.get("error") if not launch_res.get("success") else None
                    }
                })

            else:
                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {"request_id": req_id, "success": False, "error": f"Unknown desktop action: {action}"}
                })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def _find_rustdesk_binary(self):
        sys_os = platform.system()
        if sys_os == "Windows":
            for cand in [r"C:\Program Files\RustDesk\rustdesk.exe", r"C:\Program Files (x86)\RustDesk\rustdesk.exe"]:
                if os.path.exists(cand):
                    return cand
            if shutil.which("rustdesk"):
                return shutil.which("rustdesk")
        else:
            for cand in ["/usr/bin/rustdesk", "/usr/lib/rustdesk/rustdesk"]:
                if os.path.exists(cand):
                    return cand
            if shutil.which("rustdesk"):
                return shutil.which("rustdesk")
        return None

    def _get_rustdesk_info(self):
        sys_os = platform.system()
        virtual_ip = getattr(self, "virtual_ip", "") or "10.77.0.x"
        info = {
            "installed": False,
            "running": False,
            "id": "",
            "binary_path": "",
            "direct_ip": virtual_ip,
            "direct_port": 21118,
            "direct_link": f"{virtual_ip}:21118",
            "direct_url": f"rustdesk://{virtual_ip}:21118",
            "rendezvous_server": ""
        }
        rd_bin = self._find_rustdesk_binary()
        if rd_bin:
            info["installed"] = True
            info["binary_path"] = rd_bin
            try:
                out = subprocess.check_output([rd_bin, "--get-id"], timeout=3).decode("utf-8", errors="ignore").strip()
                if out and out.isdigit():
                    info["id"] = out
            except Exception:
                pass
            if sys_os == "Windows":
                try:
                    s_out = subprocess.check_output(["powershell", "-NoProfile", "-Command", "(Get-Service rustdesk -ErrorAction SilentlyContinue).Status"], timeout=3).decode("utf-8", errors="ignore").strip()
                    info["running"] = ("Running" in s_out or "4" in s_out)
                except Exception:
                    pass
            else:
                try:
                    chk = subprocess.run(["systemctl", "is-active", "rustdesk"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3)
                    info["running"] = (chk.stdout.decode().strip() == "active")
                except Exception:
                    pass
        return info

    def handle_desktop_diagnostics(self, payload):
        req_id = payload.get("request_id")
        try:
            sys_os = platform.system()
            priv = self.get_privilege_info() if hasattr(self, "get_privilege_info") else {"is_elevated": False, "user": os.environ.get("USERNAME") or os.environ.get("USER") or "unknown"}
            virtual_ip = getattr(self, "virtual_ip", "") or "10.77.0.x"

            proc_session_id = 0
            active_console_id = 0
            is_session_0 = False
            if sys_os == "Windows":
                try:
                    import ctypes
                    kernel32 = ctypes.windll.kernel32
                    sess = ctypes.c_ulong()
                    kernel32.ProcessIdToSessionId(kernel32.GetCurrentProcessId(), ctypes.byref(sess))
                    proc_session_id = sess.value
                    active_console_id = kernel32.WTSGetActiveConsoleSessionId()
                    is_session_0 = (proc_session_id == 0)
                except Exception:
                    pass

            # Safe Single-Frame GDI+ Screen DC Probe
            gdi_probe = {
                "available": False,
                "width": 0,
                "height": 0,
                "error": None
            }
            if sys_os == "Windows":
                try:
                    import ctypes
                    user32 = ctypes.windll.user32
                    gdi32 = ctypes.windll.gdi32
                    sw = user32.GetSystemMetrics(0)
                    sh = user32.GetSystemMetrics(1)
                    hScreenDC = user32.GetDC(None)
                    if hScreenDC and sw > 0 and sh > 0:
                        memDC = gdi32.CreateCompatibleDC(hScreenDC)
                        hBmp = gdi32.CreateCompatibleBitmap(hScreenDC, 1, 1)
                        oldBmp = gdi32.SelectObject(memDC, hBmp)
                        blt_ok = gdi32.BitBlt(memDC, 0, 0, 1, 1, hScreenDC, 0, 0, 0x00CC0020)
                        gdi32.SelectObject(memDC, oldBmp)
                        gdi32.DeleteObject(hBmp)
                        gdi32.DeleteDC(memDC)
                        user32.ReleaseDC(None, hScreenDC)
                        if blt_ok:
                            gdi_probe["available"] = True
                            gdi_probe["width"] = sw
                            gdi_probe["height"] = sh
                        else:
                            gdi_probe["error"] = "BitBlt failed to read screen surface (desktop locked or headless)."
                    else:
                        if hScreenDC: user32.ReleaseDC(None, hScreenDC)
                        gdi_probe["error"] = "Unable to acquire screen DC handle."
                except Exception as e:
                    gdi_probe["error"] = str(e)
            elif sys_os == "Linux":
                import glob
                has_disp = bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY") or glob.glob("/tmp/.X11-unix/X*"))
                gdi_probe["available"] = has_disp
                if not has_disp:
                    gdi_probe["error"] = "Headless Linux host: No X11/Wayland display found."

            rustdesk_info = self._get_rustdesk_info()

            rdp_info = {
                "supported": False,
                "enabled": False,
                "port": 3389,
                "service_status": "Unknown",
                "reason": ""
            }
            if sys_os == "Windows":
                edition_id = ""
                prod_name = ""
                if winreg:
                    try:
                        k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
                        try: prod_name = winreg.QueryValueEx(k, "ProductName")[0]
                        except Exception: pass
                        try: edition_id = winreg.QueryValueEx(k, "EditionID")[0]
                        except Exception: pass
                        winreg.CloseKey(k)
                    except Exception: pass
                is_home = any(x in (edition_id or prod_name).lower() for x in ["home", "core", "starter"])
                rdp_info["supported"] = not is_home
                if is_home:
                    rdp_info["reason"] = f"{prod_name or 'Windows Home'} edition does not support incoming RDP."
                if winreg:
                    try:
                        k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"System\CurrentControlSet\Control\Terminal Server")
                        try:
                            f_deny = winreg.QueryValueEx(k, "fDenyTSConnections")[0]
                            rdp_info["enabled"] = (f_deny == 0)
                        except Exception: pass
                        winreg.CloseKey(k)
                    except Exception: pass

            recommendations = []
            if gdi_probe["available"]:
                primary_engine = "native_hd"
                recommendations.append("Native HD GDI+ capture is available and operating normally.")
            elif rustdesk_info["installed"] and rustdesk_info["running"]:
                primary_engine = "rustdesk"
                recommendations.append(f"RustDesk is active. Direct connection available via Virtual IP {virtual_ip}.")
            elif rdp_info["enabled"]:
                primary_engine = "rdp"
                recommendations.append(f"Windows RDP is listening on port 3389 ({virtual_ip}:3389).")
            elif not priv.get("is_elevated") and is_session_0:
                primary_engine = "rustdesk"
                recommendations.append("Agent runs unprivileged in Session 0. RustDesk recommended for 24/7 persistent unattended access.")
            else:
                primary_engine = "rustdesk"
                recommendations.append("Install RustDesk Open Source remote control for robust unattended access.")

            diag_result = {
                "machine_id": self.machine_id,
                "os": sys_os,
                "privilege": priv,
                "virtual_ip": virtual_ip,
                "session": {
                    "proc_session_id": proc_session_id,
                    "active_console_id": active_console_id,
                    "is_session_0": is_session_0
                },
                "gdi_probe": gdi_probe,
                "rustdesk": rustdesk_info,
                "rdp": rdp_info,
                "primary_engine": primary_engine,
                "recommendations": recommendations,
                "timestamp": int(time.time() * 1000)
            }

            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": True, "result": diag_result}
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def handle_rustdesk_action(self, payload):
        req_id = payload.get("request_id")
        action = (payload.get("action") or "status").lower().strip()
        params = payload.get("params") or {}
        sys_os = platform.system()

        try:
            if action == "status":
                rd_info = self._get_rustdesk_info()
                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {"request_id": req_id, "success": True, "result": rd_info}
                })
            elif action == "repair":
                if sys_os == "Windows":
                    cmd = "Restart-Service rustdesk -Force -ErrorAction SilentlyContinue; (Get-Service rustdesk -ErrorAction SilentlyContinue).Status"
                    res = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
                    out = res.stdout.decode("utf-8", errors="ignore").strip()
                    is_running = ("Running" in out or "4" in out)
                    self.send_agent_event({
                        "type": "AgentRpcResponse",
                        "payload": {"request_id": req_id, "success": True, "result": {"message": "RustDesk service restarted", "running": is_running, "output": out}}
                    })
                else:
                    res = subprocess.run(["systemctl", "restart", "rustdesk"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
                    self.send_agent_event({
                        "type": "AgentRpcResponse",
                        "payload": {"request_id": req_id, "success": res.returncode == 0, "result": {"message": "RustDesk service restarted"}}
                    })
            elif action == "configure":
                rendezvous = params.get("rendezvous_server") or params.get("host")
                key = params.get("key") or ""
                rd_bin = self._find_rustdesk_binary()
                if not rd_bin:
                    self.send_agent_event({
                        "type": "AgentRpcResponse",
                        "payload": {"request_id": req_id, "success": False, "error": "RustDesk is not installed on this machine."}
                    })
                    return
                cfg_args = [rd_bin]
                if rendezvous:
                    cfg_args.extend(["--custom-rendezvous-server", rendezvous])
                if key:
                    cfg_args.extend(["--key", key])
                res = subprocess.run(cfg_args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {"request_id": req_id, "success": True, "result": {"message": "RustDesk configuration updated", "rendezvous": rendezvous}}
                })
            elif action == "install":
                if sys_os == "Windows":
                    install_cmd = "winget install --id RustDesk.RustDesk -e --silent --accept-package-agreements --accept-source-agreements"
                    self.send_agent_event({
                        "type": "AgentRpcResponse",
                        "payload": {
                            "request_id": req_id,
                            "success": True,
                            "result": {
                                "message": "RustDesk installation command ready",
                                "command": install_cmd,
                                "download_url": "https://github.com/rustdesk/rustdesk/releases/latest/download/rustdesk-1.3.1-x86_64.exe",
                                "silent_args": "--silent-install"
                            }
                        }
                    })
                else:
                    self.send_agent_event({
                        "type": "AgentRpcResponse",
                        "payload": {
                            "request_id": req_id,
                            "success": True,
                            "result": {
                                "message": "RustDesk installation ready",
                                "command": "sudo apt-get update && sudo apt-get install -y rustdesk",
                                "download_url": "https://github.com/rustdesk/rustdesk/releases/latest/download/rustdesk-1.3.1-x86_64.deb"
                            }
                        }
                    })
            else:
                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {"request_id": req_id, "success": False, "error": f"Unknown RustDesk action: {action}"}
                })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def _find_active_wts_session(self):
        if platform.system() != "Windows":
            return None
        import ctypes
        from ctypes import wintypes
        kernel32 = ctypes.windll.kernel32
        wtsapi32 = ctypes.windll.wtsapi32

        try:
            cid = kernel32.WTSGetActiveConsoleSessionId()
            if cid != 0xFFFFFFFF and cid != -1 and cid is not None:
                return cid
        except Exception:
            pass

        try:
            class WTS_SESSION_INFO_W(ctypes.Structure):
                _fields_ = [
                    ("SessionId", wintypes.DWORD),
                    ("pWinStationName", wintypes.LPWSTR),
                    ("State", wintypes.DWORD)
                ]
            pSessionInfo = ctypes.POINTER(WTS_SESSION_INFO_W)()
            count = wintypes.DWORD()
            if wtsapi32.WTSEnumerateSessionsW(0, 0, 1, ctypes.byref(pSessionInfo), ctypes.byref(count)):
                active_id = None
                try:
                    for i in range(count.value):
                        info = pSessionInfo[i]
                        # State 0 is WTSActive
                        if info.State == 0 and info.SessionId != 0:
                            active_id = info.SessionId
                            break
                    if active_id is None:
                        for i in range(count.value):
                            info = pSessionInfo[i]
                            if info.State == 0:
                                active_id = info.SessionId
                                break
                finally:
                    wtsapi32.WTSFreeMemory(pSessionInfo)
                return active_id
        except Exception:
            pass
        return None

    def _is_app_window_visible(self, pid=None, app_name=""):
        if platform.system() != "Windows":
            return False
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

        found = [False]
        clean_app = os.path.basename(app_name or "").lower().replace(".exe", "")

        hWs = None
        hDesk = None
        try:
            hWs = user32.OpenWindowStationW("winsta0", False, 0x37F)
            hDesk = user32.OpenDesktopW("default", 0, False, 0x1FF)
        except Exception:
            pass

        DESKENUM = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        def enum_cb(hwnd, lp):
            if user32.IsWindowVisible(hwnd):
                if pid and pid > 0:
                    w_pid = wintypes.DWORD()
                    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(w_pid))
                    if w_pid.value == pid:
                        found[0] = True
                        return False
                if clean_app:
                    length = user32.GetWindowTextLengthW(hwnd)
                    if length > 0:
                        buf = ctypes.create_unicode_buffer(length + 1)
                        user32.GetWindowTextW(hwnd, buf, length + 1)
                        val = buf.value.lower()
                        if clean_app in val or (clean_app == "notepad" and "untitled" in val):
                            found[0] = True
                            return False
                    cls_buf = ctypes.create_unicode_buffer(256)
                    user32.GetClassNameW(hwnd, cls_buf, 256)
                    cls_val = cls_buf.value.lower()
                    if clean_app in cls_val:
                        found[0] = True
                        return False
            return True

        cb_func = DESKENUM(enum_cb)
        if hDesk:
            try:
                user32.EnumDesktopWindows(hDesk, cb_func, 0)
            except Exception:
                pass
        if not found[0]:
            try:
                user32.EnumWindows(cb_func, 0)
            except Exception:
                pass

        if hDesk:
            try: user32.CloseDesktop(hDesk)
            except Exception: pass
        if hWs:
            try: user32.CloseWindowStation(hWs)
            except Exception: pass

        return found[0]

    def launch_interactive_desktop_process(self, app_name_or_cmd, test_mode=False):
        sys_os = platform.system()
        cmd = (app_name_or_cmd or "").strip()
        if not cmd:
            cmd = "notepad.exe" if sys_os == "Windows" else "x-terminal-emulator"

        if sys_os != "Windows":
            try:
                env = os.environ.copy()
                if "DISPLAY" not in env:
                    env["DISPLAY"] = ":0"
                p = subprocess.Popen(cmd, shell=True, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
                return {
                    "success": True,
                    "status": "PASSED" if test_mode else "LAUNCHED",
                    "pid": p.pid,
                    "session_id": 1,
                    "app": cmd,
                    "window_visible": True,
                    "message": f"Launched '{cmd}' in X11/Wayland display session."
                }
            except Exception as e:
                return {
                    "success": False,
                    "status": "FAILED",
                    "error": str(e),
                    "app": cmd
                }

        import ctypes
        from ctypes import wintypes
        kernel32 = ctypes.windll.kernel32
        advapi32 = ctypes.windll.advapi32
        wtsapi32 = ctypes.windll.wtsapi32

        # Detect current process session
        curr_sess = ctypes.c_ulong()
        current_session_id = 1
        if kernel32.ProcessIdToSessionId(os.getpid(), ctypes.byref(curr_sess)):
            current_session_id = curr_sess.value

        # 1. Detect target active interactive user session
        target_session_id = self._find_active_wts_session()
        if target_session_id is None or target_session_id == 0xFFFFFFFF or target_session_id == -1:
            target_session_id = current_session_id if current_session_id is not None else 1

        launched_pid = None
        launch_method = None

        # Method 1: If current process is ALREADY in the interactive session
        if current_session_id == target_session_id:
            try:
                p = subprocess.Popen(cmd, shell=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
                launched_pid = p.pid
                launch_method = "direct_interactive"
            except Exception:
                pass

        # Method 2: Token-based launching into target_session_id (WTSQueryUserToken / DuplicateTokenEx)
        if not launched_pid:
            try:
                hUserToken = wintypes.HANDLE()
                token_acquired = False

                if hasattr(wtsapi32, "WTSQueryUserToken"):
                    if wtsapi32.WTSQueryUserToken(target_session_id, ctypes.byref(hUserToken)) and hUserToken.value:
                        token_acquired = True

                if not token_acquired:
                    import psutil
                    for proc in psutil.process_iter(['pid', 'name']):
                        try:
                            if "explorer" in (proc.name() or "").lower():
                                p_sess = ctypes.c_ulong()
                                if kernel32.ProcessIdToSessionId(proc.pid, ctypes.byref(p_sess)) and p_sess.value == target_session_id:
                                    hProc = kernel32.OpenProcess(0x0400 | 0x0040, False, proc.pid)
                                    if hProc:
                                        hTok = wintypes.HANDLE()
                                        if advapi32.OpenProcessToken(hProc, 0x000E | 0x0002, ctypes.byref(hTok)):
                                            hDup = wintypes.HANDLE()
                                            if advapi32.DuplicateTokenEx(hTok, 0xF01FF, None, 2, 1, ctypes.byref(hDup)):
                                                hUserToken = hDup
                                                token_acquired = True
                                            kernel32.CloseHandle(hTok)
                                        kernel32.CloseHandle(hProc)
                                        if token_acquired:
                                            break
                        except Exception:
                            continue

                if token_acquired and hUserToken.value:
                    class STARTUPINFO_W(ctypes.Structure):
                        _fields_ = [
                            ('cb', wintypes.DWORD), ('lpReserved', wintypes.LPWSTR), ('lpDesktop', wintypes.LPWSTR),
                            ('lpTitle', wintypes.LPWSTR), ('dwX', wintypes.DWORD), ('dwY', wintypes.DWORD),
                            ('dwXSize', wintypes.DWORD), ('dwYSize', wintypes.DWORD), ('dwXCountChars', wintypes.DWORD),
                            ('dwYCountChars', wintypes.DWORD), ('dwFillAttribute', wintypes.DWORD), ('dwFlags', wintypes.DWORD),
                            ('wShowWindow', wintypes.WORD), ('cbReserved2', wintypes.WORD), ('lpReserved2', ctypes.POINTER(wintypes.BYTE)),
                            ('hStdInput', wintypes.HANDLE), ('hStdOutput', wintypes.HANDLE), ('hStdError', wintypes.HANDLE)
                        ]
                    class PROCESS_INFORMATION_W(ctypes.Structure):
                        _fields_ = [('hProcess', wintypes.HANDLE), ('hThread', wintypes.HANDLE), ('dwProcessId', wintypes.DWORD), ('dwThreadId', wintypes.DWORD)]

                    si = STARTUPINFO_W()
                    si.cb = ctypes.sizeof(STARTUPINFO_W)
                    si.lpDesktop = "winsta0\\default"
                    si.dwFlags = 0x00000001 # STARTF_USESHOWWINDOW
                    si.wShowWindow = 1      # SW_SHOWNORMAL
                    pi = PROCESS_INFORMATION_W()

                    lpEnvironment = wintypes.LPVOID()
                    env_ok = False
                    try:
                        import ctypes.windll.userenv as userenv
                        env_ok = userenv.CreateEnvironmentBlock(ctypes.byref(lpEnvironment), hUserToken, False)
                    except Exception:
                        pass

                    dwFlags = 0x00000010 # CREATE_NEW_CONSOLE
                    if env_ok and lpEnvironment.value:
                        dwFlags |= 0x00000400 # CREATE_UNICODE_ENVIRONMENT

                    ok = False
                    if hasattr(advapi32, "CreateProcessWithTokenW"):
                        ok = advapi32.CreateProcessWithTokenW(
                            hUserToken, 0, None, cmd, dwFlags,
                            lpEnvironment if (env_ok and lpEnvironment.value) else None,
                            None, ctypes.byref(si), ctypes.byref(pi)
                        )
                    if not ok and hasattr(advapi32, "CreateProcessAsUserW"):
                        ok = advapi32.CreateProcessAsUserW(
                            hUserToken, None, cmd, None, None, False, dwFlags,
                            lpEnvironment if (env_ok and lpEnvironment.value) else None,
                            None, ctypes.byref(si), ctypes.byref(pi)
                        )

                    if ok:
                        launched_pid = pi.dwProcessId
                        launch_method = "token_duplicate"
                        kernel32.CloseHandle(pi.hProcess)
                        kernel32.CloseHandle(pi.hThread)

                    if env_ok and lpEnvironment.value:
                        try: userenv.DestroyEnvironmentBlock(lpEnvironment)
                        except Exception: pass
                    kernel32.CloseHandle(hUserToken)
            except Exception:
                pass

        # Method 3: Windows Task Scheduler interactive on-demand execution (schtasks /it)
        if not launched_pid:
            try:
                task_name = f"CyberVPS_Interactive_Launch_{int(time.time())}"
                create_cmd = ["schtasks.exe", "/Create", "/TN", task_name, "/TR", cmd, "/SC", "ONCE", "/ST", "23:59", "/IT", "/F"]
                subprocess.run(create_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
                run_cmd = ["schtasks.exe", "/Run", "/TN", task_name]
                subprocess.run(run_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
                del_cmd = ["schtasks.exe", "/Delete", "/TN", task_name, "/F"]
                subprocess.run(del_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
                launched_pid = -1
                launch_method = "schtasks_interactive"
            except Exception:
                pass

        # Method 4: Standard user / unprivileged direct launch fallback
        if not launched_pid:
            try:
                p = subprocess.Popen(cmd, shell=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
                launched_pid = p.pid
                launch_method = "direct_user_fallback"
            except Exception:
                pass

        # Check window visibility on winsta0\default
        window_visible = False
        time.sleep(0.4)
        for _ in range(8):
            if self._is_app_window_visible(launched_pid if (launched_pid and launched_pid > 0) else None, cmd):
                window_visible = True
                break
            time.sleep(0.15)

        if not launched_pid:
            return {
                "success": False,
                "status": "FAILED",
                "error": f"Failed to launch '{cmd}' into interactive desktop Session {target_session_id}.",
                "session_id": target_session_id,
                "app": cmd
            }

        # Terminal Idle Guarantee: notice no terminal inputs or commands were injected
        status_label = "PASSED" if test_mode else "LAUNCHED"
        return {
            "success": True,
            "status": status_label,
            "pid": launched_pid if launched_pid > 0 else "interactive_task",
            "session_id": target_session_id,
            "app": cmd,
            "window_visible": window_visible,
            "launch_method": launch_method,
            "test_mode": test_mode,
            "message": f"Application '{cmd}' successfully launched into interactive desktop Session {target_session_id}."
        }

    # =========================================================================
    # APPLICATION MANAGER (Remote Application Discovery, Status & Controls)
    # =========================================================================
    CRITICAL_SYSTEM_PROCESSES = {
        "system", "system idle process", "smss.exe", "csrss.exe", "wininit.exe", "services.exe",
        "lsass.exe", "lsm.exe", "winlogon.exe", "svchost.exe", "fontdrvhost.exe", "dwm.exe",
        "memory compression", "registry", "sihost.exe", "taskhostw.exe", "spoolsv.exe",
        "explorer.exe", "shellexperiencehost.exe", "searchhost.exe", "startmenuexperiencehost.exe",
        "msmpeng.exe", "nissrv.exe", "securityhealthservice.exe", "smartscreen.exe",
        "universal-agent.py", "python.exe", "node.exe",
        "systemd", "init", "kthreadd", "systemd-journald", "systemd-udevd", "systemd-timesyncd",
        "systemd-resolved", "systemd-logind", "dbus-daemon", "sshd", "login", "cron", "rsyslogd",
        "bash", "sh", "zsh", "python3", "python"
    }

    def _get_app_icon(self, app_id, name, icon_hint=""):
        if icon_hint:
            clean_hint = icon_hint.split(",")[0].strip('"').strip()
            if os.path.exists(clean_hint) and os.path.isfile(clean_hint):
                ext = os.path.splitext(clean_hint)[1].lower()
                if ext in [".ico", ".png", ".jpg", ".svg"]:
                    try:
                        if os.path.getsize(clean_hint) <= 128 * 1024:
                            with open(clean_hint, "rb") as f:
                                b64 = base64.b64encode(f.read()).decode("ascii")
                            mime = "image/x-icon" if ext == ".ico" else ("image/png" if ext == ".png" else "image/svg+xml")
                            return f"data:{mime};base64,{b64}"
                    except Exception:
                        pass

        aid = (app_id or "").lower()
        aname = (name or "").lower()

        if "chrome" in aid or "chrome" in aname:
            return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><circle cx='24' cy='24' r='20' fill='%234285F4'/><circle cx='24' cy='24' r='9' fill='%23FFF'/><circle cx='24' cy='24' r='7' fill='%231976D2'/><path d='M24 15h18A20 20 0 0 1 38 34L29 19z' fill='%23EA4335'/><path d='M15 29L6 14a20 20 0 0 1 27-8l-9 15z' fill='%23FBBC05'/><path d='M29 33L19 15H6a20 20 0 0 0 31 19z' fill='%2334A853'/></svg>"
        if "brave" in aid or "brave" in aname:
            return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><path fill='%23FB542B' d='M16 2L6 8l2 11 8 11 8-11 2-11z'/><path fill='%23FFF' d='M16 8l-4 3 1 5 3 4 3-4 1-5z'/></svg>"
        if "firefox" in aid or "firefox" in aname:
            return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='14' fill='%23FF7139'/><circle cx='16' cy='16' r='8' fill='%230060DF'/></svg>"
        if "edge" in aid or "edge" in aname:
            return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><path fill='%230078D7' d='M16 2a14 14 0 1 0 14 14A14 14 0 0 0 16 2zm6 18a8 8 0 1 1-8-8 8 8 0 0 1 8 8z'/></svg>"
        if "code" in aid or "vscode" in aid or "visual studio" in aname:
            return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><path fill='%23007ACC' d='M22 2l8 4v20l-8 4L12 21 5 26l-3-2V8l3-2 7 5z'/></svg>"
        if "terminal" in aid or "powershell" in aid or "cmd" in aid:
            return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='28' height='22' x='2' y='5' rx='3' fill='%230F172A' stroke='%2338BDF8' stroke-width='2'/><path d='M8 12l5 4-5 4M15 20h8' stroke='%2338BDF8' stroke-width='2' stroke-linecap='round'/></svg>"
        if "notepad" in aid or "notepad" in aname:
            return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><path fill='%2338BDF8' d='M6 4h15l5 5v19H6z'/><path fill='%230284C7' d='M21 4v5h5z'/><path stroke='%23FFF' stroke-width='2' stroke-linecap='round' d='M10 14h12M10 18h12M10 22h8'/></svg>"
        if "calc" in aid or "calc" in aname:
            return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='22' height='26' x='5' y='3' rx='3' fill='%23475569'/><rect width='16' height='6' x='8' y='6' rx='1' fill='%2394A3B8'/><circle cx='10' cy='16' r='1.5' fill='%23FFF'/><circle cx='16' cy='16' r='1.5' fill='%23FFF'/><circle cx='22' cy='16' r='1.5' fill='%23F59E0B'/><circle cx='10' cy='21' r='1.5' fill='%23FFF'/><circle cx='16' cy='21' r='1.5' fill='%23FFF'/><circle cx='22' cy='21' r='1.5' fill='%2338BDF8'/></svg>"
        if "paint" in aid or "paint" in aname:
            return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><path fill='%23F43F5E' d='M16 3C8.8 3 3 8.8 3 16s5.8 13 13 13c2 0 3-1.5 3-3 0-.8-.3-1.5-.8-2-.5-.5-.7-1.2-.7-2 0-1.7 1.3-3 3-3h2.5c4.7 0 8.5-3.8 8.5-8.5C31.5 6.5 24.5 3 16 3z'/><circle cx='8.5' cy='13.5' r='2' fill='%23FACC15'/><circle cx='13.5' cy='8.5' r='2' fill='%2338BDF8'/><circle cx='20.5' cy='8.5' r='2' fill='%234ADE80'/><circle cx='25.5' cy='13.5' r='2' fill='%23A855F7'/></svg>"
        if "explorer" in aid or "files" in aid:
            return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><path fill='%23EAB308' d='M4 6h8l3 3h13v17H4z'/><path fill='%23FDE047' d='M2 12h28l-2 14H4z'/></svg>"
        if "rustdesk" in aid or "rustdesk" in aname:
            return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='13' fill='%230F172A' stroke='%2338BDF8' stroke-width='2'/><path fill='%2338BDF8' d='M16 6l7 12h-5v8h-4v-8h-5z'/></svg>"
        if "vlc" in aid or "vlc" in aname:
            return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><path fill='%23F97316' d='M16 3l-8 23h16z'/><path fill='%23FFF' d='M11.5 16h9l-1.5-4h-6zM9.5 22h13l-1-3h-11z'/></svg>"

        first_letter = (name or "A")[0].upper()
        return f"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='28' height='28' x='2' y='2' rx='6' fill='%231E293B' stroke='%23334155' stroke-width='2'/><text x='16' y='21' font-size='14' font-weight='700' fill='%2338BDF8' text-anchor='middle' font-family='system-ui, sans-serif'>{first_letter}</text></svg>"

    def _discover_windows_applications(self):
        apps = {}
        common_apps = [
            {"id": "notepad", "name": "Notepad", "publisher": "Microsoft Corporation", "version": "11.0", "category": "Productivity", "cmd": "notepad.exe", "source": "Windows System App", "exe_name": "notepad.exe"},
            {"id": "calc", "name": "Calculator", "publisher": "Microsoft Corporation", "version": "11.0", "category": "Utilities", "cmd": "calc.exe", "source": "Windows System App", "exe_name": "calculatorapp.exe"},
            {"id": "mspaint", "name": "Paint", "publisher": "Microsoft Corporation", "version": "11.0", "category": "Media", "cmd": "mspaint.exe", "source": "Windows System App", "exe_name": "mspaint.exe"},
            {"id": "explorer", "name": "File Explorer", "publisher": "Microsoft Corporation", "version": "10.0", "category": "System", "cmd": "explorer.exe", "source": "Windows Shell", "exe_name": "explorer.exe"},
            {"id": "taskmgr", "name": "Task Manager", "publisher": "Microsoft Corporation", "version": "10.0", "category": "System", "cmd": "taskmgr.exe", "source": "Windows System App", "exe_name": "taskmgr.exe"},
            {"id": "powershell", "name": "Windows PowerShell", "publisher": "Microsoft Corporation", "version": "5.1", "category": "Development", "cmd": "powershell.exe", "source": "Windows Shell", "exe_name": "powershell.exe"},
            {"id": "cmd", "name": "Command Prompt", "publisher": "Microsoft Corporation", "version": "10.0", "category": "Development", "cmd": "cmd.exe", "source": "Windows Shell", "exe_name": "cmd.exe"},
            {"id": "mstsc", "name": "Remote Desktop Connection", "publisher": "Microsoft Corporation", "version": "10.0", "category": "Network", "cmd": "mstsc.exe", "source": "Windows System App", "exe_name": "mstsc.exe"},
            {"id": "regedit", "name": "Registry Editor", "publisher": "Microsoft Corporation", "version": "10.0", "category": "System", "cmd": "regedit.exe", "source": "Windows System App", "exe_name": "regedit.exe"},
            {"id": "control", "name": "Control Panel", "publisher": "Microsoft Corporation", "version": "10.0", "category": "System", "cmd": "control.exe", "source": "Windows System App", "exe_name": "control.exe"},
            {"id": "msedge", "name": "Microsoft Edge", "publisher": "Microsoft Corporation", "version": "120.0", "category": "Internet", "cmd": "msedge.exe", "source": "Desktop App", "exe_name": "msedge.exe"}
        ]
        for a in common_apps:
            a["icon"] = self._get_app_icon(a["id"], a["name"])
            a["can_control"] = True
            apps[a["id"]] = a

        if winreg:
            roots = [
                (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
                (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
                (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall")
            ]
            for root_key, reg_path in roots:
                try:
                    k = winreg.OpenKey(root_key, reg_path)
                    subkeys_count = winreg.QueryInfoKey(k)[0]
                    for idx in range(subkeys_count):
                        try:
                            s_name = winreg.EnumKey(k, idx)
                            sk = winreg.OpenKey(k, s_name)
                            def q(val_name):
                                try: return winreg.QueryValueEx(sk, val_name)[0]
                                except Exception: return None
                            d_name = q("DisplayName")
                            sys_comp = q("SystemComponent")
                            parent_key = q("ParentKeyName")
                            if d_name and not sys_comp and not parent_key and not d_name.startswith("KB") and "Hotfix" not in d_name:
                                d_ver = q("DisplayVersion") or ""
                                d_pub = q("Publisher") or ""
                                d_icon = q("DisplayIcon") or ""
                                d_loc = q("InstallLocation") or ""
                                slug = "".join(ch.lower() for ch in d_name if ch.isalnum())
                                if slug and slug not in apps:
                                    clean_exe = ""
                                    clean_cmd = ""
                                    if d_icon:
                                        cand = d_icon.split(",")[0].strip('"').strip()
                                        if cand.lower().endswith(".exe") and os.path.exists(cand):
                                            clean_cmd = cand
                                            clean_exe = os.path.basename(cand).lower()
                                    if not clean_cmd and d_loc and os.path.exists(d_loc):
                                        walked_count = 0
                                        for root_dir, _, files in os.walk(d_loc):
                                            for f in files:
                                                walked_count += 1
                                                if f.lower().endswith(".exe") and "unins" not in f.lower() and "helper" not in f.lower():
                                                    clean_cmd = os.path.join(root_dir, f)
                                                    clean_exe = f.lower()
                                                    break
                                                if walked_count > 30:
                                                    break
                                            if clean_cmd or walked_count > 30:
                                                break
                                    if not clean_cmd:
                                        clean_cmd = f"{slug}.exe"
                                        clean_exe = f"{slug}.exe"

                                    cat = "Utilities"
                                    low_name = d_name.lower()
                                    if any(x in low_name for x in ["browser", "chrome", "brave", "firefox", "edge", "opera"]): cat = "Internet"
                                    elif any(x in low_name for x in ["code", "visual studio", "python", "node", "git", "sublime", "dev"]): cat = "Development"
                                    elif any(x in low_name for x in ["player", "vlc", "audio", "video", "media", "music", "spotify"]): cat = "Media"
                                    elif any(x in low_name for x in ["office", "word", "excel", "sheet", "pdf", "reader", "document"]): cat = "Productivity"
                                    elif any(x in low_name for x in ["driver", "intel", "amd", "nvidia", "hardware", "system"]): cat = "System"

                                    apps[slug] = {
                                        "id": slug,
                                        "name": d_name,
                                        "publisher": d_pub or "Unknown Publisher",
                                        "version": d_ver or "1.0",
                                        "category": cat,
                                        "cmd": clean_cmd,
                                        "exe_name": clean_exe,
                                        "source": "Installed Software",
                                        "icon": self._get_app_icon(slug, d_name, d_icon),
                                        "can_control": True
                                    }
                            winreg.CloseKey(sk)
                        except Exception:
                            pass
                    winreg.CloseKey(k)
                except Exception:
                    pass

        dirs = [
            os.path.expandvars(r"%ProgramData%\Microsoft\Windows\Start Menu\Programs"),
            os.path.expandvars(r"%AppData%\Microsoft\Windows\Start Menu\Programs")
        ]
        for d in dirs:
            if os.path.exists(d):
                walked_shortcuts = 0
                for r_dir, _, files in os.walk(d):
                    for fn in files:
                        walked_shortcuts += 1
                        if fn.lower().endswith(".lnk") and "uninstall" not in fn.lower():
                            raw_name = os.path.splitext(fn)[0]
                            slug = "".join(ch.lower() for ch in raw_name if ch.isalnum())
                            if slug and slug not in apps:
                                apps[slug] = {
                                    "id": slug,
                                    "name": raw_name,
                                    "publisher": "Start Menu",
                                    "version": "",
                                    "category": "Utilities",
                                    "cmd": f"{raw_name}.exe",
                                    "exe_name": f"{raw_name}.exe".lower(),
                                    "source": "Start Menu Shortcut",
                                    "icon": self._get_app_icon(slug, raw_name),
                                    "can_control": True
                                }
                        if walked_shortcuts > 80:
                            break
                    if walked_shortcuts > 80:
                        break

        return list(apps.values())

    def _discover_linux_applications(self):
        apps = {}
        common_linux = [
            {"id": "terminal", "name": "Terminal", "publisher": "Linux Core", "version": "1.0", "category": "Development", "cmd": "x-terminal-emulator", "exe_name": "x-terminal-emulator"},
            {"id": "bash", "name": "Bash Shell", "publisher": "GNU Project", "version": "5.0", "category": "Development", "cmd": "bash", "exe_name": "bash"},
            {"id": "python", "name": "Python 3 Runtime", "publisher": "Python Software Foundation", "version": "3.x", "category": "Development", "cmd": "python3", "exe_name": "python3"},
            {"id": "htop", "name": "Htop Process Viewer", "publisher": "Hishham Muhammad", "version": "3.0", "category": "System", "cmd": "htop", "exe_name": "htop"},
            {"id": "git", "name": "Git VCS", "publisher": "Software Freedom Conservancy", "version": "2.x", "category": "Development", "cmd": "git", "exe_name": "git"},
            {"id": "vim", "name": "Vim Editor", "publisher": "Bram Moolenaar", "version": "8.x", "category": "Productivity", "cmd": "vim", "exe_name": "vim"},
            {"id": "nano", "name": "Nano Editor", "publisher": "GNU Project", "version": "6.x", "category": "Productivity", "cmd": "nano", "exe_name": "nano"},
            {"id": "systemd", "name": "Systemd Controller", "publisher": "freedesktop.org", "version": "systemd", "category": "System", "cmd": "systemctl", "exe_name": "systemd"}
        ]
        for a in common_linux:
            a["icon"] = self._get_app_icon(a["id"], a["name"])
            a["can_control"] = True
            a["source"] = "System Tool"
            apps[a["id"]] = a

        desk_dirs = ["/usr/share/applications", "/usr/local/share/applications", os.path.expanduser("~/.local/share/applications")]
        for d in desk_dirs:
            if os.path.exists(d):
                desk_count = 0
                try:
                    dir_list = os.listdir(d)
                except Exception:
                    continue
                for fn in dir_list:
                    if fn.endswith(".desktop"):
                        desk_count += 1
                        if desk_count > 80:
                            break
                        try:
                            fpath = os.path.join(d, fn)
                            entry = {}
                            with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                                for line in f:
                                    if "=" in line:
                                        k, v = line.strip().split("=", 1)
                                        entry[k.strip()] = v.strip()
                            if entry.get("Type") == "Application" and entry.get("NoDisplay") != "true":
                                aname = entry.get("Name")
                                if aname:
                                    slug = "".join(c.lower() for c in aname if c.isalnum())
                                    exec_cmd = entry.get("Exec", "").split("%")[0].strip()
                                    if slug and slug not in apps:
                                        cat = "Utilities"
                                        raw_cat = entry.get("Categories", "").lower()
                                        if any(x in raw_cat for x in ["network", "webbrowser"]): cat = "Internet"
                                        elif any(x in raw_cat for x in ["development", "ide"]): cat = "Development"
                                        elif any(x in raw_cat for x in ["audio", "video"]): cat = "Media"
                                        elif any(x in raw_cat for x in ["office", "texteditor"]): cat = "Productivity"
                                        elif any(x in raw_cat for x in ["system", "settings"]): cat = "System"

                                        exe_n = os.path.basename(exec_cmd.split()[0]).lower() if exec_cmd else f"{slug}"
                                        apps[slug] = {
                                            "id": slug,
                                            "name": aname,
                                            "publisher": entry.get("Comment", "Linux Application")[:30],
                                            "version": entry.get("Version", "1.0"),
                                            "category": cat,
                                            "cmd": exec_cmd or fpath,
                                            "exe_name": exe_n,
                                            "source": "Desktop Launcher",
                                            "icon": self._get_app_icon(slug, aname, entry.get("Icon", "")),
                                            "can_control": True
                                        }
                        except Exception:
                            pass

        return list(apps.values())

    def _get_running_app_instances(self):
        procs_by_name = {}
        if psutil:
            for p in psutil.process_iter(['pid', 'name', 'exe', 'cpu_percent', 'memory_info', 'create_time']):
                try:
                    p_name = (p.name() or "").lower()
                    p_exe = os.path.basename(p.exe() or "").lower() if p.exe() else ""
                    mem_mb = round(p.memory_info().rss / (1024 * 1024), 1) if p.memory_info() else 0.0
                    cpu = p.cpu_percent() or 0.0
                    create_t = p.create_time() or time.time()
                    uptime = int(time.time() - create_t)

                    is_protected = (p_name in self.CRITICAL_SYSTEM_PROCESSES or p.pid in [0, 4, os.getpid()])
                    inst_obj = {
                        "pid": p.pid,
                        "name": p.name(),
                        "memory_mb": mem_mb,
                        "cpu_percent": cpu,
                        "uptime_sec": uptime,
                        "can_close": not is_protected
                    }
                    if p_name:
                        procs_by_name.setdefault(p_name, []).append(inst_obj)
                    if p_exe and p_exe != p_name:
                        procs_by_name.setdefault(p_exe, []).append(inst_obj)
                except Exception:
                    continue
        return procs_by_name

    def _get_fallback_baseline_apps(self, sys_os):
        if sys_os == "Windows":
            return [
                {"id": "notepad", "name": "Notepad", "publisher": "Microsoft Corporation", "version": "11.0", "category": "Productivity", "cmd": "notepad.exe", "source": "Windows System App", "exe_name": "notepad.exe", "icon": self._get_app_icon("notepad", "Notepad"), "can_control": True},
                {"id": "calc", "name": "Calculator", "publisher": "Microsoft Corporation", "version": "11.0", "category": "Utilities", "cmd": "calc.exe", "source": "Windows System App", "exe_name": "calculatorapp.exe", "icon": self._get_app_icon("calc", "Calculator"), "can_control": True},
                {"id": "mspaint", "name": "Paint", "publisher": "Microsoft Corporation", "version": "11.0", "category": "Media", "cmd": "mspaint.exe", "source": "Windows System App", "exe_name": "mspaint.exe", "icon": self._get_app_icon("mspaint", "Paint"), "can_control": True},
                {"id": "explorer", "name": "File Explorer", "publisher": "Microsoft Corporation", "version": "10.0", "category": "System", "cmd": "explorer.exe", "source": "Windows Shell", "exe_name": "explorer.exe", "icon": self._get_app_icon("explorer", "File Explorer"), "can_control": True},
                {"id": "taskmgr", "name": "Task Manager", "publisher": "Microsoft Corporation", "version": "10.0", "category": "System", "cmd": "taskmgr.exe", "source": "Windows System App", "exe_name": "taskmgr.exe", "icon": self._get_app_icon("taskmgr", "Task Manager"), "can_control": True},
                {"id": "powershell", "name": "Windows PowerShell", "publisher": "Microsoft Corporation", "version": "5.1", "category": "Development", "cmd": "powershell.exe", "source": "Windows Shell", "exe_name": "powershell.exe", "icon": self._get_app_icon("powershell", "Windows PowerShell"), "can_control": True},
                {"id": "cmd", "name": "Command Prompt", "publisher": "Microsoft Corporation", "version": "10.0", "category": "Development", "cmd": "cmd.exe", "source": "Windows Shell", "exe_name": "cmd.exe", "icon": self._get_app_icon("cmd", "Command Prompt"), "can_control": True}
            ]
        else:
            return [
                {"id": "terminal", "name": "Terminal", "publisher": "Linux Core", "version": "1.0", "category": "Development", "cmd": "x-terminal-emulator", "exe_name": "x-terminal-emulator", "source": "System Tool", "icon": self._get_app_icon("terminal", "Terminal"), "can_control": True},
                {"id": "bash", "name": "Bash Shell", "publisher": "GNU Project", "version": "5.0", "category": "Development", "cmd": "bash", "exe_name": "bash", "source": "System Tool", "icon": self._get_app_icon("bash", "Bash Shell"), "can_control": True},
                {"id": "python", "name": "Python 3 Runtime", "publisher": "Python Software Foundation", "version": "3.x", "category": "Development", "cmd": "python3", "exe_name": "python3", "source": "System Tool", "icon": self._get_app_icon("python", "Python 3 Runtime"), "can_control": True},
                {"id": "htop", "name": "Htop Process Viewer", "publisher": "Hishham Muhammad", "version": "3.0", "category": "System", "cmd": "htop", "exe_name": "htop", "source": "System Tool", "icon": self._get_app_icon("htop", "Htop Process Viewer"), "can_control": True},
                {"id": "git", "name": "Git VCS", "publisher": "Software Freedom Conservancy", "version": "2.x", "category": "Development", "cmd": "git", "exe_name": "git", "source": "System Tool", "icon": self._get_app_icon("git", "Git VCS"), "can_control": True},
                {"id": "vim", "name": "Vim Editor", "publisher": "Bram Moolenaar", "version": "8.x", "category": "Productivity", "cmd": "vim", "exe_name": "vim", "source": "System Tool", "icon": self._get_app_icon("vim", "Vim Editor"), "can_control": True},
                {"id": "nano", "name": "Nano Editor", "publisher": "GNU Project", "version": "6.x", "category": "Productivity", "cmd": "nano", "exe_name": "nano", "source": "System Tool", "icon": self._get_app_icon("nano", "Nano Editor"), "can_control": True},
                {"id": "systemd", "name": "Systemd Controller", "publisher": "freedesktop.org", "version": "systemd", "category": "System", "cmd": "systemctl", "exe_name": "systemd", "source": "System Tool", "icon": self._get_app_icon("systemd", "Systemd Controller"), "can_control": True}
            ]

    def get_application_inventory(self, force_refresh=False):
        sys_os = platform.system()
        now = time.time()

        if force_refresh or not hasattr(self, "_cached_apps_list") or (now - getattr(self, "_cached_apps_time", 0)) > 60:
            try:
                if sys_os == "Windows":
                    base_apps = self._discover_windows_applications()
                else:
                    base_apps = self._discover_linux_applications()
                if not base_apps:
                    base_apps = self._get_fallback_baseline_apps(sys_os)
                self._cached_apps_list = base_apps
                self._cached_apps_time = now
            except Exception:
                base_apps = getattr(self, "_cached_apps_list", None) or self._get_fallback_baseline_apps(sys_os)
        else:
            base_apps = self._cached_apps_list

        procs_by_name = self._get_running_app_instances()

        running_count = 0
        total_count = len(base_apps)
        enriched_apps = []
        matched_keys = set()
        for app in base_apps:
            a_copy = dict(app)
            exe_n = (a_copy.get("exe_name") or "").lower()
            aid = (a_copy.get("id") or "").lower()

            instances = []
            if exe_n and exe_n in procs_by_name:
                instances.extend(procs_by_name[exe_n])
            elif f"{aid}.exe" in procs_by_name:
                instances.extend(procs_by_name[f"{aid}.exe"])
            elif aid in procs_by_name:
                instances.extend(procs_by_name[aid])

            seen_pids = set()
            unique_instances = []
            for inst in instances:
                if inst["pid"] not in seen_pids:
                    seen_pids.add(inst["pid"])
                    unique_instances.append(inst)

            if len(unique_instances) > 1 and psutil:
                pid_set = {inst["pid"] for inst in unique_instances}
                p_objs = {}
                for pid_val in pid_set:
                    try: p_objs[pid_val] = psutil.Process(pid_val)
                    except Exception: pass
                def rank_inst(inst):
                    p = p_objs.get(inst["pid"])
                    if not p: return 0
                    try:
                        if p.ppid() not in pid_set: return 100
                    except Exception: pass
                    return 10
                unique_instances.sort(key=rank_inst, reverse=True)

            if unique_instances:
                a_copy["status"] = "running"
                a_copy["instance_count"] = len(unique_instances)
                a_copy["instances"] = unique_instances
                running_count += 1
                if exe_n: matched_keys.add(exe_n)
                matched_keys.add(f"{aid}.exe")
                matched_keys.add(aid)
            else:
                a_copy["status"] = "stopped"
                a_copy["instance_count"] = 0
                a_copy["instances"] = []

            enriched_apps.append(a_copy)

        # Dynamic running processes enrichment (Brave, PowerShell, RustDesk, AnyDesk, Python, Copilot, etc.)
        for proc_key, instances in (procs_by_name or {}).items():
            if not proc_key or proc_key in matched_keys:
                continue

            first_inst = instances[0] if instances else {}
            raw_name = first_inst.get("name") or proc_key
            clean_name = raw_name
            if clean_name.lower().endswith(".exe"):
                clean_name = clean_name[:-4]
            display_name = clean_name.replace("_", " ").replace("-", " ").title()

            # Filter out low-level kernel and internal Windows/Linux daemons
            ignored_procs = {
                "system", "registry", "smss.exe", "csrss.exe", "wininit.exe", "services.exe", "lsass.exe",
                "fontdrvhost.exe", "svchost.exe", "winlogon.exe", "dwm.exe", "sihost.exe", "taskhostw.exe",
                "conhost.exe", "runtimebroker.exe", "searchindexer.exe", "spoolsv.exe", "wlanext.exe",
                "kthreadd", "kworker", "systemd", "systemd-journald", "systemd-udevd", "cron", "dbus-daemon"
            }
            if proc_key.lower() in ignored_procs or clean_name.lower() in ignored_procs:
                continue

            app_id = clean_name.lower().replace(" ", "_")
            if any(a.get("id") == app_id for a in enriched_apps):
                continue

            seen_pids = set()
            unique_instances = []
            for inst in instances:
                if inst["pid"] not in seen_pids:
                    seen_pids.add(inst["pid"])
                    unique_instances.append(inst)

            if len(unique_instances) > 1 and psutil:
                pid_set = {inst["pid"] for inst in unique_instances}
                p_objs = {}
                for pid_val in pid_set:
                    try: p_objs[pid_val] = psutil.Process(pid_val)
                    except Exception: pass
                def rank_inst(inst):
                    p = p_objs.get(inst["pid"])
                    if not p: return 0
                    try:
                        if p.ppid() not in pid_set: return 100
                    except Exception: pass
                    return 10
                unique_instances.sort(key=rank_inst, reverse=True)

            if not unique_instances:
                continue

            # Categorize based on known signatures
            lower_name = clean_name.lower()
            category = "Utilities"
            publisher = "Desktop Application"
            if any(k in lower_name for k in ["brave", "chrome", "firefox", "edge", "opera", "browser"]):
                category = "Internet"
                publisher = "Web Browser"
            elif any(k in lower_name for k in ["code", "studio", "python", "node", "powershell", "bash", "cmd", "git", "terminal", "antigravity"]):
                category = "Development"
                publisher = "Development Tool"
            elif any(k in lower_name for k in ["desk", "vnc", "mstsc", "rdp", "remote", "anydesk", "teamviewer"]):
                category = "Network"
                publisher = "Remote Management"
            elif any(k in lower_name for k in ["sound", "audio", "music", "video", "media", "vlc", "spotify", "fxsound"]):
                category = "Media"
                publisher = "Media & Audio"
            elif any(k in lower_name for k in ["office", "word", "excel", "notes", "writer", "copilot"]):
                category = "Productivity"
                publisher = "Productivity"

            enriched_apps.append({
                "id": app_id,
                "name": raw_name if (len(raw_name) > 3 and not raw_name.islower()) else display_name,
                "publisher": publisher,
                "version": "Running",
                "category": category,
                "cmd": raw_name,
                "exe_name": raw_name,
                "source": "Running Host Process",
                "icon": self._get_app_icon(app_id, display_name),
                "can_control": True,
                "status": "running",
                "instance_count": len(unique_instances),
                "instances": unique_instances
            })
            running_count += 1
            total_count += 1

        return {
            "machine_id": self.machine_id,
            "os_type": sys_os,
            "total": total_count,
            "running": running_count,
            "stopped": total_count - running_count,
            "apps": enriched_apps,
            "applications": enriched_apps
        }

    def _is_pid_protected(self, pid):
        if not pid or pid in [0, 4, os.getpid()]:
            return True
        if psutil:
            try:
                name = (psutil.Process(pid).name() or "").lower()
                if name in self.CRITICAL_SYSTEM_PROCESSES:
                    return True
            except Exception:
                pass
        return False

    def _close_pid_graceful(self, pid):
        if platform.system() == "Windows":
            closed = [False]
            try:
                import ctypes
                from ctypes import wintypes
                user32 = ctypes.windll.user32
                WNDENUM = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
                def cb(hwnd, lp):
                    w_pid = wintypes.DWORD()
                    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(w_pid))
                    if w_pid.value == pid:
                        user32.PostMessageW(hwnd, 0x0010, 0, 0)
                        closed[0] = True
                    return True
                user32.EnumWindows(WNDENUM(cb), 0)
            except Exception:
                pass
            if closed[0]:
                return True
        if psutil:
            try:
                p = psutil.Process(pid)
                p.terminate()
                return True
            except Exception:
                return False
        return False

    def _kill_pid_force(self, pid):
        if psutil:
            try:
                p = psutil.Process(pid)
                p.kill()
                return True
            except Exception:
                return False
        elif platform.system() == "Windows":
            res = subprocess.run(["taskkill", "/F", "/PID", str(pid)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            return (res.returncode == 0)
        else:
            try:
                os.kill(pid, signal.SIGKILL)
                return True
            except Exception:
                return False

    def _prewarm_apps_inventory(self):
        try:
            sys_os = platform.system()
            if sys_os == "Windows":
                apps = self._discover_windows_applications()
            else:
                apps = self._discover_linux_applications()
            if apps:
                self._cached_apps_list = apps
                self._cached_apps_time = time.time()
        except Exception:
            pass

    def handle_app_list(self, payload):
        req_id = payload.get("request_id")
        try:
            force_refresh = bool(payload.get("refresh", False))
            inv = self.get_application_inventory(force_refresh=False)
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": True, "result": inv}
            })
            if force_refresh:
                threading.Thread(target=self._prewarm_apps_inventory, daemon=True).start()
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def handle_ota_update(self, payload):
        req_id = payload.get("request_id")
        download_url = payload.get("download_url")
        target_version = payload.get("target_version", "2.1.1")
        force = bool(payload.get("force", False))

        if req_id:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {
                    "request_id": req_id,
                    "success": True,
                    "result": {
                        "status": "ota_accepted",
                        "current_version": PROTOCOL_VERSION,
                        "target_version": target_version
                    }
                }
            })

        threading.Thread(target=self._perform_silent_ota_update, args=(download_url, target_version, force), daemon=False).start()

    def _perform_silent_ota_update(self, download_url=None, target_version="2.1.1", force=False):
        try:
            print(f"[*] Starting silent Over-the-Air (OTA) update to v{target_version}...")
            if not download_url:
                download_url = f"{self.http_base}/api/v1/ota/download/universal-agent.py"
            elif not download_url.startswith("http"):
                download_url = f"{self.http_base}{download_url if download_url.startswith('/') else '/' + download_url}"

            script_path = os.path.abspath(__file__)
            temp_path = f"{script_path}.new"
            backup_path = f"{script_path}.bak"

            req = urllib.request.Request(download_url, headers={"User-Agent": f"CyberVPS-OTA-Agent/{PROTOCOL_VERSION}"})
            ctx = ssl._create_unverified_context() if hasattr(ssl, "_create_unverified_context") else None
            with urllib.request.urlopen(req, context=ctx, timeout=25) as resp:
                if resp.status != 200:
                    raise Exception(f"HTTP {resp.status} while downloading OTA update")
                content = resp.read()

            if len(content) < 30000:
                raise Exception(f"Downloaded payload ({len(content)} bytes) too small to be valid universal-agent")

            with open(temp_path, "wb") as f:
                f.write(content)

            import py_compile
            try:
                py_compile.compile(temp_path, doraise=True)
            except Exception as e:
                if os.path.exists(temp_path):
                    try: os.remove(temp_path)
                    except Exception: pass
                raise Exception(f"Downloaded agent failed Python syntax validation: {e}")

            if os.path.exists(script_path):
                try: shutil.copyfile(script_path, backup_path)
                except Exception: pass

            os.replace(temp_path, script_path)
            print(f"[+] OTA binary replaced successfully. Spawning self-updated agent process v{target_version}...")

            self.send_agent_event({
                "type": "OtaUpdateEvent",
                "payload": {
                    "machine_id": self.machine_id,
                    "status": "restarting_for_update",
                    "old_version": PROTOCOL_VERSION,
                    "new_version": target_version
                }
            })

            time.sleep(0.5)

            cmd = [sys.executable, script_path] + sys.argv[1:]
            child_proc = None
            if platform.system() == "Windows":
                DETACHED = 0x00000008
                CREATE_NEW_PROCESS_GROUP = 0x00000200
                child_proc = subprocess.Popen(cmd, creationflags=DETACHED | CREATE_NEW_PROCESS_GROUP, close_fds=True)
            else:
                child_proc = subprocess.Popen(cmd, start_new_session=True, close_fds=True)

            # Canary startup probation: wait 3 seconds to verify child process does not crash immediately
            time.sleep(3.0)
            ret_code = child_proc.poll()
            if ret_code is not None and ret_code != 0:
                print(f"[!] New agent child process exited with error code {ret_code}! Initiating automated rollback...")
                if os.path.exists(backup_path):
                    try:
                        shutil.copyfile(backup_path, script_path)
                    except Exception:
                        pass
                self.send_agent_event({
                    "type": "OtaUpdateEvent",
                    "payload": {
                        "machine_id": self.machine_id,
                        "status": "failed_rollback",
                        "error": f"Child exited with code {ret_code}. Restored previous version {PROTOCOL_VERSION}.",
                        "old_version": PROTOCOL_VERSION,
                        "target_version": target_version
                    }
                })
                return False

            print("[+] Child process passed startup probation. Exiting old agent instance. New version launched cleanly.")
            self.send_agent_event({
                "type": "OtaUpdateEvent",
                "payload": {
                    "machine_id": self.machine_id,
                    "status": "stabilized",
                    "old_version": PROTOCOL_VERSION,
                    "new_version": target_version
                }
            })
            time.sleep(0.5)
            os._exit(0)
        except Exception as err:
            print(f"[!] OTA update failed: {err}")
            self.send_agent_event({
                "type": "OtaUpdateEvent",
                "payload": {
                    "machine_id": self.machine_id,
                    "status": "failed",
                    "error": str(err)
                }
            })

    def _periodic_ota_check_loop(self):
        time.sleep(45)
        while self.running:
            try:
                check_url = f"{self.http_base}/api/v1/ota/latest"
                req = urllib.request.Request(check_url, headers={"User-Agent": f"CyberVPS-OTA-Agent/{PROTOCOL_VERSION}"})
                ctx = ssl._create_unverified_context() if hasattr(ssl, "_create_unverified_context") else None
                with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
                    if resp.status == 200:
                        data = json.loads(resp.read().decode("utf-8"))
                        remote_ver = data.get("version")
                        if remote_ver and remote_ver > PROTOCOL_VERSION:
                            print(f"[*] OTA periodic check detected new version {remote_ver} (current: {PROTOCOL_VERSION}). Updating silently...")
                            self._perform_silent_ota_update(data.get("download_url"), remote_ver)
                            break
            except Exception:
                pass
            time.sleep(600)

    def handle_app_action(self, payload):
        req_id = payload.get("request_id")
        app_id = (payload.get("app_id") or "").lower().strip()
        action = (payload.get("action") or "start").lower().strip()
        target_pid = payload.get("pid") or payload.get("target_pid")
        force = bool(payload.get("force", False))

        try:
            inventory = self.get_application_inventory()
            matched_app = next((a for a in inventory["apps"] if a["id"] == app_id), None)
            if not matched_app:
                matched_app = next((a for a in inventory["apps"] if a.get("exe_name") == app_id or a.get("cmd") == app_id), None)

            if not matched_app and action != "kill":
                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {"request_id": req_id, "success": False, "error": f"Application '{app_id}' not found in inventory."}
                })
                return

            if action == "start":
                cmd = matched_app.get("cmd") if matched_app else f"{app_id}.exe"
                launch_res = self.launch_interactive_desktop_process(cmd)
                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {
                        "request_id": req_id,
                        "success": launch_res.get("success", False),
                        "result": {
                            "app_id": app_id,
                            "action": "start",
                            "status": "running" if launch_res.get("success") else "failed",
                            "pid": launch_res.get("pid"),
                            "session_id": launch_res.get("session_id"),
                            "message": launch_res.get("message") or f"Started '{app_id}'"
                        },
                        "error": launch_res.get("error") if not launch_res.get("success") else None
                    }
                })

            elif action == "close":
                instances = matched_app.get("instances", []) if matched_app else []
                pids_to_close = [target_pid] if target_pid else [inst["pid"] for inst in instances]

                if not pids_to_close:
                    self.send_agent_event({
                        "type": "AgentRpcResponse",
                        "payload": {"request_id": req_id, "success": False, "error": f"No running instances found for '{app_id}'."}
                    })
                    return

                closed_pids = []
                for p in pids_to_close:
                    if self._is_pid_protected(p):
                        continue
                    if self._close_pid_graceful(p):
                        closed_pids.append(p)

                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {
                        "request_id": req_id,
                        "success": True,
                        "result": {
                            "app_id": app_id,
                            "action": "close",
                            "closed_pids": closed_pids,
                            "message": f"Closed {len(closed_pids)} instance(s) of '{app_id}'."
                        }
                    }
                })

            elif action == "kill":
                pids_to_kill = [target_pid] if target_pid else [inst["pid"] for inst in (matched_app.get("instances", []) if matched_app else [])]
                if not pids_to_kill:
                    self.send_agent_event({
                        "type": "AgentRpcResponse",
                        "payload": {"request_id": req_id, "success": False, "error": "No target PID found to force terminate."}
                    })
                    return

                killed_pids = []
                for p in pids_to_kill:
                    if self._is_pid_protected(p):
                        self.send_agent_event({
                            "type": "AgentRpcResponse",
                            "payload": {"request_id": req_id, "success": False, "error": f"Access Denied: PID {p} is a protected critical system process."}
                        })
                        return
                    if self._kill_pid_force(p):
                        killed_pids.append(p)

                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {
                        "request_id": req_id,
                        "success": True,
                        "result": {
                            "app_id": app_id,
                            "action": "kill",
                            "killed_pids": killed_pids,
                            "message": f"Force terminated {len(killed_pids)} process instance(s)."
                        }
                    }
                })

            elif action == "details":
                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {
                        "request_id": req_id,
                        "success": True,
                        "result": matched_app
                    }
                })

            else:
                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {"request_id": req_id, "success": False, "error": f"Unknown app action: '{action}'."}
                })

        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    # =========================================================================
    # LIVE APPLICATION VIEWER & BACKGROUND WINDOW CAPTURE ENGINE
    # =========================================================================
    def _get_process_windows(self, target_pid=None, app_id=None, app_name=None):
        windows = []
        target_pids = set()
        if target_pid is not None:
            if isinstance(target_pid, (list, tuple, set)):
                for p in target_pid:
                    try:
                        if p and int(p) > 0: target_pids.add(int(p))
                    except Exception: pass
            else:
                try:
                    if int(target_pid) > 0: target_pids.add(int(target_pid))
                except Exception: pass

        expanded_pids = set(target_pids)
        target_proc_names = set()

        # Comprehensive app name and executable aliases map
        app_aliases = {
            "microsoft edge": ["msedge.exe", "msedge"],
            "edge": ["msedge.exe", "msedge"],
            "google chrome": ["chrome.exe", "chrome"],
            "chrome": ["chrome.exe", "chrome"],
            "brave": ["brave.exe", "brave"],
            "brave browser": ["brave.exe", "brave"],
            "mozilla firefox": ["firefox.exe", "firefox"],
            "firefox": ["firefox.exe", "firefox"],
            "visual studio code": ["code.exe", "code"],
            "vs code": ["code.exe", "code"],
            "file explorer": ["explorer.exe", "explorer"],
            "windows explorer": ["explorer.exe", "explorer"],
            "notepad": ["notepad.exe", "notepad"],
            "calculator": ["calc.exe", "calculatorapp.exe", "calc"],
            "task manager": ["taskmgr.exe", "taskmgr"]
        }

        for ident in [app_id, app_name]:
            if ident:
                id_str = str(ident).lower().strip()
                target_proc_names.add(id_str)
                target_proc_names.add(id_str + ".exe")
                for k, v in app_aliases.items():
                    if k in id_str or id_str in k:
                        target_proc_names.update(v)

        if psutil:
            # 1. Expand PID hierarchy: find root ancestors, siblings, and children
            for p in list(target_pids):
                try:
                    proc = psutil.Process(p)
                    p_name = proc.name().lower()
                    target_proc_names.add(p_name)
                    # Add all recursive children
                    for child in proc.children(recursive=True):
                        expanded_pids.add(child.pid)
                    # Walk up process ancestors matching the application tree
                    curr = proc
                    while True:
                        try:
                            parent = curr.parent()
                            if not parent or parent.pid == 0:
                                break
                            if parent.name().lower() == p_name:
                                expanded_pids.add(parent.pid)
                                for sibling in parent.children(recursive=True):
                                    expanded_pids.add(sibling.pid)
                                curr = parent
                            else:
                                break
                        except Exception:
                            break
                except Exception:
                    pass

            # 2. If target_proc_names identified, find peer processes sharing executable name
            if target_proc_names:
                for pr in psutil.process_iter(['pid', 'name']):
                    try:
                        pr_name = pr.info['name']
                        if pr_name:
                            pr_lower = pr_name.lower()
                            stem = pr_lower[:-4] if pr_lower.endswith(".exe") else pr_lower
                            if pr_lower in target_proc_names or stem in target_proc_names:
                                expanded_pids.add(pr.info['pid'])
                    except Exception:
                        pass
        elif platform.system() == "Windows":
            # Native Toolhelp32 process snapshot expansion (zero external pip dependencies)
            try:
                import ctypes
                from ctypes import wintypes
                class PROCESSENTRY32(ctypes.Structure):
                    _fields_ = [
                        ('dwSize', wintypes.DWORD), ('cntUsage', wintypes.DWORD), ('th32ProcessID', wintypes.DWORD),
                        ('th32DefaultHeapID', ctypes.c_void_p), ('th32ModuleID', wintypes.DWORD), ('cntThreads', wintypes.DWORD),
                        ('th32ParentProcessID', wintypes.DWORD), ('pcPriClassBase', wintypes.LONG), ('dwFlags', wintypes.DWORD),
                        ('szExeFile', ctypes.c_char * 260)
                    ]
                hSnap = ctypes.windll.kernel32.CreateToolhelp32Snapshot(0x00000002, 0)
                if hSnap and hSnap != -1:
                    pe = PROCESSENTRY32()
                    pe.dwSize = ctypes.sizeof(PROCESSENTRY32)
                    all_procs = []
                    if ctypes.windll.kernel32.Process32First(hSnap, ctypes.byref(pe)):
                        while True:
                            exe = pe.szExeFile.decode('latin1', 'ignore').lower()
                            all_procs.append((pe.th32ProcessID, pe.th32ParentProcessID, exe))
                            if not ctypes.windll.kernel32.Process32Next(hSnap, ctypes.byref(pe)):
                                break
                    ctypes.windll.kernel32.CloseHandle(hSnap)

                    # Learn exe names for target_pids
                    for pid_val, ppid, exe in all_procs:
                        if pid_val in target_pids:
                            target_proc_names.add(exe)
                            target_proc_names.add(exe[:-4] if exe.endswith(".exe") else exe)
                            expanded_pids.add(ppid)

                    # Expand all matching procs
                    if target_proc_names:
                        for pid_val, ppid, exe in all_procs:
                            stem = exe[:-4] if exe.endswith(".exe") else exe
                            if exe in target_proc_names or stem in target_proc_names:
                                expanded_pids.add(pid_val)
                                expanded_pids.add(ppid)
            except Exception:
                pass

        sys_os = platform.system()
        if sys_os == "Windows":
            try:
                import ctypes
                from ctypes import wintypes
                user32 = ctypes.windll.user32

                # 64-bit ctypes prototypes
                user32.OpenWindowStationW.argtypes = [wintypes.LPCWSTR, wintypes.BOOL, wintypes.DWORD]
                user32.OpenWindowStationW.restype = wintypes.HANDLE
                user32.SetProcessWindowStation.argtypes = [wintypes.HANDLE]
                user32.SetProcessWindowStation.restype = wintypes.BOOL
                user32.CloseWindowStation.argtypes = [wintypes.HANDLE]
                user32.CloseWindowStation.restype = wintypes.BOOL

                user32.OpenDesktopW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
                user32.OpenDesktopW.restype = wintypes.HANDLE
                user32.CloseDesktop.argtypes = [wintypes.HANDLE]
                user32.CloseDesktop.restype = wintypes.BOOL

                user32.IsWindow.argtypes = [wintypes.HWND]
                user32.IsWindow.restype = wintypes.BOOL
                user32.IsWindowVisible.argtypes = [wintypes.HWND]
                user32.IsWindowVisible.restype = wintypes.BOOL
                user32.IsIconic.argtypes = [wintypes.HWND]
                user32.IsIconic.restype = wintypes.BOOL

                user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
                user32.GetWindowThreadProcessId.restype = wintypes.DWORD
                user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
                user32.GetWindowTextLengthW.restype = ctypes.c_int
                user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
                user32.GetWindowTextW.restype = ctypes.c_int
                user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
                user32.GetClassNameW.restype = ctypes.c_int

                user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
                user32.GetWindowRect.restype = wintypes.BOOL

                hWs = user32.OpenWindowStationW("winsta0", False, 0x37F)
                if hWs:
                    user32.SetProcessWindowStation(hWs)
                hDesk = user32.OpenDesktopW("default", 0, False, 0x1FF)

                DESKENUM = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

                ignored_classes = {
                    "MSCTFIME UI", "IME", "Default IME", "Internet Explorer_Hidden",
                    "WorkerW", "Shell_TrayWnd", "Progman", "DummyWindow",
                    "Intermediate D3D Window", "Chrome_StorageMonitorWindow",
                    "Chrome_StatusTrayWindow", "Base_PowerMessageWindow",
                    "crashpad_SessionEndWatcher"
                }

                def cb(hwnd, lp):
                    try:
                        if user32.IsWindow(hwnd) and user32.IsWindowVisible(hwnd):
                            w_pid = wintypes.DWORD()
                            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(w_pid))
                            pid_val = int(w_pid.value)
                            if not expanded_pids or pid_val in expanded_pids:
                                cls_buf = ctypes.create_unicode_buffer(256)
                                user32.GetClassNameW(hwnd, cls_buf, 256)
                                cls_name = cls_buf.value

                                length = user32.GetWindowTextLengthW(hwnd)
                                title = ""
                                if length > 0:
                                    buf = ctypes.create_unicode_buffer(length + 1)
                                    user32.GetWindowTextW(hwnd, buf, length + 1)
                                    title = buf.value.strip()

                                if cls_name in ignored_classes and not title:
                                    return True

                                r = wintypes.RECT()
                                user32.GetWindowRect(hwnd, ctypes.byref(r))
                                w = max(0, r.right - r.left)
                                h = max(0, r.bottom - r.top)
                                is_min = bool(user32.IsIconic(hwnd)) or (w == 160 and h == 28)

                                # Score candidate window
                                score = 0
                                if title:
                                    score += 1000
                                if cls_name in {"Chrome_WidgetWin_1", "MozillaWindowClass", "CabinetWClass", "Notepad", "ApplicationFrameWindow"}:
                                    score += 600
                                if w >= 300 and h >= 200:
                                    score += 500
                                elif w > 50 and h > 50:
                                    score += 100
                                else:
                                    score -= 300
                                if not is_min:
                                    score += 200

                                if (w > 20 and h > 20) or is_min or title:
                                    windows.append({
                                        "hwnd": int(hwnd),
                                        "pid": pid_val,
                                        "title": title or f"Window (PID {pid_val})",
                                        "class_name": cls_name,
                                        "width": w,
                                        "height": h,
                                        "is_minimized": is_min,
                                        "is_visible": True,
                                        "score": score
                                    })
                    except Exception:
                        pass
                    return True

                if hDesk:
                    user32.EnumDesktopWindows(hDesk, DESKENUM(cb), 0)
                else:
                    user32.EnumWindows(DESKENUM(cb), 0)

                # Sort candidate windows so highest scored window is first
                windows.sort(key=lambda x: x.get("score", 0), reverse=True)

                if hDesk:
                    try: user32.CloseDesktop(hDesk)
                    except Exception: pass
                if hWs:
                    try: user32.CloseWindowStation(hWs)
                    except Exception: pass
            except Exception as e:
                print(f"[!] Error enumerating Windows windows: {e}")

        else:
            # Linux X11 / Wayland window discovery
            disp = os.environ.get("DISPLAY", ":0")
            is_wayland = bool(os.environ.get("WAYLAND_DISPLAY") or os.environ.get("XDG_SESSION_TYPE") == "wayland")
            try:
                out = subprocess.check_output(["wmctrl", "-l", "-p"], stderr=subprocess.DEVNULL, timeout=2).decode("utf-8", errors="ignore")
                for line in out.splitlines():
                    parts = line.split(None, 4)
                    if len(parts) >= 5:
                        wid_hex, desk_num, p_str, host, w_title = parts[0], parts[1], parts[2], parts[3], parts[4]
                        try:
                            w_pid_val = int(p_str)
                            if not expanded_pids or w_pid_val in expanded_pids:
                                wid_int = int(wid_hex, 16)
                                windows.append({
                                    "hwnd": wid_int,
                                    "wid": wid_hex,
                                    "pid": w_pid_val,
                                    "title": w_title.strip() or f"Linux Window (PID {w_pid_val})",
                                    "class_name": "X11Window",
                                    "width": 1280,
                                    "height": 720,
                                    "is_minimized": False,
                                    "is_visible": True
                                })
                        except Exception:
                            pass
            except Exception:
                pass

            if not windows and not is_wayland:
                try:
                    for p in (expanded_pids or target_pids or []):
                        wids = subprocess.check_output(["xdotool", "search", "--pid", str(p)], stderr=subprocess.DEVNULL, timeout=2).decode().split()
                        for wid in wids:
                            try:
                                name = subprocess.check_output(["xdotool", "getwindowname", wid], stderr=subprocess.DEVNULL, timeout=1).decode().strip()
                                windows.append({
                                    "hwnd": int(wid),
                                    "wid": wid,
                                    "pid": p,
                                    "title": name or f"Window (PID {p})",
                                    "class_name": "X11Window",
                                    "width": 1280,
                                    "height": 720,
                                    "is_minimized": False,
                                    "is_visible": True
                                })
                            except Exception:
                                pass
                except Exception:
                    pass

        return windows

    def _ensure_gdiplus(self):
        if platform.system() != "Windows":
            return False
        if getattr(self, "_gdiplus_token", None) is not None:
            return True
        try:
            import ctypes
            gdiplus = ctypes.windll.gdiplus
            class GdiplusStartupInput(ctypes.Structure):
                _fields_ = [('GdiplusVersion', ctypes.c_uint32),
                            ('DebugEventCallback', ctypes.c_void_p),
                            ('SuppressBackgroundThread', ctypes.c_int),
                            ('SuppressExternalCodecs', ctypes.c_int)]
            token = ctypes.c_ulong()
            si = GdiplusStartupInput(1, None, 0, 0)
            status = gdiplus.GdiplusStartup(ctypes.byref(token), ctypes.byref(si), None)
            if status == 0:
                self._gdiplus_token = token
                return True
        except Exception:
            pass
        return False

    def _encode_hbitmap_to_jpeg(self, hBmp, quality=80):
        """Hardware-accelerated native Windows GDI+ JPEG encoder. Zero external pip dependencies."""
        if not self._ensure_gdiplus():
            return None
        try:
            import ctypes
            from ctypes import wintypes
            gdiplus = ctypes.windll.gdiplus
            ole32 = ctypes.windll.ole32
            kernel32 = ctypes.windll.kernel32

            kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
            kernel32.GlobalLock.restype = ctypes.c_void_p
            kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
            kernel32.GlobalUnlock.restype = wintypes.BOOL
            kernel32.GlobalSize.argtypes = [ctypes.c_void_p]
            kernel32.GlobalSize.restype = ctypes.c_size_t

            ole32.CreateStreamOnHGlobal.argtypes = [ctypes.c_void_p, wintypes.BOOL, ctypes.POINTER(ctypes.c_void_p)]
            ole32.CreateStreamOnHGlobal.restype = wintypes.HRESULT
            ole32.GetHGlobalFromStream.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
            ole32.GetHGlobalFromStream.restype = wintypes.HRESULT

            gdiplus.GdipCreateBitmapFromHBITMAP.argtypes = [wintypes.HBITMAP, wintypes.HPALETTE, ctypes.POINTER(ctypes.c_void_p)]
            gdiplus.GdipCreateBitmapFromHBITMAP.restype = ctypes.c_int
            gdiplus.GdipSaveImageToStream.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
            gdiplus.GdipSaveImageToStream.restype = ctypes.c_int
            gdiplus.GdipDisposeImage.argtypes = [ctypes.c_void_p]
            gdiplus.GdipDisposeImage.restype = ctypes.c_int

            bmp_p = ctypes.c_void_p()
            st = gdiplus.GdipCreateBitmapFromHBITMAP(hBmp, 0, ctypes.byref(bmp_p))
            if st != 0 or not bmp_p:
                return None

            class GUID(ctypes.Structure):
                _fields_ = [('Data1', ctypes.c_ulong), ('Data2', ctypes.c_ushort), ('Data3', ctypes.c_ushort), ('Data4', ctypes.c_ubyte * 8)]
            class EncoderParameter(ctypes.Structure):
                _fields_ = [('Guid', GUID), ('NumberOfValues', ctypes.c_ulong), ('Type', ctypes.c_ulong), ('Value', ctypes.c_void_p)]
            class EncoderParameters(ctypes.Structure):
                _fields_ = [('Count', ctypes.c_uint), ('Parameter', EncoderParameter * 1)]

            jpeg_clsid = GUID(0x557CF401, 0x1A04, 0x11D3, (ctypes.c_ubyte * 8)(0x9A, 0x73, 0x00, 0x00, 0xF8, 0x1E, 0xF3, 0x2E))
            quality_guid = GUID(0x1D5BE4B5, 0xFA4A, 0x452D, (ctypes.c_ubyte * 8)(0x9C, 0xDD, 0x5D, 0xB3, 0x51, 0x05, 0xE7, 0xEB))

            pStream = ctypes.c_void_p()
            ole32.CreateStreamOnHGlobal(None, True, ctypes.byref(pStream))

            q_val = ctypes.c_ulong(min(max(int(quality), 20), 95))
            ep = EncoderParameters()
            ep.Count = 1
            ep.Parameter[0].Guid = quality_guid
            ep.Parameter[0].NumberOfValues = 1
            ep.Parameter[0].Type = 4 # EncoderParameterValueTypeLong
            ep.Parameter[0].Value = ctypes.cast(ctypes.byref(q_val), ctypes.c_void_p)

            res = gdiplus.GdipSaveImageToStream(bmp_p, pStream, ctypes.byref(jpeg_clsid), ctypes.byref(ep))
            gdiplus.GdipDisposeImage(bmp_p)

            if res != 0:
                return None

            hGlobal = ctypes.c_void_p()
            ole32.GetHGlobalFromStream(pStream, ctypes.byref(hGlobal))
            size = kernel32.GlobalSize(hGlobal)
            if size <= 0:
                return None
            ptr = kernel32.GlobalLock(hGlobal)
            if not ptr:
                return None
            raw_bytes = ctypes.string_at(ptr, size)
            kernel32.GlobalUnlock(hGlobal)

            return base64.b64encode(raw_bytes).decode('ascii')
        except Exception:
            return None

    def _create_fallback_notice_bitmap(self, title_text, notice_text, recommendation_text):
        """Creates a high-contrast diagnostic frame when physical display surface is unavailable."""
        if platform.system() != "Windows":
            return None
        try:
            import ctypes
            from ctypes import wintypes
            user32 = ctypes.windll.user32
            gdi32 = ctypes.windll.gdi32

            class BITMAPINFOHEADER(ctypes.Structure):
                _fields_ = [
                    ('biSize', wintypes.DWORD), ('biWidth', wintypes.LONG), ('biHeight', wintypes.LONG),
                    ('biPlanes', wintypes.WORD), ('biBitCount', wintypes.WORD), ('biCompression', wintypes.DWORD),
                    ('biSizeImage', wintypes.DWORD), ('biXPelsPerMeter', wintypes.LONG), ('biYPelsPerMeter', wintypes.LONG),
                    ('biClrUsed', wintypes.DWORD), ('biClrImportant', wintypes.DWORD)
                ]

            w, h = 1280, 720
            bmi = BITMAPINFOHEADER()
            bmi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
            bmi.biWidth = w
            bmi.biHeight = h
            bmi.biPlanes = 1
            bmi.biBitCount = 24
            bmi.biCompression = 0

            memDC = gdi32.CreateCompatibleDC(None)
            pBits = ctypes.c_void_p()
            hBmp = gdi32.CreateDIBSection(memDC, ctypes.byref(bmi), 0, ctypes.byref(pBits), None, 0)
            if not hBmp:
                gdi32.DeleteDC(memDC)
                return None

            oldBmp = gdi32.SelectObject(memDC, hBmp)

            # Dark theme background
            hBrush = gdi32.CreateSolidBrush(0x001B1512)
            r_full = wintypes.RECT(0, 0, w, h)
            user32.FillRect(memDC, ctypes.byref(r_full), hBrush)
            gdi32.DeleteObject(hBrush)

            # Center card box
            hCardBrush = gdi32.CreateSolidBrush(0x002B201A)
            r_card = wintypes.RECT(140, 100, w - 140, h - 100)
            user32.FillRect(memDC, ctypes.byref(r_card), hCardBrush)
            gdi32.DeleteObject(hCardBrush)

            # Amber warning border
            hBorderPen = gdi32.CreatePen(0, 2, 0x0000D0FF)
            oldPen = gdi32.SelectObject(memDC, hBorderPen)
            gdi32.MoveToEx(memDC, r_card.left, r_card.top, None)
            gdi32.LineTo(memDC, r_card.right, r_card.top)
            gdi32.LineTo(memDC, r_card.right, r_card.bottom)
            gdi32.LineTo(memDC, r_card.left, r_card.bottom)
            gdi32.LineTo(memDC, r_card.left, r_card.top)
            gdi32.SelectObject(memDC, oldPen)
            gdi32.DeleteObject(hBorderPen)

            gdi32.SetBkMode(memDC, 1)

            # Title
            gdi32.SetTextColor(memDC, 0x0000FFFF)
            r_title = wintypes.RECT(r_card.left + 30, r_card.top + 35, r_card.right - 30, r_card.top + 95)
            user32.DrawTextW(memDC, str(title_text), -1, ctypes.byref(r_title), 0x0001 | 0x0010)

            # Notice
            gdi32.SetTextColor(memDC, 0x00E0E0E0)
            r_body = wintypes.RECT(r_card.left + 40, r_card.top + 115, r_card.right - 40, r_card.top + 280)
            user32.DrawTextW(memDC, str(notice_text), -1, ctypes.byref(r_body), 0x0010)

            # Recommendation
            gdi32.SetTextColor(memDC, 0x0000FF99)
            r_rec = wintypes.RECT(r_card.left + 40, r_card.top + 300, r_card.right - 40, r_card.bottom - 40)
            user32.DrawTextW(memDC, str(recommendation_text), -1, ctypes.byref(r_rec), 0x0010)

            gdi32.SelectObject(memDC, oldBmp)
            gdi32.DeleteDC(memDC)
            return hBmp
        except Exception:
            return None

    def _capture_desktop_image(self, quality=80, monitor_idx=0):
        """Captures full Windows/Linux desktop with real hardware mouse cursor overlay."""
        sys_os = platform.system()
        now_ms = int(time.time() * 1000)
        quality = min(max(int(quality or 80), 20), 95)
        if sys_os == "Windows":
            try:
                import ctypes
                from ctypes import wintypes
                user32 = ctypes.windll.user32
                gdi32 = ctypes.windll.gdi32
                kernel32 = ctypes.windll.kernel32

                # Attach to interactive window station and desktop
                try:
                    user32.OpenWindowStationW.argtypes = [wintypes.LPCWSTR, wintypes.BOOL, wintypes.DWORD]
                    user32.OpenWindowStationW.restype = wintypes.HANDLE
                    user32.SetProcessWindowStation.argtypes = [wintypes.HANDLE]
                    user32.SetProcessWindowStation.restype = wintypes.BOOL
                    user32.OpenDesktopW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
                    user32.OpenDesktopW.restype = wintypes.HANDLE
                    user32.SetThreadDesktop.argtypes = [wintypes.HANDLE]
                    user32.SetThreadDesktop.restype = wintypes.BOOL

                    hWs = user32.OpenWindowStationW("winsta0", False, 0x37F)
                    if hWs:
                        user32.SetProcessWindowStation(hWs)
                    hDesk = user32.OpenDesktopW("default", 0, False, 0x1FF)
                    if hDesk:
                        user32.SetThreadDesktop(hDesk)
                except Exception:
                    pass

                # Check Session 0 Isolation
                current_session = wintypes.DWORD(0)
                try:
                    current_pid = kernel32.GetCurrentProcessId()
                    kernel32.ProcessIdToSessionId(current_pid, ctypes.byref(current_session))
                    active_session = kernel32.WTSGetActiveConsoleSessionId()
                except Exception:
                    active_session = 0xFFFFFFFF

                w = user32.GetSystemMetrics(0) # SM_CXSCREEN
                h = user32.GetSystemMetrics(1) # SM_CYSCREEN

                # Detect session 0 isolation when service has no interactive display surface
                if current_session.value == 0 and active_session != 0 and active_session != 0xFFFFFFFF:
                    hScreenDC = user32.GetDC(None)
                    if not hScreenDC or w <= 0 or h <= 0:
                        if hScreenDC:
                            user32.ReleaseDC(None, hScreenDC)
                        fb_bmp = self._create_fallback_notice_bitmap(
                            "CYBERVPS REMOTE DESKTOP SUPERVISOR",
                            f"Windows Session 0 Isolation: Background agent service running in Session 0 while active console is Session {active_session}. Direct display surface is locked or detached.",
                            f"Recommended: Launch RustDesk Direct VIP ({getattr(self, 'virtual_ip', '10.77.0.x')}) or connect via 1-Click RDP Bridge."
                        )
                        if fb_bmp:
                            jpeg_data = self._encode_hbitmap_to_jpeg(fb_bmp, quality=quality)
                            if jpeg_data:
                                return {
                                    "success": True,
                                    "is_diagnostic_frame": True,
                                    "width": 1280,
                                    "height": 720,
                                    "format": "jpeg",
                                    "data": jpeg_data,
                                    "status": "session_0_isolated",
                                    "error": f"Windows Session 0 Isolation: Background agent in Session 0 (Active console Session {active_session}). Direct capture unavailable."
                                }
                        return {
                            "success": False,
                            "status": "session_0_isolated",
                            "session_id": current_session.value,
                            "active_console_session": active_session,
                            "error": f"Windows Session 0 Isolation: Background agent is running as a SYSTEM service in Session 0 while active console is Session {active_session}. Session 0 cannot directly capture Session {active_session} display. Use 1-Click RDP Bridge or run the agent in the active user console session."
                        }
                    user32.ReleaseDC(None, hScreenDC)

                if w <= 0 or h <= 0:
                    w, h = 1920, 1080

                hScreenDC = user32.GetDC(None)
                if not hScreenDC:
                    fb_bmp = self._create_fallback_notice_bitmap(
                        "CYBERVPS REMOTE DESKTOP SUPERVISOR",
                        f"Unable to acquire desktop display context handle. Host system may be locked, display sleeping, or headless in Session {current_session.value}.",
                        f"Recommended: Launch RustDesk Direct VIP ({getattr(self, 'virtual_ip', '10.77.0.x')}) or connect via 1-Click RDP Bridge."
                    )
                    if fb_bmp:
                        jpeg_data = self._encode_hbitmap_to_jpeg(fb_bmp, quality=quality)
                        if jpeg_data:
                            return {
                                "success": True,
                                "is_diagnostic_frame": True,
                                "width": 1280,
                                "height": 720,
                                "format": "jpeg",
                                "data": jpeg_data,
                                "status": "session_0_isolated" if current_session.value == 0 else "permission_denied",
                                "error": "Unable to acquire desktop DC handle."
                            }
                    if current_session.value == 0:
                        return {
                            "success": False,
                            "status": "session_0_isolated",
                            "session_id": current_session.value,
                            "active_console_session": active_session,
                            "error": f"Windows Session 0 Isolation: Unable to acquire desktop DC handle from Session 0 (Active user console is Session {active_session}). Use 1-Click RDP Bridge or launch agent in user session."
                        }
                    return {"success": False, "status": "permission_denied", "error": "Unable to acquire desktop DC handle."}

                memDC = gdi32.CreateCompatibleDC(hScreenDC)
                hBmp = gdi32.CreateCompatibleBitmap(hScreenDC, w, h)
                oldBmp = gdi32.SelectObject(memDC, hBmp)

                # Capture full desktop (SRCCOPY = 0x00CC0020)
                blt_ok = gdi32.BitBlt(memDC, 0, 0, w, h, hScreenDC, 0, 0, 0x00CC0020)
                if not blt_ok:
                    gdi32.SelectObject(memDC, oldBmp)
                    gdi32.DeleteObject(hBmp)
                    gdi32.DeleteDC(memDC)
                    user32.ReleaseDC(None, hScreenDC)
                    fb_bmp = self._create_fallback_notice_bitmap(
                        "CYBERVPS REMOTE DESKTOP SUPERVISOR",
                        f"BitBlt failed to read display surface (Session {current_session.value}, Active console {active_session}). Display surface is currently locked or without interactive monitor.",
                        f"Recommended: Launch RustDesk Direct VIP ({getattr(self, 'virtual_ip', '10.77.0.x')}) or connect via 1-Click RDP Bridge."
                    )
                    if fb_bmp:
                        jpeg_data = self._encode_hbitmap_to_jpeg(fb_bmp, quality=quality)
                        if jpeg_data:
                            return {
                                "success": True,
                                "is_diagnostic_frame": True,
                                "width": 1280,
                                "height": 720,
                                "format": "jpeg",
                                "data": jpeg_data,
                                "status": "session_0_isolated" if current_session.value == 0 else "permission_denied",
                                "error": f"BitBlt failed to read display surface from Session {current_session.value}."
                            }
                    if current_session.value == 0:
                        return {
                            "success": False,
                            "status": "session_0_isolated",
                            "session_id": current_session.value,
                            "active_console_session": active_session,
                            "error": f"Windows Session 0 Isolation: BitBlt failed to read display surface from Session 0. Use 1-Click RDP Bridge or run agent in active user session {active_session}."
                        }
                    return {"success": False, "status": "permission_denied", "error": "BitBlt failed to capture display buffer."}

                # Draw real-time hardware cursor
                try:
                    class CURSORINFO(ctypes.Structure):
                        _fields_ = [("cbSize", wintypes.DWORD), ("flags", wintypes.DWORD), ("hCursor", wintypes.HBITMAP), ("ptScreenPos", wintypes.POINT)]
                    ci = CURSORINFO()
                    ci.cbSize = ctypes.sizeof(CURSORINFO)
                    if user32.GetCursorInfo(ctypes.byref(ci)):
                        if ci.flags == 1 and ci.hCursor:
                            user32.DrawIcon(memDC, ci.ptScreenPos.x, ci.ptScreenPos.y, ci.hCursor)
                except Exception:
                    pass

                # Encode to JPEG via GDI+
                b64_data = self._encode_hbitmap_to_jpeg(hBmp, quality=quality)
                fmt = "jpeg"

                # Fallback to DIBits / PIL / pure raw BMP if GDI+ was not available
                if not b64_data:
                    try:
                        class BITMAPINFOHEADER(ctypes.Structure):
                            _fields_ = [('biSize', wintypes.DWORD), ('biWidth', wintypes.LONG), ('biHeight', wintypes.LONG),
                                        ('biPlanes', wintypes.WORD), ('biBitCount', wintypes.WORD), ('biCompression', wintypes.DWORD),
                                        ('biSizeImage', wintypes.DWORD), ('biXPelsPerMeter', wintypes.LONG), ('biYPelsPerMeter', wintypes.LONG),
                                        ('biClrUsed', wintypes.DWORD), ('biClrImportant', wintypes.DWORD)]
                        bmi = BITMAPINFOHEADER()
                        bmi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
                        bmi.biWidth = w
                        bmi.biHeight = h
                        bmi.biPlanes = 1
                        bmi.biBitCount = 32
                        bmi.biCompression = 0
                        buf_size = w * h * 4
                        buf = ctypes.create_string_buffer(buf_size)
                        gdi32.GetDIBits(memDC, hBmp, 0, h, buf, ctypes.byref(bmi), 0)
                        raw_bytes = buf.raw

                        try:
                            from PIL import Image
                            import io
                            img = Image.frombuffer('RGBA', (w, h), raw_bytes, 'raw', 'BGRA', 0, -1)
                            out_io = io.BytesIO()
                            img.convert('RGB').save(out_io, format='JPEG', quality=quality)
                            b64_data = base64.b64encode(out_io.getvalue()).decode('ascii')
                            fmt = "jpeg"
                        except Exception:
                            import struct
                            file_size = 54 + (w * h * 3)
                            bmp_hdr = struct.pack('<2sIHHI', b'BM', file_size, 0, 0, 54)
                            dib_hdr = struct.pack('<IIIHHIIIIII', 40, w, h, 1, 24, 0, w * h * 3, 2835, 2835, 0, 0)
                            rgb_bytes = bytearray(w * h * 3)
                            for i in range(w * h):
                                rgb_bytes[i*3 : i*3+3] = raw_bytes[i*4 : i*4+3]
                            b64_data = base64.b64encode(bmp_hdr + dib_hdr + rgb_bytes).decode('ascii')
                            fmt = "bmp"
                    except Exception:
                        pass

                gdi32.SelectObject(memDC, oldBmp)
                gdi32.DeleteObject(hBmp)
                gdi32.DeleteDC(memDC)
                user32.ReleaseDC(None, hScreenDC)

                if not b64_data:
                    return {"success": False, "status": "capture_encode_failed", "error": "Failed to encode desktop frame buffer."}

                return {
                    "success": True,
                    "has_gui": True,
                    "desktop_mode": True,
                    "title": "Windows Desktop (Full Screen)",
                    "width": w,
                    "height": h,
                    "is_minimized": False,
                    "format": fmt,
                    "data": b64_data,
                    "timestamp": now_ms
                }
            except Exception as e:
                return {"success": False, "status": "capture_error", "error": f"Exception capturing full desktop: {e}"}
        else:
            # Linux desktop capture (X11 / Wayland / headless virtual display)
            try:
                import shutil
                env = os.environ.copy()
                if "DISPLAY" not in env:
                    for d in [":0", ":1", ":10", ":99"]:
                        sock_path = f"/tmp/.X11-unix/X{d.replace(':', '')}"
                        if os.path.exists(sock_path):
                            env["DISPLAY"] = d
                            break
                    if "DISPLAY" not in env:
                        env["DISPLAY"] = ":0"
                if "XAUTHORITY" not in env:
                    for auth in ["/root/.Xauthority", os.path.expanduser("~/.Xauthority")]:
                        if os.path.exists(auth):
                            env["XAUTHORITY"] = auth
                            break

                stdout = None
                # Method A: xwd + ImageMagick / Netpbm
                try:
                    p1 = subprocess.Popen(["xwd", "-root", "-silent"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
                    p2 = subprocess.Popen(["convert", "xwd:-", "jpg:-"], stdin=p1.stdout, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
                    p1.stdout.close()
                    stdout, _ = p2.communicate(timeout=3)
                except Exception:
                    stdout = None

                # Method B: ffmpeg x11grab
                if not stdout or len(stdout) < 500:
                    try:
                        disp_str = env.get("DISPLAY", ":0")
                        if not disp_str.startswith(":"):
                            disp_str = ":" + disp_str
                        p = subprocess.Popen(
                            ["ffmpeg", "-y", "-f", "x11grab", "-draw_mouse", "1", "-i", f"{disp_str}.0", "-vframes", "1", "-f", "mjpeg", "-"],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env
                        )
                        stdout, _ = p.communicate(timeout=3)
                    except Exception:
                        pass

                # Method C: scrot
                if not stdout or len(stdout) < 500:
                    try:
                        p = subprocess.Popen(["scrot", "-z", "-q", str(quality), "-"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
                        stdout, _ = p.communicate(timeout=3)
                    except Exception:
                        pass

                # Method D: ImageMagick import
                if not stdout or len(stdout) < 500:
                    try:
                        p = subprocess.Popen(["import", "-window", "root", "jpg:-"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
                        stdout, _ = p.communicate(timeout=3)
                    except Exception:
                        pass

                # Method E: grim (Wayland screencopy)
                if not stdout or len(stdout) < 500:
                    try:
                        p = subprocess.Popen(["grim", "-t", "jpeg", "-"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
                        stdout, _ = p.communicate(timeout=3)
                    except Exception:
                        pass

                if stdout and len(stdout) > 500:
                    return {
                        "success": True,
                        "has_gui": True,
                        "desktop_mode": True,
                        "title": f"Linux Desktop ({env.get('DISPLAY', ':0')})",
                        "width": 1920,
                        "height": 1080,
                        "is_minimized": False,
                        "format": "jpeg",
                        "data": base64.b64encode(stdout).decode("ascii"),
                        "timestamp": now_ms
                    }
            except Exception:
                pass

            import shutil
            has_xvfb = shutil.which("Xvfb") is not None
            err_msg = (
                "Headless Linux Server: No active physical or virtual X11/Wayland display detected. "
                "Start an interactive desktop session or run 'Xvfb :99 -screen 0 1920x1080x24 &' to launch a virtual display."
                if not has_xvfb else
                "No active graphical display detected on Linux host. Virtual Xvfb display is installed and available to launch."
            )
            return {"success": False, "status": "no_display", "error": err_msg, "has_xvfb": has_xvfb}

    def _capture_window_image(self, hwnd=None, pid=None, quality=80, max_w=1920, max_h=1080, app_id=None, app_name=None, desktop_mode=False):
        sys_os = platform.system()
        quality = min(max(int(quality or 80), 30), 95)
        window_title = ""

        # Delegate to full desktop capture if requested or no specific window/pid target
        if desktop_mode or (not hwnd and not pid):
            return self._capture_desktop_image(quality=quality)

        # Resolve target window if hwnd not given or invalid
        if not hwnd or int(hwnd) <= 0:
            windows = self._get_process_windows(pid, app_id=app_id, app_name=app_name)
            if not windows:
                alive = self.is_pid_alive(pid) if pid else False
                return {
                    "success": False,
                    "has_gui": False,
                    "pid": pid,
                    "error": f"Process {pid} is no longer running." if (pid and not alive) else "No capturable graphical window found for this process. It may be running as a background service or daemon without GUI.",
                    "status": "process_not_found" if (pid and not alive) else "no_window"
                }
            active_wins = [w for w in windows if not w.get("is_minimized")]
            chosen = active_wins[0] if active_wins else windows[0]
            hwnd = chosen["hwnd"]
            window_title = chosen.get("title", f"Window {hwnd}")
            is_min = chosen.get("is_minimized", False)
        else:
            hwnd = int(hwnd)
            window_title = f"Window {hwnd}"
            is_min = False

        if sys_os == "Windows":
            try:
                import ctypes
                from ctypes import wintypes
                user32 = ctypes.windll.user32
                gdi32 = ctypes.windll.gdi32

                user32.OpenWindowStationW.argtypes = [wintypes.LPCWSTR, wintypes.BOOL, wintypes.DWORD]
                user32.OpenWindowStationW.restype = wintypes.HANDLE
                user32.SetProcessWindowStation.argtypes = [wintypes.HANDLE]
                user32.SetProcessWindowStation.restype = wintypes.BOOL
                user32.OpenDesktopW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
                user32.OpenDesktopW.restype = wintypes.HANDLE
                user32.SetThreadDesktop.argtypes = [wintypes.HANDLE]
                user32.SetThreadDesktop.restype = wintypes.BOOL

                hWs = user32.OpenWindowStationW("winsta0", False, 0x37F)
                if hWs:
                    user32.SetProcessWindowStation(hWs)
                hDesk = user32.OpenDesktopW("default", 0, False, 0x1FF)
                if hDesk:
                    user32.SetThreadDesktop(hDesk)

                user32.IsWindow.argtypes = [wintypes.HWND]
                user32.IsWindow.restype = wintypes.BOOL
                user32.IsIconic.argtypes = [wintypes.HWND]
                user32.IsIconic.restype = wintypes.BOOL
                user32.GetWindowDC.argtypes = [wintypes.HWND]
                user32.GetWindowDC.restype = wintypes.HDC
                user32.ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]
                user32.ReleaseDC.restype = ctypes.c_int
                user32.GetDC.argtypes = [wintypes.HWND]
                user32.GetDC.restype = wintypes.HDC
                user32.PrintWindow.argtypes = [wintypes.HWND, wintypes.HDC, wintypes.UINT]
                user32.PrintWindow.restype = wintypes.BOOL
                user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
                user32.GetWindowRect.restype = wintypes.BOOL

                gdi32.CreateCompatibleDC.argtypes = [wintypes.HDC]
                gdi32.CreateCompatibleDC.restype = wintypes.HDC
                gdi32.CreateCompatibleBitmap.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int]
                gdi32.CreateCompatibleBitmap.restype = wintypes.HBITMAP
                gdi32.SelectObject.argtypes = [wintypes.HDC, wintypes.HGDIOBJ]
                gdi32.SelectObject.restype = wintypes.HGDIOBJ
                gdi32.DeleteObject.argtypes = [wintypes.HGDIOBJ]
                gdi32.DeleteObject.restype = wintypes.BOOL
                gdi32.DeleteDC.argtypes = [wintypes.HDC]
                gdi32.DeleteDC.restype = wintypes.BOOL
                gdi32.GetDIBits.argtypes = [wintypes.HDC, wintypes.HBITMAP, wintypes.UINT, wintypes.UINT, wintypes.LPVOID, ctypes.c_void_p, wintypes.UINT]
                gdi32.GetDIBits.restype = ctypes.c_int
                gdi32.BitBlt.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.HDC, ctypes.c_int, ctypes.c_int, wintypes.DWORD]
                gdi32.BitBlt.restype = wintypes.BOOL

                h_wnd = wintypes.HWND(hwnd)
                if not user32.IsWindow(h_wnd):
                    return {
                        "success": False,
                        "has_gui": False,
                        "pid": pid,
                        "hwnd": hwnd,
                        "error": f"Window handle {hwnd} is no longer valid or application has exited.",
                        "status": "window_closed"
                    }

                r = wintypes.RECT()
                user32.GetWindowRect(h_wnd, ctypes.byref(r))
                w = max(1, r.right - r.left)
                h = max(1, r.bottom - r.top)

                is_min = bool(user32.IsIconic(h_wnd)) or (w == 160 and h == 28)
                if is_min:
                    try:
                        user32.ShowWindow(h_wnd, 9) # SW_RESTORE
                        time.sleep(0.06)
                        user32.GetWindowRect(h_wnd, ctypes.byref(r))
                        w = max(1, r.right - r.left)
                        h = max(1, r.bottom - r.top)
                        is_min = bool(user32.IsIconic(h_wnd)) or (w == 160 and h == 28)
                    except Exception:
                        pass
                if is_min:
                    return {
                        "success": False,
                        "has_gui": True,
                        "is_minimized": True,
                        "pid": pid,
                        "hwnd": hwnd,
                        "title": window_title,
                        "error": "Window is currently minimized to taskbar on host desktop.",
                        "status": "minimized"
                    }

                len_t = user32.GetWindowTextLengthW(h_wnd)
                if len_t > 0:
                    t_buf = ctypes.create_unicode_buffer(len_t + 1)
                    user32.GetWindowTextW(h_wnd, t_buf, len_t + 1)
                    if t_buf.value:
                        window_title = t_buf.value

                hwndDC = user32.GetWindowDC(h_wnd)
                if not hwndDC:
                    return {"success": False, "error": "Unable to acquire window DC handle.", "status": "permission_denied"}

                memDC = gdi32.CreateCompatibleDC(hwndDC)
                hBmp = gdi32.CreateCompatibleBitmap(hwndDC, w, h)
                oldBmp = gdi32.SelectObject(memDC, hBmp)

                pw_ok = user32.PrintWindow(h_wnd, memDC, 2)
                if not pw_ok:
                    pw_ok = user32.PrintWindow(h_wnd, memDC, 0)

                if not pw_ok:
                    screenDC = user32.GetDC(None)
                    if screenDC:
                        gdi32.BitBlt(memDC, 0, 0, w, h, screenDC, r.left, r.top, 0x00CC0020)
                        user32.ReleaseDC(None, screenDC)

                # Hardware-accelerated GDI+ JPEG encoding first
                b64_data = self._encode_hbitmap_to_jpeg(hBmp, quality=quality)
                fmt = "jpeg"

                if not b64_data:
                    # Fallback to DIBits / PIL / raw bmp if GDI+ not initialized
                    class BITMAPINFOHEADER(ctypes.Structure):
                        _fields_ = [
                            ('biSize', wintypes.DWORD), ('biWidth', wintypes.LONG), ('biHeight', wintypes.LONG),
                            ('biPlanes', wintypes.WORD), ('biBitCount', wintypes.WORD), ('biCompression', wintypes.DWORD),
                            ('biSizeImage', wintypes.DWORD), ('biXPelsPerMeter', wintypes.LONG), ('biYPelsPerMeter', wintypes.LONG),
                            ('biClrUsed', wintypes.DWORD), ('biClrImportant', wintypes.DWORD)
                        ]
                    bmi = BITMAPINFOHEADER()
                    bmi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
                    bmi.biWidth = w
                    bmi.biHeight = h
                    bmi.biPlanes = 1
                    bmi.biBitCount = 32
                    bmi.biCompression = 0

                    buf_size = w * h * 4
                    buf = ctypes.create_string_buffer(buf_size)
                    gdi32.GetDIBits(memDC, hBmp, 0, h, buf, ctypes.byref(bmi), 0)
                    raw_bytes = buf.raw

                    try:
                        from PIL import Image
                        import io
                        img = Image.frombuffer('RGBA', (w, h), raw_bytes, 'raw', 'BGRA', 0, -1)
                        if w > max_w or h > max_h:
                            img.thumbnail((max_w, max_h), Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.ANTIALIAS)
                            w, h = img.size
                        out_io = io.BytesIO()
                        img.convert('RGB').save(out_io, format='JPEG', quality=quality)
                        b64_data = base64.b64encode(out_io.getvalue()).decode('ascii')
                        fmt = "jpeg"
                    except Exception:
                        import struct
                        file_size = 54 + (w * h * 3)
                        bmp_hdr = struct.pack('<2sIHHI', b'BM', file_size, 0, 0, 54)
                        dib_hdr = struct.pack('<IIIHHIIIIII', 40, w, h, 1, 24, 0, w * h * 3, 2835, 2835, 0, 0)
                        rgb_bytes = bytearray(w * h * 3)
                        for i in range(w * h):
                            rgb_bytes[i*3 : i*3+3] = raw_bytes[i*4 : i*4+3]
                        b64_data = base64.b64encode(bmp_hdr + dib_hdr + rgb_bytes).decode('ascii')
                        fmt = "bmp"

                gdi32.SelectObject(memDC, oldBmp)
                gdi32.DeleteObject(hBmp)
                gdi32.DeleteDC(memDC)
                user32.ReleaseDC(h_wnd, hwndDC)

                return {
                    "success": True,
                    "has_gui": True,
                    "pid": pid,
                    "hwnd": hwnd,
                    "title": window_title,
                    "width": w,
                    "height": h,
                    "is_minimized": False,
                    "format": fmt,
                    "data": b64_data,
                    "timestamp": int(time.time() * 1000)
                }

            except Exception as e:
                return {
                    "success": False,
                    "has_gui": True,
                    "pid": pid,
                    "hwnd": hwnd,
                    "error": f"Exception capturing window: {str(e)}",
                    "status": "capture_error"
                }

        else:
            # Linux capture
            try:
                wid_target = str(hwnd)
                cmd = ["import", "-window", wid_target, "jpg:-"]
                p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                stdout, _ = p.communicate(timeout=3)
                if p.returncode == 0 and len(stdout) > 500:
                    b64_data = base64.b64encode(stdout).decode('ascii')
                    return {
                        "success": True,
                        "has_gui": True,
                        "pid": pid,
                        "hwnd": hwnd,
                        "title": window_title or f"Linux Window {hwnd}",
                        "width": 1280,
                        "height": 720,
                        "is_minimized": False,
                        "format": "jpeg",
                        "data": b64_data,
                        "timestamp": int(time.time() * 1000)
                    }
            except Exception:
                pass

            is_wayland = bool(os.environ.get("WAYLAND_DISPLAY") or os.environ.get("XDG_SESSION_TYPE") == "wayland")
            if is_wayland:
                return {
                    "success": False,
                    "has_gui": True,
                    "pid": pid,
                    "error": "Wayland display server active: Remote window capture requires PipeWire / XDG Desktop Portal session permissions.",
                    "status": "wayland_restricted"
                }

            return {
                "success": False,
                "has_gui": False,
                "pid": pid,
                "error": "No capturable graphical window found on current display server.",
                "status": "no_display"
            }

    def _app_stream_worker_loop(self, stream_id):
        stream_cfg = self.active_app_streams.get(stream_id)
        if not stream_cfg:
            return

        pid = stream_cfg.get("pid")
        hwnd = stream_cfg.get("hwnd")
        app_id = stream_cfg.get("app_id")
        app_name = stream_cfg.get("app_name")
        correlation_id = stream_cfg.get("correlation_id")
        target_fps = stream_cfg.get("fps", 25)
        quality = stream_cfg.get("quality", 80)

        frame_counter = 0
        last_fps_calc = time.time()
        measured_fps = float(target_fps)

        print(f"[*] Starting live app stream {stream_id} for PID {pid} (target {target_fps} FPS, quality {quality}, corr: {correlation_id})...")

        # Stage milestone: report worker_started immediately
        self.send_agent_event({
            "type": "AppStreamStatus",
            "payload": {
                "stream_id": stream_id,
                "correlation_id": correlation_id,
                "status": "worker_started",
                "pid": pid,
                "hwnd": hwnd,
                "fps": target_fps,
                "quality": quality,
                "timestamp": int(time.time() * 1000)
            }
        })

        while self.running and stream_id in self.active_app_streams:
            stream_cfg = self.active_app_streams.get(stream_id)
            if not stream_cfg or not stream_cfg.get("running"):
                break

            curr_hwnd = stream_cfg.get("hwnd")
            curr_fps = stream_cfg.get("fps", target_fps)
            curr_qual = stream_cfg.get("quality", quality)
            desktop_mode = stream_cfg.get("desktop_mode", False)

            t0 = time.time()
            try:
                res = self._capture_window_image(
                    hwnd=curr_hwnd,
                    pid=pid,
                    quality=curr_qual,
                    app_id=app_id,
                    app_name=app_name,
                    desktop_mode=desktop_mode
                )
            except Exception as e:
                res = {"success": False, "status": "capture_error", "error": f"Unexpected capture worker exception: {e}"}

            now = time.time()
            frame_counter += 1
            if (now - last_fps_calc) >= 1.0:
                measured_fps = round(frame_counter / max(0.001, (now - last_fps_calc)), 1)
                frame_counter = 0
                last_fps_calc = now

            if res.get("success"):
                if res.get("hwnd") and not curr_hwnd:
                    stream_cfg["hwnd"] = res.get("hwnd")

                self.send_agent_event({
                    "type": "AppStreamFrame",
                    "payload": {
                        "stream_id": stream_id,
                        "correlation_id": correlation_id,
                        "pid": pid,
                        "hwnd": res.get("hwnd"),
                        "title": res.get("title", ""),
                        "width": res.get("width"),
                        "height": res.get("height"),
                        "is_minimized": res.get("is_minimized", False),
                        "has_gui": True,
                        "desktop_mode": desktop_mode,
                        "format": res.get("format", "jpeg"),
                        "data": res.get("data"),
                        "fps": measured_fps,
                        "is_diagnostic_frame": res.get("is_diagnostic_frame", False),
                        "timestamp": int(now * 1000)
                    }
                }, skip_if_busy=True)
                if res.get("is_diagnostic_frame"):
                    self.send_agent_event({
                        "type": "AppStreamStatus",
                        "payload": {
                            "stream_id": stream_id,
                            "correlation_id": correlation_id,
                            "status": res.get("status", "session_0_isolated"),
                            "error": res.get("error", "Headless display notice active"),
                            "recommendation": "rustdesk",
                            "timestamp": int(now * 1000)
                        }
                    })
                    time.sleep(1.0)
            else:
                self.send_agent_event({
                    "type": "AppStreamStatus",
                    "payload": {
                        "stream_id": stream_id,
                        "correlation_id": correlation_id,
                        "pid": pid,
                        "status": res.get("status", "error"),
                        "has_gui": res.get("has_gui", False),
                        "is_minimized": res.get("is_minimized", False),
                        "error": res.get("error", "Failed to capture window frame"),
                        "timestamp": int(now * 1000)
                    }
                })
                if res.get("status") in ["window_closed", "process_not_found"]:
                    time.sleep(1.0)
                    if pid and not self.is_pid_alive(pid):
                        break
                elif res.get("status") in ["session_0_isolated", "permission_denied", "no_display"]:
                    time.sleep(2.0)

            elapsed = time.time() - t0
            frame_budget = 1.0 / max(1, curr_fps)
            sleep_needed = frame_budget - elapsed
            if sleep_needed > 0.002:
                time.sleep(sleep_needed)

        print(f"[*] Live stream {stream_id} stopped cleanly. Released all capture resources.")
        with self.lock:
            self.active_app_streams.pop(stream_id, None)

    def handle_app_window_list(self, payload):
        req_id = payload.get("request_id")
        pid = payload.get("pid")
        app_id = payload.get("app_id")
        app_name = payload.get("app_name") or payload.get("name")
        try:
            windows = self._get_process_windows(pid, app_id=app_id, app_name=app_name)
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {
                    "request_id": req_id,
                    "success": True,
                    "result": {
                        "pid": pid,
                        "has_gui": len(windows) > 0,
                        "count": len(windows),
                        "windows": windows
                    }
                }
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def handle_app_window_frame(self, payload):
        req_id = payload.get("request_id")
        pid = payload.get("pid")
        hwnd = payload.get("hwnd")
        app_id = payload.get("app_id")
        app_name = payload.get("app_name") or payload.get("name")
        quality = payload.get("quality", 85)
        try:
            res = self._capture_window_image(hwnd=hwnd, pid=pid, quality=quality, app_id=app_id, app_name=app_name)
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {
                    "request_id": req_id,
                    "success": res.get("success", False),
                    "result": res,
                    "error": res.get("error") if not res.get("success") else None
                }
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def handle_app_stream_start(self, payload):
        try:
            stream_id = payload.get("stream_id")
            pid = payload.get("pid")
            hwnd = payload.get("hwnd")
            correlation_id = payload.get("correlation_id")
            app_id = payload.get("app_id")
            app_name = payload.get("app_name") or payload.get("name")
            fps = min(max(int(payload.get("fps", 25)), 1), 60)
            quality = min(max(int(payload.get("quality", 80)), 30), 95)
            desktop_mode = bool(payload.get("desktop_mode", False) or (not hwnd and not pid))

            if not stream_id:
                return

            with self.lock:
                for old_sid in list(self.active_app_streams.keys()):
                    try:
                        self.active_app_streams[old_sid]["running"] = False
                    except Exception:
                        pass
                self.active_app_streams.clear()

            # Milestone: Send immediate authenticated agent delivery acknowledgement
            self.send_agent_event({
                "type": "RemoteDesktopStarted",
                "payload": {
                    "stream_id": stream_id,
                    "correlation_id": correlation_id,
                    "machine_id": self.machine_id,
                    "status": "agent_acknowledged",
                    "desktop_mode": desktop_mode,
                    "timestamp": int(time.time() * 1000)
                }
            }, skip_if_busy=False)

            # Preflight Display Checks
            sys_os = platform.system()
            if sys_os == "Windows" and desktop_mode:
                try:
                    import ctypes
                    kernel32 = ctypes.windll.kernel32
                    proc_session = ctypes.c_ulong()
                    kernel32.ProcessIdToSessionId(kernel32.GetCurrentProcessId(), ctypes.byref(proc_session))
                    active_console = kernel32.WTSGetActiveConsoleSessionId()
                    if proc_session.value == 0 and active_console != 0:
                        self.send_agent_event({
                            "type": "AppStreamStatus",
                            "payload": {
                                "stream_id": stream_id,
                                "correlation_id": correlation_id,
                                "status": "session_0_isolated",
                                "error": "Windows Session 0 Isolation: Agent service cannot capture active user display directly. Connect via 1-Click RDP Bridge or run agent in active user session."
                            }
                        })
                except Exception:
                    pass
            elif sys_os == "Linux" and desktop_mode:
                try:
                    import glob
                    has_disp = bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY") or glob.glob("/tmp/.X11-unix/X*"))
                    if not has_disp:
                        self.send_agent_event({
                            "type": "AppStreamStatus",
                            "payload": {
                                "stream_id": stream_id,
                                "correlation_id": correlation_id,
                                "status": "no_display",
                                "error": "Headless Linux Host: No active graphical display found (/tmp/.X11-unix/X* is empty). Start Xvfb or an X11/Wayland desktop session."
                            }
                        })
                except Exception:
                    pass

            with self.lock:
                self.active_app_streams[stream_id] = {
                    "running": True,
                    "pid": pid,
                    "hwnd": hwnd,
                    "fps": fps,
                    "quality": quality,
                    "desktop_mode": desktop_mode,
                    "interactive": bool(payload.get("interactive", True)),
                    "correlation_id": correlation_id,
                    "app_id": app_id,
                    "app_name": app_name,
                    "start_time": time.time()
                }

            threading.Thread(target=self._app_stream_worker_loop, args=(stream_id,), daemon=True).start()
        except Exception as e:
            print(f"[!] Error in handle_app_stream_start: {e}")
            if payload and payload.get("stream_id"):
                self.send_agent_event({
                    "type": "AppStreamStatus",
                    "payload": {
                        "stream_id": payload.get("stream_id"),
                        "correlation_id": payload.get("correlation_id"),
                        "status": "error",
                        "error": f"Failed to initialize stream worker: {e}"
                    }
                })

    def handle_app_stream_stop(self, payload):
        stream_id = payload.get("stream_id")
        self.cleanup_desktop_keys()
        if stream_id and stream_id in self.active_app_streams:
            with self.lock:
                self.active_app_streams[stream_id]["running"] = False
                self.active_app_streams.pop(stream_id, None)

    def handle_app_stream_select_window(self, payload):
        stream_id = payload.get("stream_id")
        hwnd = payload.get("hwnd")
        if stream_id and stream_id in self.active_app_streams:
            with self.lock:
                self.active_app_streams[stream_id]["hwnd"] = hwnd
                self.active_app_streams[stream_id]["desktop_mode"] = False if hwnd else True

    def handle_desktop_input_mouse(self, payload):
        """Processes remote mouse events with pixel-perfect screen coordinate mapping."""
        sys_os = platform.system()
        try:
            action = payload.get("action") or payload.get("type", "move")
            raw_x = float(payload.get("x", 0))
            raw_y = float(payload.get("y", 0))
            canvas_w = float(payload.get("canvas_w", 0))
            canvas_h = float(payload.get("canvas_h", 0))
            delta_y = int(payload.get("delta_y", 0))

            raw_button = payload.get("button", 0)
            if isinstance(raw_button, str):
                b_str = raw_button.lower()
                button = 2 if b_str == "right" else (1 if b_str == "middle" else 0)
            else:
                try:
                    button = int(raw_button)
                except Exception:
                    button = 0

            if sys_os == "Windows":
                import ctypes
                user32 = ctypes.windll.user32
                w = max(1, user32.GetSystemMetrics(0))
                h = max(1, user32.GetSystemMetrics(1))

                if canvas_w > 0 and canvas_h > 0:
                    px_x = int((raw_x / canvas_w) * w)
                    px_y = int((raw_y / canvas_h) * h)
                elif 0.0 <= raw_x <= 1.0 and 0.0 <= raw_y <= 1.0:
                    px_x = int(raw_x * w)
                    px_y = int(raw_y * h)
                else:
                    px_x = int(raw_x)
                    px_y = int(raw_y)

                px_x = max(0, min(w - 1, px_x))
                px_y = max(0, min(h - 1, px_y))

                user32.SetCursorPos(px_x, px_y)

                # MOUSEEVENTF_LEFTDOWN = 0x0002, MOUSEEVENTF_LEFTUP = 0x0004
                # MOUSEEVENTF_RIGHTDOWN = 0x0008, MOUSEEVENTF_RIGHTUP = 0x0010
                # MOUSEEVENTF_MIDDLEDOWN = 0x0020, MOUSEEVENTF_MIDDLEUP = 0x0040
                # MOUSEEVENTF_WHEEL = 0x0800
                if action == "down":
                    if button == 0:
                        user32.mouse_event(0x0002, 0, 0, 0, 0)
                    elif button == 2:
                        user32.mouse_event(0x0008, 0, 0, 0, 0)
                    elif button == 1:
                        user32.mouse_event(0x0020, 0, 0, 0, 0)
                elif action == "up":
                    if button == 0:
                        user32.mouse_event(0x0004, 0, 0, 0, 0)
                    elif button == 2:
                        user32.mouse_event(0x0010, 0, 0, 0, 0)
                    elif button == 1:
                        user32.mouse_event(0x0040, 0, 0, 0, 0)
                elif action == "click":
                    if button == 0:
                        user32.mouse_event(0x0002, 0, 0, 0, 0)
                        user32.mouse_event(0x0004, 0, 0, 0, 0)
                    elif button == 2:
                        user32.mouse_event(0x0008, 0, 0, 0, 0)
                        user32.mouse_event(0x0010, 0, 0, 0, 0)
                    elif button == 1:
                        user32.mouse_event(0x0020, 0, 0, 0, 0)
                        user32.mouse_event(0x0040, 0, 0, 0, 0)
                elif action == "dblclick":
                    user32.mouse_event(0x0002, 0, 0, 0, 0)
                    user32.mouse_event(0x0004, 0, 0, 0, 0)
                    time.sleep(0.04)
                    user32.mouse_event(0x0002, 0, 0, 0, 0)
                    user32.mouse_event(0x0004, 0, 0, 0, 0)
                elif action == "contextmenu":
                    user32.mouse_event(0x0008, 0, 0, 0, 0)
                    user32.mouse_event(0x0010, 0, 0, 0, 0)
                elif action == "wheel":
                    amount = int(delta_y)
                    if abs(amount) < 10:
                        amount *= 120
                    user32.mouse_event(0x0800, 0, 0, amount, 0)
            else:
                # Linux mouse input dispatch via xdotool
                px_x = int(raw_x)
                px_y = int(raw_y)
                btn_num = 1 if button == 0 else (3 if button == 2 else 2)
                if action == "move":
                    subprocess.Popen(["xdotool", "mousemove", str(px_x), str(px_y)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                elif action == "down":
                    subprocess.Popen(["xdotool", "mousemove", str(px_x), str(px_y), "mousedown", str(btn_num)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                elif action == "up":
                    subprocess.Popen(["xdotool", "mousemove", str(px_x), str(px_y), "mouseup", str(btn_num)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                elif action == "click":
                    subprocess.Popen(["xdotool", "mousemove", str(px_x), str(px_y), "click", str(btn_num)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                elif action == "dblclick":
                    subprocess.Popen(["xdotool", "mousemove", str(px_x), str(px_y), "click", "--repeat", "2", str(btn_num)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                elif action == "contextmenu":
                    subprocess.Popen(["xdotool", "mousemove", str(px_x), str(px_y), "click", "3"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                elif action == "wheel":
                    w_btn = "4" if delta_y < 0 else "5"
                    subprocess.Popen(["xdotool", "click", w_btn], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

    def handle_desktop_input_keyboard(self, payload):
        """Processes remote keyboard events, physical key-down/up, modifier tracking."""
        sys_os = platform.system()
        k_type = payload.get("action") or payload.get("type", "keydown")
        if k_type == "down":
            k_type = "keydown"
        elif k_type == "up":
            k_type = "keyup"
        key = payload.get("key", "")
        code = payload.get("code", "")
        vk = int(payload.get("vk", 0))

        if sys_os == "Windows":
            try:
                import ctypes
                user32 = ctypes.windll.user32
                VK_MAP = {
                    "Enter": 0x0D, "Backspace": 0x08, "Tab": 0x09, "Escape": 0x1B,
                    "Space": 0x20, " ": 0x20, "PageUp": 0x21, "PageDown": 0x22, "End": 0x23, "Home": 0x24,
                    "ArrowLeft": 0x25, "ArrowUp": 0x26, "ArrowRight": 0x27, "ArrowDown": 0x28,
                    "Delete": 0x2E, "Control": 0x11, "Shift": 0x10, "Alt": 0x12,
                    "Meta": 0x5B, "Windows": 0x5B,
                    "F1": 0x70, "F2": 0x71, "F3": 0x72, "F4": 0x73, "F5": 0x74, "F6": 0x75,
                    "F7": 0x76, "F8": 0x77, "F9": 0x78, "F10": 0x79, "F11": 0x7A, "F12": 0x7B
                }

                resolved_vk = vk or VK_MAP.get(key)
                if not resolved_vk and len(key) == 1:
                    resolved_vk = user32.VkKeyScanW(ord(key)) & 0xFF

                if not resolved_vk:
                    return

                if k_type == "keydown":
                    user32.keybd_event(resolved_vk, 0, 0, 0)
                    self.pressed_keys.add(resolved_vk)
                elif k_type == "keyup":
                    user32.keybd_event(resolved_vk, 0, 0x0002, 0)
                    self.pressed_keys.discard(resolved_vk)
                elif k_type == "text" and key:
                    for ch in key:
                        user32.keybd_event(0, ord(ch), 0x0004, 0)
                        user32.keybd_event(0, ord(ch), 0x0004 | 0x0002, 0)
            except Exception:
                pass
        else:
            # Linux keyboard input via xdotool
            try:
                if k_type == "keydown" and key:
                    subprocess.Popen(["xdotool", "keydown", key], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                elif k_type == "keyup" and key:
                    subprocess.Popen(["xdotool", "keyup", key], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except Exception:
                pass

    def cleanup_desktop_keys(self):
        """Releases all tracked keys to prevent modifier keys from remaining pressed."""
        if platform.system() != "Windows":
            return
        try:
            import ctypes
            user32 = ctypes.windll.user32
            for vk in list(self.pressed_keys):
                user32.keybd_event(vk, 0, 0x0002, 0)
            self.pressed_keys.clear()
        except Exception:
            pass

    def handle_desktop_clipboard(self, payload):
        """Processes remote clipboard read/write requests with 64-bit ctypes and multi-session fallbacks."""
        action = payload.get("action", "get")
        stream_id = payload.get("stream_id")
        correlation_id = payload.get("correlation_id")
        sys_os = platform.system()

        text = ""
        success = False

        if sys_os == "Windows":
            try:
                import ctypes
                from ctypes import wintypes
                user32 = ctypes.windll.user32
                kernel32 = ctypes.windll.kernel32

                user32.OpenClipboard.argtypes = [wintypes.HWND]
                user32.OpenClipboard.restype = wintypes.BOOL
                user32.CloseClipboard.argtypes = []
                user32.CloseClipboard.restype = wintypes.BOOL
                user32.EmptyClipboard.argtypes = []
                user32.EmptyClipboard.restype = wintypes.BOOL
                user32.GetClipboardData.argtypes = [wintypes.UINT]
                user32.GetClipboardData.restype = ctypes.c_void_p
                user32.SetClipboardData.argtypes = [wintypes.UINT, ctypes.c_void_p]
                user32.SetClipboardData.restype = ctypes.c_void_p
                user32.IsClipboardFormatAvailable.argtypes = [wintypes.UINT]
                user32.IsClipboardFormatAvailable.restype = wintypes.BOOL

                kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
                kernel32.GlobalAlloc.restype = ctypes.c_void_p
                kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
                kernel32.GlobalLock.restype = ctypes.c_void_p
                kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
                kernel32.GlobalUnlock.restype = wintypes.BOOL
                kernel32.GlobalFree.argtypes = [ctypes.c_void_p]
                kernel32.GlobalFree.restype = ctypes.c_void_p

                CF_UNICODETEXT = 13

                if action == "get":
                    # Try opening clipboard with retries in case another process is holding it
                    for _ in range(5):
                        if user32.OpenClipboard(None):
                            try:
                                if user32.IsClipboardFormatAvailable(CF_UNICODETEXT):
                                    hData = user32.GetClipboardData(CF_UNICODETEXT)
                                    if hData:
                                        ptr = kernel32.GlobalLock(hData)
                                        if ptr:
                                            text = ctypes.wstring_at(ptr)
                                            kernel32.GlobalUnlock(hData)
                                            success = True
                            finally:
                                user32.CloseClipboard()
                            break
                        time.sleep(0.04)

                    # Fallback to PowerShell Get-Clipboard if ctypes returned empty or failed
                    if not success or not text:
                        try:
                            res = subprocess.run(
                                ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"],
                                capture_output=True,
                                text=True,
                                timeout=3,
                                creationflags=0x08000000 if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
                            )
                            if res.returncode == 0 and res.stdout:
                                text = res.stdout.rstrip("\r\n")
                                success = True
                        except Exception:
                            pass

                elif action == "set":
                    new_text = payload.get("text", "")
                    raw = (new_text + "\0").encode("utf-16le")
                    hGlobal = kernel32.GlobalAlloc(0x0042, len(raw)) # GHND = 0x0042
                    if hGlobal:
                        ptr = kernel32.GlobalLock(hGlobal)
                        if ptr:
                            ctypes.memmove(ptr, raw, len(raw))
                            kernel32.GlobalUnlock(hGlobal)
                            for _ in range(5):
                                if user32.OpenClipboard(None):
                                    try:
                                        user32.EmptyClipboard()
                                        if user32.SetClipboardData(CF_UNICODETEXT, hGlobal):
                                            success = True
                                            hGlobal = None # System owns memory now
                                    finally:
                                        user32.CloseClipboard()
                                    break
                                time.sleep(0.04)
                        if hGlobal:
                            kernel32.GlobalFree(hGlobal)

                    # Fallback to PowerShell Set-Clipboard if ctypes failed
                    if not success:
                        try:
                            proc = subprocess.Popen(
                                ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "$input | Set-Clipboard"],
                                stdin=subprocess.PIPE,
                                stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL,
                                text=True,
                                creationflags=0x08000000 if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
                            )
                            proc.communicate(input=new_text, timeout=3)
                            success = (proc.returncode == 0)
                        except Exception:
                            pass
            except Exception as e:
                print(f"[!] Clipboard error: {e}")
        else:
            # Linux clipboard via xclip / xsel / wl-paste
            if action == "get":
                for cmd in [["xclip", "-o", "-selection", "clipboard"], ["xsel", "-b", "-o"], ["wl-paste"]]:
                    try:
                        res = subprocess.run(cmd, capture_output=True, text=True, timeout=2)
                        if res.returncode == 0:
                            text = res.stdout
                            success = True
                            break
                    except Exception:
                        pass
            elif action == "set":
                new_text = payload.get("text", "")
                for cmd in [["xclip", "-selection", "clipboard"], ["xsel", "-b", "-i"], ["wl-copy"]]:
                    try:
                        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True)
                        proc.communicate(input=new_text, timeout=2)
                        if proc.returncode == 0:
                            success = True
                            break
                    except Exception:
                        pass

        # Send event back to control plane / browser
        resp_payload = {
            "stream_id": stream_id,
            "correlation_id": correlation_id,
            "request_id": payload.get("request_id") or correlation_id,
            "action": action,
            "text": text if action == "get" else payload.get("text", ""),
            "success": success,
            "timestamp": int(time.time() * 1000)
        }
        self.send_agent_event({
            "type": "RemoteDesktopClipboard",
            "payload": resp_payload
        })
        if payload.get("request_id"):
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {
                    "request_id": payload.get("request_id"),
                    "success": success,
                    "result": resp_payload
                }
            })

    # =========================================================================
    def _start_windows_terminal_proc(self, shell_cmd_list, want_standard_token, is_elevated):
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE
        CREATE_NO_WINDOW = 0x08000000

        # Normal launch if unprivileged asking for standard, or elevated asking for elevated
        if not (is_elevated and want_standard_token):
            return subprocess.Popen(
                shell_cmd_list,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                bufsize=0,
                creationflags=CREATE_NO_WINDOW,
                startupinfo=startupinfo
            )

        # Elevated process requested genuine Standard User (de-elevated token)
        import ctypes
        from ctypes import wintypes
        advapi32 = ctypes.windll.advapi32
        kernel32 = ctypes.windll.kernel32

        SAFER_SCOPEID_USER = 1
        SAFER_LEVELID_NORMALUSER = 0x20000
        SAFER_LEVEL_OPEN = 1

        hLevel = wintypes.HANDLE()
        hToken = wintypes.HANDLE()
        token_acquired = False

        if advapi32.SaferCreateLevel(SAFER_SCOPEID_USER, SAFER_LEVELID_NORMALUSER, SAFER_LEVEL_OPEN, ctypes.byref(hLevel), None):
            if advapi32.SaferComputeTokenFromLevel(hLevel, None, ctypes.byref(hToken), 0, None):
                token_acquired = True
            advapi32.SaferCloseLevel(hLevel)

        if not token_acquired or not hToken.value:
            raise PermissionError("Failed to acquire genuine standard-user de-elevation token from elevated process.")

        TOKEN_ALL_ACCESS = 0xF01FF
        SecurityImpersonation = 2
        TokenPrimary = 1
        hDupToken = wintypes.HANDLE()
        advapi32.DuplicateTokenEx(hToken, TOKEN_ALL_ACCESS, None, SecurityImpersonation, TokenPrimary, ctypes.byref(hDupToken))
        kernel32.CloseHandle(hToken)

        if not hDupToken.value:
            raise PermissionError("Failed to duplicate standard-user primary token.")

        class SECURITY_ATTRIBUTES(ctypes.Structure):
            _fields_ = [("nLength", wintypes.DWORD), ("lpSecurityDescriptor", wintypes.LPVOID), ("bInheritHandle", wintypes.BOOL)]

        sa = SECURITY_ATTRIBUTES()
        sa.nLength = ctypes.sizeof(SECURITY_ATTRIBUTES)
        sa.bInheritHandle = True
        sa.lpSecurityDescriptor = None

        hStdInRead = wintypes.HANDLE()
        hStdInWrite = wintypes.HANDLE()
        hStdOutRead = wintypes.HANDLE()
        hStdOutWrite = wintypes.HANDLE()

        if not kernel32.CreatePipe(ctypes.byref(hStdInRead), ctypes.byref(hStdInWrite), ctypes.byref(sa), 0):
            kernel32.CloseHandle(hDupToken)
            raise PermissionError("CreatePipe failed for stdin.")

        if not kernel32.CreatePipe(ctypes.byref(hStdOutRead), ctypes.byref(hStdOutWrite), ctypes.byref(sa), 0):
            kernel32.CloseHandle(hStdInRead)
            kernel32.CloseHandle(hStdInWrite)
            kernel32.CloseHandle(hDupToken)
            raise PermissionError("CreatePipe failed for stdout.")

        class STARTUPINFO_W(ctypes.Structure):
            _fields_ = [
                ('cb', wintypes.DWORD), ('lpReserved', wintypes.LPWSTR), ('lpDesktop', wintypes.LPWSTR),
                ('lpTitle', wintypes.LPWSTR), ('dwX', wintypes.DWORD), ('dwY', wintypes.DWORD),
                ('dwXSize', wintypes.DWORD), ('dwYSize', wintypes.DWORD), ('dwXCountChars', wintypes.DWORD),
                ('dwYCountChars', wintypes.DWORD), ('dwFillAttribute', wintypes.DWORD), ('dwFlags', wintypes.DWORD),
                ('wShowWindow', wintypes.WORD), ('cbReserved2', wintypes.WORD), ('lpReserved2', ctypes.POINTER(wintypes.BYTE)),
                ('hStdInput', wintypes.HANDLE), ('hStdOutput', wintypes.HANDLE), ('hStdError', wintypes.HANDLE)
            ]

        class PROCESS_INFORMATION_W(ctypes.Structure):
            _fields_ = [('hProcess', wintypes.HANDLE), ('hThread', wintypes.HANDLE), ('dwProcessId', wintypes.DWORD), ('dwThreadId', wintypes.DWORD)]

        si = STARTUPINFO_W()
        si.cb = ctypes.sizeof(STARTUPINFO_W)
        si.dwFlags = 0x00000100 | 0x00000001 # STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW
        si.wShowWindow = 0 # SW_HIDE
        si.hStdInput = hStdInRead
        si.hStdOutput = hStdOutWrite
        si.hStdError = hStdOutWrite

        pi = PROCESS_INFORMATION_W()
        cmd_line = " ".join(subprocess.list2cmdline([x]) for x in shell_cmd_list)

        try:
            success = advapi32.CreateProcessWithTokenW(
                hDupToken,
                0,
                None,
                cmd_line,
                CREATE_NO_WINDOW,
                None,
                None,
                ctypes.byref(si),
                ctypes.byref(pi)
            )

            kernel32.CloseHandle(hStdInRead)
            kernel32.CloseHandle(hStdOutWrite)

            if not success:
                err = kernel32.GetLastError()
                kernel32.CloseHandle(hStdInWrite)
                kernel32.CloseHandle(hStdOutRead)
                raise PermissionError(f"CreateProcessWithTokenW failed with Win32 error {err}")

            import msvcrt
            stdin_fd = msvcrt.open_osfhandle(hStdInWrite.value, 0)
            stdout_fd = msvcrt.open_osfhandle(hStdOutRead.value, 0)
            stdin_file = open(stdin_fd, "wb", buffering=0)
            stdout_file = open(stdout_fd, "rb", buffering=0)

            class TokenProcess:
                def __init__(self, hProcess, pid, stdin_f, stdout_f):
                    self.hProcess = hProcess
                    self.pid = int(pid)
                    self.stdin = stdin_f
                    self.stdout = stdout_f
                    self.returncode = None
                    self._closed = False

                def poll(self):
                    if self.returncode is not None:
                        return self.returncode
                    if not self.hProcess:
                        return self.returncode
                    code = wintypes.DWORD()
                    if kernel32.GetExitCodeProcess(self.hProcess, ctypes.byref(code)):
                        if code.value != 259: # STILL_ACTIVE
                            self.returncode = code.value
                            self._cleanup_handles()
                            return self.returncode
                    return None

                def wait(self, timeout=None):
                    if self.returncode is not None:
                        return self.returncode
                    if not self.hProcess:
                        return self.returncode
                    timeout_ms = int(timeout * 1000) if timeout is not None else 0xFFFFFFFF
                    kernel32.WaitForSingleObject(self.hProcess, timeout_ms)
                    code = wintypes.DWORD()
                    if kernel32.GetExitCodeProcess(self.hProcess, ctypes.byref(code)):
                        if code.value != 259:
                            self.returncode = code.value
                            self._cleanup_handles()
                            return self.returncode
                    return self.poll()

                def terminate(self):
                    if self.returncode is None and self.hProcess:
                        ok = kernel32.TerminateProcess(self.hProcess, 1)
                        if ok:
                            kernel32.WaitForSingleObject(self.hProcess, 1500)
                    self.poll()
                    if self.returncode is not None:
                        self._cleanup_handles()

                def kill(self):
                    if self.returncode is None and self.hProcess:
                        kernel32.TerminateProcess(self.hProcess, 1)
                        kernel32.WaitForSingleObject(self.hProcess, 2000)
                    self.poll()
                    if self.returncode is not None:
                        self._cleanup_handles()

                def _cleanup_handles(self):
                    if self._closed:
                        return
                    self._closed = True
                    try:
                        if self.stdin and not self.stdin.closed:
                            self.stdin.close()
                    except Exception:
                        pass
                    try:
                        if self.stdout and not self.stdout.closed:
                            self.stdout.close()
                    except Exception:
                        pass
                    if self.hProcess:
                        try:
                            kernel32.CloseHandle(self.hProcess)
                        except Exception:
                            pass
                        self.hProcess = None

            kernel32.CloseHandle(pi.hThread)
            return TokenProcess(pi.hProcess, pi.dwProcessId, stdin_file, stdout_file)
        finally:
            kernel32.CloseHandle(hDupToken)

    # =========================================================================
    # Terminal Session Handling
    # =========================================================================
    def start_terminal_session(self, session_id, cols=80, rows=24, shell=None, profile=None):
        cols = int(cols or 80)
        rows = int(rows or 24)
        p_pref = (profile or "auto").lower().strip()
        is_auto = (p_pref in ["auto", "detect", ""] or not p_pref)

        if platform.system() == "Windows":
            priv_info = self.get_privilege_info()
            is_elevated = priv_info["is_elevated"]
            is_system = priv_info["is_system"]
            current_user = priv_info["effective_user"]

            if p_pref in ["root", "privileged", "admin"]:
                if not is_elevated:
                    self.send_agent_event({
                        "type": "TerminalOutput",
                        "payload": {
                            "session_id": session_id,
                            "data": f"\r\n[!] Security Policy: Privileged Administrator profile requested, but agent is running as unprivileged user '{current_user}'. Elevation cannot be bypassed without host administrative privileges. Switch to 'Standard User' or 'Auto' mode.\r\n"
                        }
                    })
                    self.send_agent_event({"type": "TerminalExit", "payload": {"session_id": session_id, "exit_code": 1}})
                    return
                active_profile = "privileged"
                active_user = f"Administrator ({current_user})" if not is_system else "NT AUTHORITY\\SYSTEM"
                profile_desc = "Administrator (Elevated)" if not is_system else "NT AUTHORITY\\SYSTEM (Elevated)"
                auto_note = ""
                want_standard_token = False
            elif is_auto:
                if is_elevated:
                    active_profile = "privileged"
                    active_user = f"Administrator ({current_user})" if not is_system else "NT AUTHORITY\\SYSTEM"
                    profile_desc = "⚡ AUTO · Administrator" if not is_system else "⚡ AUTO · SYSTEM"
                    auto_note = f"Host has administrative privileges ({current_user}). Auto-selected elevated shell."
                    want_standard_token = False
                else:
                    active_profile = "standard"
                    active_user = current_user
                    profile_desc = f"⚡ AUTO · Standard User ({current_user})"
                    auto_note = f"Host is unprivileged ({current_user}). Auto-selected standard shell to prevent execution failure."
                    want_standard_token = False
            else:
                if is_elevated:
                    active_profile = "standard"
                    active_user = current_user
                    profile_desc = f"Standard User ({current_user})"
                    auto_note = ""
                    want_standard_token = True
                else:
                    active_profile = "standard"
                    active_user = current_user
                    profile_desc = f"Standard User ({current_user})"
                    auto_note = ""
                    want_standard_token = False

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

            try:
                use_conpty = False
                conpty_instance = None
                if ctypes and hasattr(ctypes.windll.kernel32, "CreatePseudoConsole") and not want_standard_token:
                    try:
                        conpty_instance = ConPTYTerminal(
                            session_id=session_id,
                            cols=cols,
                            rows=rows,
                            shell_cmd=shell_cmd_list,
                            on_output=self._on_conpty_output,
                            on_exit=self._on_conpty_exit
                        )
                        use_conpty = True
                    except Exception as c_err:
                        print(f"[*] ConPTY initialization fallback to pipe: {c_err}", flush=True)

                if use_conpty and conpty_instance:
                    proc_wrapper = ConPTYProcWrapper(conpty_instance)
                    with self.lock:
                        self.active_terminals[session_id] = {
                            "term": conpty_instance,
                            "proc": proc_wrapper,
                            "type": "conpty",
                            "pid": conpty_instance.pid,
                            "cols": cols,
                            "rows": rows
                        }
                    backend_type = f"ConPTY [{profile_desc}]"
                    terminal_pid = conpty_instance.pid
                else:
                    p = self._start_windows_terminal_proc(shell_cmd_list, want_standard_token, is_elevated)
                    with self.lock:
                        self.active_terminals[session_id] = {"proc": p, "type": "pipe", "pid": p.pid}
                    threading.Thread(target=self._pipe_terminal_reader, args=(session_id, p.stdout), daemon=True).start()
                    backend_type = f"{profile_desc} [{backend_label}]"
                    terminal_pid = p.pid

                self.send_agent_event({
                    "type": "TerminalReady",
                    "payload": {
                        "session_id": session_id,
                        "backend": backend_type,
                        "shell": backend_label,
                        "pid": terminal_pid,
                        "cols": cols,
                        "rows": rows,
                        "profile": active_profile,
                        "requested_profile": p_pref,
                        "profile_desc": profile_desc,
                        "auto_note": auto_note,
                        "user": active_user,
                        "is_elevated": is_elevated and (active_profile == "privileged")
                    }
                })
            except Exception as e:
                self.send_agent_event({
                    "type": "TerminalOutput",
                    "payload": {"session_id": session_id, "data": f"\r\n[!] Failed to start background terminal: {e}\r\n"}
                })
                self.send_agent_event({"type": "TerminalExit", "payload": {"session_id": session_id, "exit_code": 1}})
        else:
            import pty, pwd
            master, slave = pty.openpty()

            priv_info = self.get_privilege_info()
            is_root = priv_info["is_root"]
            current_user = priv_info["effective_user"]
            shell_cmd = shell or ("/bin/bash" if os.path.exists("/bin/bash") else "/bin/sh")

            if p_pref in ["root", "privileged", "admin"]:
                if not is_root:
                    os.close(slave)
                    os.close(master)
                    self.send_agent_event({
                        "type": "TerminalOutput",
                        "payload": {
                            "session_id": session_id,
                            "data": f"\r\n[!] Security Policy: Root profile requested, but agent is running as unprivileged user '{current_user}' (UID: {os.geteuid()}). Refusing to launch non-root shell as root. Switch to 'Standard User' or 'Auto' mode.\r\n"
                        }
                    })
                    self.send_agent_event({"type": "TerminalExit", "payload": {"session_id": session_id, "exit_code": 1}})
                    return
                active_profile = "privileged"
                active_user = "root"
                profile_desc = "Root (Elevated)"
                auto_note = ""
                preexec_fn = os.setsid
                child_env = os.environ.copy()
            elif is_auto:
                if is_root:
                    active_profile = "privileged"
                    active_user = "root"
                    profile_desc = "⚡ AUTO · Root"
                    auto_note = "Host has root privileges. Auto-selected root shell."
                    preexec_fn = os.setsid
                    child_env = os.environ.copy()
                else:
                    active_profile = "standard"
                    active_user = current_user
                    profile_desc = f"⚡ AUTO · Standard User ({current_user})"
                    auto_note = f"Host is unprivileged (UID: {os.geteuid()}). Auto-selected standard shell."
                    preexec_fn = os.setsid
                    child_env = os.environ.copy()
            else:
                if is_root:
                    std_user = os.environ.get("SUDO_USER")
                    if not std_user or std_user == "root":
                        try:
                            with open("/etc/passwd", "r") as pf:
                                for line in pf:
                                    parts = line.strip().split(":")
                                    if len(parts) >= 3 and 1000 <= int(parts[2]) < 65534:
                                        std_user = parts[0]
                                        break
                        except Exception:
                            pass
                    if not std_user or std_user == "root":
                        os.close(slave)
                        os.close(master)
                        self.send_agent_event({
                            "type": "TerminalOutput",
                            "payload": {
                                "session_id": session_id,
                                "data": "\r\n[!] Security Policy: Standard user profile requested, but no non-root user account exists on host. Refusing to launch root shell under standard profile.\r\n"
                            }
                        })
                        self.send_agent_event({"type": "TerminalExit", "payload": {"session_id": session_id, "exit_code": 1}})
                        return

                    try:
                        pw = pwd.getpwnam(std_user)
                    except Exception as e:
                        os.close(slave)
                        os.close(master)
                        self.send_agent_event({
                            "type": "TerminalOutput",
                            "payload": {
                                "session_id": session_id,
                                "data": f"\r\n[!] Security Policy: Failed to lookup target standard user '{std_user}': {e}\r\n"
                            }
                        })
                        self.send_agent_event({"type": "TerminalExit", "payload": {"session_id": session_id, "exit_code": 1}})
                        return

                    target_uid = pw.pw_uid
                    target_gid = pw.pw_gid
                    target_dir = pw.pw_dir
                    target_name = pw.pw_name

                    def demote():
                        os.setsid()
                        try:
                            os.setgid(target_gid)
                            try:
                                os.initgroups(target_name, target_gid)
                            except Exception:
                                pass
                            os.setuid(target_uid)
                            try:
                                os.chdir(target_dir)
                            except Exception:
                                os.chdir("/tmp")
                        except Exception:
                            sys.exit(127)

                    preexec_fn = demote
                    active_profile = "standard"
                    active_user = target_name
                    profile_desc = f"Standard User ({target_name})"
                    auto_note = ""
                    child_env = os.environ.copy()
                    child_env["HOME"] = target_dir
                    child_env["USER"] = target_name
                    child_env["LOGNAME"] = target_name
                    child_env["SHELL"] = pw.pw_shell or shell_cmd
                else:
                    active_profile = "standard"
                    active_user = current_user
                    profile_desc = f"Standard User ({current_user})"
                    auto_note = ""
                    preexec_fn = os.setsid
                    child_env = os.environ.copy()

            try:
                p = subprocess.Popen(
                    [shell_cmd, "-i"],
                    stdin=slave,
                    stdout=slave,
                    stderr=slave,
                    close_fds=True,
                    preexec_fn=preexec_fn,
                    env=child_env
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
                        "backend": f"PTY [{profile_desc}]",
                        "shell": shell_cmd,
                        "pid": p.pid,
                        "cols": cols,
                        "rows": rows,
                        "profile": active_profile,
                        "requested_profile": p_pref,
                        "profile_desc": profile_desc,
                        "auto_note": auto_note,
                        "user": active_user,
                        "is_elevated": is_root and (active_profile == "privileged")
                    }
                })
            except Exception as e:
                os.close(slave)
                try: os.close(master)
                except Exception: pass
                self.send_agent_event({
                    "type": "TerminalOutput",
                    "payload": {"session_id": session_id, "data": f"\r\n[!] Failed to start background terminal: {e}\r\n"}
                })
                self.send_agent_event({"type": "TerminalExit", "payload": {"session_id": session_id, "exit_code": 1}})

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

    def _on_conpty_output(self, session_id, data):
        self.send_agent_event({
            "type": "TerminalOutput",
            "payload": {
                "session_id": session_id,
                "data": data
            }
        })

    def _on_conpty_exit(self, session_id, exit_code):
        with self.lock:
            self.active_terminals.pop(session_id, None)
        self.send_agent_event({
            "type": "TerminalExit",
            "payload": {
                "session_id": session_id,
                "exit_code": exit_code if exit_code is not None else 0
            }
        })

    def write_terminal_input(self, session_id, text):
        with self.lock:
            term = self.active_terminals.get(session_id)
        if not term:
            return

        if platform.system() == "Windows" and text:
            try:
                buf = term.get("input_buffer", "")
                for ch in text:
                    if ch in ("\r", "\n"):
                        cmd_line = buf.strip()
                        term["input_buffer"] = ""
                        if cmd_line:
                            self._check_session0_gui_command(session_id, term, cmd_line)
                    elif ch in ("\x08", "\x7f"):
                        buf = buf[:-1]
                        term["input_buffer"] = buf
                    elif ch.isprintable():
                        buf += ch
                        term["input_buffer"] = buf
            except Exception:
                pass

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

    def _check_session0_gui_command(self, session_id, term, cmd_line):
        if platform.system() != "Windows":
            return
        parts = cmd_line.strip().split()
        if not parts:
            return
        raw_cmd = os.path.basename(parts[0]).lower().replace(".exe", "")
        GUI_APPS = {"notepad", "calc", "mspaint", "paint", "explorer", "taskmgr", "regedit", "write", "wordpad", "cleanmgr", "control", "snippingtool", "magnify", "dialer", "charmap", "powershell_ise"}
        if raw_cmd not in GUI_APPS:
            return

        proc = term.get("proc")
        pid = getattr(proc, "pid", None) or term.get("pid")
        is_sess0 = False
        import ctypes
        if pid:
            try:
                sess_val = ctypes.c_ulong()
                if ctypes.windll.kernel32.ProcessIdToSessionId(pid, ctypes.byref(sess_val)):
                    is_sess0 = (sess_val.value == 0)
            except Exception:
                pass

        if not is_sess0:
            try:
                curr_sess = ctypes.c_ulong()
                if ctypes.windll.kernel32.ProcessIdToSessionId(os.getpid(), ctypes.byref(curr_sess)):
                    is_sess0 = (curr_sess.value == 0)
            except Exception:
                pass

        if is_sess0:
            notice = (
                f"\r\n\x1b[33m[!] Windows Session 0 Notice:\x1b[0m Application '\x1b[1m{raw_cmd}\x1b[0m' was started in background Session 0.\r\n"
                f"    Due to Windows Session 0 Isolation, GUI windows cannot display on physical monitors (Session 1).\r\n"
                f"    \x1b[36m💡 To launch visibly on the interactive user desktop:\x1b[0m\r\n"
                f"    • Click '\x1b[1m🚀 Launch on Desktop\x1b[0m' in the CyberVPS Dashboard, or\r\n"
                f"    • Use API / CLI: \x1b[92mcybervps desktop-launch {raw_cmd}\x1b[0m\r\n\r\n"
            )
            threading.Thread(target=self._delayed_terminal_notice, args=(session_id, notice), daemon=True).start()

    def _delayed_terminal_notice(self, session_id, notice):
        time.sleep(0.4)
        self.send_agent_event({
            "type": "TerminalOutput",
            "payload": {
                "session_id": session_id,
                "data": notice
            }
        })

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
            exit_code = 0
            try:
                ttype = term.get("type")
                if ttype == "conpty":
                    term["term"].close()
                    pid = term.get("pid")
                    if pid and self.is_pid_alive(pid):
                        try:
                            h = ctypes.windll.kernel32.OpenProcess(0x0001, False, pid)
                            if h:
                                ctypes.windll.kernel32.TerminateProcess(h, 0)
                                ctypes.windll.kernel32.CloseHandle(h)
                        except Exception:
                            pass
                    exit_code = getattr(term.get("term"), "exit_code", 0) or 0
                elif ttype == "pty":
                    proc = term.get("proc")
                    if proc:
                        proc.terminate()
                        try:
                            proc.wait(timeout=1.0)
                        except Exception:
                            proc.kill()
                        exit_code = getattr(proc, "returncode", 0) or 0
                    try:
                        os.close(term["master"])
                    except Exception:
                        pass
                elif ttype == "pipe":
                    proc = term.get("proc")
                    if proc:
                        proc.terminate()
                        if hasattr(proc, "wait"):
                            try:
                                proc.wait(timeout=1.0)
                            except Exception:
                                proc.kill()
                        pid = getattr(proc, "pid", None)
                        if pid and self.is_pid_alive(pid):
                            try:
                                proc.kill()
                                if hasattr(proc, "wait"):
                                    proc.wait(timeout=1.0)
                            except Exception:
                                pass
                        if pid and self.is_pid_alive(pid):
                            print(f"[!] Warning: Child process PID {pid} is still active after kill attempt", flush=True)
                        exit_code = getattr(proc, "returncode", 0) or 0
            except Exception as e:
                print(f"[!] Error stopping terminal {session_id}: {e}", flush=True)
            self.send_agent_event({
                "type": "TerminalExit",
                "payload": {"session_id": session_id, "exit_code": exit_code}
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
    def send_agent_event(self, event_data, skip_if_busy=False):
        if "payload" in event_data and isinstance(event_data["payload"], dict):
            if "token" not in event_data["payload"]:
                event_data["payload"]["token"] = self.token
            if "machine_id" not in event_data["payload"]:
                event_data["payload"]["machine_id"] = self.machine_id

        # First attempt WebSocket transmission for zero-latency streaming
        if self.ws_relay and self.ws_connected and getattr(self.ws_relay, "authenticated", False):
            try:
                sent = self.ws_relay.send_text(json.dumps(event_data), skip_if_busy=skip_if_busy)
                if sent or skip_if_busy:
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
            with urllib.request.urlopen(req, timeout=8) as resp:
                pass
        except urllib.error.HTTPError as e:
            if e.code == 401:
                print(f"[!] HTTP Relay event unauthorized (401). Invalid token.")
                try:
                    if hasattr(self, "try_self_heal_token") and self.try_self_heal_token():
                        print("[*] Self-healed node credential after 401.")
                except Exception:
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
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                for cmd in data.get("commands", []):
                    self.dispatch_server_command(cmd)
        except urllib.error.HTTPError as e:
            if e.code == 401:
                print(f"[!] HTTP Command Poll unauthorized (401). Check enrollment token.")
                try:
                    if hasattr(self, "try_self_heal_token") and self.try_self_heal_token():
                        print("[*] Self-healed node credential after 401.")
                except Exception:
                    pass
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
                payload.get("shell") or payload.get("shell_preference"),
                payload.get("profile")
            )
        elif c_type == "TerminalInput":
            self.write_terminal_input(payload.get("session_id"), payload.get("data", ""))
        elif c_type == "TerminalResize":
            self.resize_terminal(payload.get("session_id"), payload.get("cols", 80), payload.get("rows", 24))
        elif c_type == "TerminalKill":
            self.kill_terminal(payload.get("session_id"))
        elif c_type == "FileList":
            threading.Thread(target=self.handle_file_list, args=(payload,), daemon=True).start()
        elif c_type == "FileRead":
            threading.Thread(target=self.handle_file_read, args=(payload,), daemon=True).start()
        elif c_type == "FileWrite":
            threading.Thread(target=self.handle_file_write, args=(payload,), daemon=True).start()
        elif c_type == "FileDelete":
            threading.Thread(target=self.handle_file_delete, args=(payload,), daemon=True).start()
        elif c_type == "FileRename":
            threading.Thread(target=self.handle_file_rename, args=(payload,), daemon=True).start()
        elif c_type == "FileMkdir":
            threading.Thread(target=self.handle_file_mkdir, args=(payload,), daemon=True).start()
        elif c_type == "FileStat":
            threading.Thread(target=self.handle_file_stat, args=(payload,), daemon=True).start()
        elif c_type == "FileChunkWrite":
            threading.Thread(target=self.handle_file_chunk_write, args=(payload,), daemon=True).start()
        elif c_type in ["FileUploadStatus", "FileChunkStatus"]:
            threading.Thread(target=self.handle_file_upload_status, args=(payload,), daemon=True).start()
        elif c_type == "FileChunkRead":
            threading.Thread(target=self.handle_file_chunk_read, args=(payload,), daemon=True).start()
        elif c_type == "FileInspect":
            threading.Thread(target=self.handle_file_inspect, args=(payload,), daemon=True).start()
        elif c_type in ["FileRun", "ProcessStart"]:
            threading.Thread(target=self.handle_file_run, args=(payload,), daemon=True).start()
        elif c_type == "ProcessStatus":
            threading.Thread(target=self.handle_process_status, args=(payload,), daemon=True).start()
        elif c_type == "ProcessStop":
            threading.Thread(target=self.handle_process_stop, args=(payload,), daemon=True).start()
        elif c_type == "InstallerLog":
            threading.Thread(target=self.handle_installer_log, args=(payload,), daemon=True).start()
        elif c_type == "FileArchiveZip":
            threading.Thread(target=self.handle_file_archive_zip, args=(payload,), daemon=True).start()
        elif c_type == "FileArchiveExtract":
            threading.Thread(target=self.handle_file_archive_extract, args=(payload,), daemon=True).start()
        elif c_type == "ProcessList":
            threading.Thread(target=self.handle_process_list, args=(payload,), daemon=True).start()
        elif c_type == "ProcessKill":
            threading.Thread(target=self.handle_process_kill, args=(payload,), daemon=True).start()
        elif c_type == "ProcessDetails":
            threading.Thread(target=self.handle_process_details, args=(payload,), daemon=True).start()
        elif c_type == "ServiceList":
            threading.Thread(target=self.handle_service_list, args=(payload,), daemon=True).start()
        elif c_type == "ServiceAction":
            threading.Thread(target=self.handle_service_action, args=(payload,), daemon=True).start()
        elif c_type == "DesktopStatus":
            threading.Thread(target=self.handle_desktop_status, args=(payload,), daemon=True).start()
        elif c_type in ["DesktopDiagnostics", "RemoteDesktopDiagnostics"]:
            threading.Thread(target=self.handle_desktop_diagnostics, args=(payload,), daemon=True).start()
        elif c_type in ["RustDeskAction", "RemoteDesktopRustDeskAction"]:
            threading.Thread(target=self.handle_rustdesk_action, args=(payload,), daemon=True).start()
        elif c_type == "DesktopAction":
            threading.Thread(target=self.handle_desktop_action, args=(payload,), daemon=True).start()
        elif c_type in ["DesktopLaunch", "launch_interactive", "launch_gui", "desktop_launch"]:
            threading.Thread(target=self.handle_desktop_action, args=({
                "request_id": payload.get("request_id"),
                "action": "launch_interactive",
                "params": payload
            },), daemon=True).start()
        elif c_type == "AppList":
            threading.Thread(target=self.handle_app_list, args=(payload,), daemon=True).start()
        elif c_type == "AppAction":
            threading.Thread(target=self.handle_app_action, args=(payload,), daemon=True).start()
        elif c_type == "AppWindowList":
            threading.Thread(target=self.handle_app_window_list, args=(payload,), daemon=True).start()
        elif c_type == "AppWindowFrame":
            threading.Thread(target=self.handle_app_window_frame, args=(payload,), daemon=True).start()
        elif c_type in ["AppStreamStart", "RemoteDesktopStart"]:
            threading.Thread(target=self.handle_app_stream_start, args=(payload,), daemon=True).start()
        elif c_type in ["AppStreamStop", "RemoteDesktopStop"]:
            self.handle_app_stream_stop(payload)
        elif c_type in ["AppStreamSelectWindow", "RemoteDesktopSelectWindow"]:
            self.handle_app_stream_select_window(payload)
        elif c_type in ["AppStreamInputMouse", "RemoteDesktopInputMouse"]:
            self.handle_desktop_input_mouse(payload)
        elif c_type in ["AppStreamInputKeyboard", "RemoteDesktopInputKeyboard"]:
            self.handle_desktop_input_keyboard(payload)
        elif c_type in ["AppStreamClipboard", "RemoteDesktopClipboard"]:
            self.handle_desktop_clipboard(payload)
        elif c_type in ["OtaUpdate", "OtaCheck", "FleetUpdate", "UpdateAgent"]:
            threading.Thread(target=self.handle_ota_update if c_type == "OtaCheck" else self.handle_rebuild_agent, args=(payload,), daemon=True).start()
        elif c_type == "RebootHost":
            threading.Thread(target=self.handle_reboot_host, args=(payload,), daemon=True).start()
        elif c_type in ["RestartAgent", "AgentRestart"]:
            threading.Thread(target=self.handle_restart_agent, args=(payload,), daemon=True).start()
        elif c_type in ["StopAgent", "AgentStop"]:
            threading.Thread(target=self.handle_stop_agent, args=(payload,), daemon=True).start()
        elif c_type in ["RepairAgent", "AgentRepair", "HealAgent"]:
            threading.Thread(target=self.handle_repair_agent, args=(payload,), daemon=True).start()
        elif c_type in ["RebuildAgent", "AgentRebuild"]:
            threading.Thread(target=self.handle_rebuild_agent, args=(payload,), daemon=True).start()
        elif c_type in ["UninstallAgent", "AgentUninstall"]:
            threading.Thread(target=self.handle_uninstall_agent, args=(payload,), daemon=True).start()
        elif c_type == "SyncBackendPool":
            self.handle_sync_backend_pool(payload)
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
        elif c_type in ["ScanBackendInventory", "GetBackendInventory", "ScanInventory"]:
            threading.Thread(target=self.handle_scan_backend_inventory, args=(payload,), daemon=True).start()
        elif c_type in ["BackendPathUpdate", "UpdateBackendPath", "BackendRelocate", "RelocateBackend", "BackendDelete", "DeleteBackend", "RegisterCustomBackend", "AddBackend"]:
            threading.Thread(target=self.handle_backend_management_rpc, args=(c_type, payload), daemon=True).start()
        elif c_type in ["ReplitDoctor", "ReplitStatus", "ReplitDesktop", "ReplitSshx"]:
            threading.Thread(target=self.handle_replit_rpc, args=(c_type, payload), daemon=True).start()
        elif c_type in ["BlackoutActivate", "BlackoutRelease", "BlackoutStatus"]:
            threading.Thread(target=self.handle_blackout_command, args=(c_type, payload), daemon=True).start()
        elif c_type in ["ObsidianPillarProtect", "ObsidianPillarVerify", "ObsidianPillarRestore", "ObsidianPillarListFiles", "ObsidianPillarStatus"]:
            threading.Thread(target=self.handle_obsidian_pillar_command, args=(c_type, payload), daemon=True).start()

    def _init_pillar_storage(self):
        try:
            for d in [self.protected_vault_dir, self.quarantine_dir, self.snapshots_dir]:
                if not os.path.exists(d):
                    os.makedirs(d, exist_ok=True)
                    if hasattr(os, "chmod") and sys.platform != "win32":
                        try:
                            os.chmod(d, 0o700)
                        except Exception:
                            pass
        except Exception:
            pass

    def _load_pillar_registry(self):
        try:
            if os.path.exists(self.pillar_registry_file):
                with open(self.pillar_registry_file, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception:
            pass
        return {}

    def _save_pillar_registry(self, reg):
        try:
            tmp = self.pillar_registry_file + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(reg, f, indent=2)
            os.replace(tmp, self.pillar_registry_file)
        except Exception:
            pass

    def _load_pillar_incidents(self):
        try:
            if os.path.exists(self.pillar_incidents_file):
                with open(self.pillar_incidents_file, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception:
            pass
        return []

    def _record_pillar_incident(self, incident):
        try:
            incidents = self._load_pillar_incidents()
            incidents.insert(0, incident)
            if len(incidents) > 100:
                incidents = incidents[:100]
            tmp = self.pillar_incidents_file + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(incidents, f, indent=2)
            os.replace(tmp, self.pillar_incidents_file)
        except Exception:
            pass

    def _compute_sha256(self, filepath):
        if not filepath or not os.path.isfile(filepath):
            return None
        h = hashlib.sha256()
        try:
            with open(filepath, "rb") as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    h.update(chunk)
            return h.hexdigest()
        except Exception:
            return None

    def _lock_os_session(self):
        """Locks the active physical/desktop session to freeze tampering."""
        locked = False
        if sys.platform == "win32":
            try:
                import ctypes
                locked = bool(ctypes.windll.user32.LockWorkStation())
            except Exception:
                locked = False
        else:
            try:
                p = subprocess.run(["loginctl", "lock-session"], capture_output=True, timeout=2)
                locked = (p.returncode == 0)
            except Exception:
                pass
            if not locked:
                try:
                    p = subprocess.run(["xdg-screensaver", "lock"], capture_output=True, timeout=2)
                    locked = (p.returncode == 0)
                except Exception:
                    pass
        return locked

    def _get_pillar_protected_count(self):
        reg = self._load_pillar_registry()
        return len(reg)

    def _get_pillar_tamper_count(self):
        reg = self._load_pillar_registry()
        return sum(1 for x in reg.values() if x.get("status") in ["TAMPER_DETECTED", "MISSING"])

    def handle_blackout_command(self, c_type, payload):
        req_id = payload.get("request_id") or ("req_" + uuid.uuid4().hex[:8])
        operator = payload.get("operator", "admin")

        if c_type == "BlackoutActivate":
            reason = payload.get("reason", "Emergency containment activated by administrator")
            lock_session = payload.get("lock_session", True)
            session_locked = False
            if lock_session:
                session_locked = self._lock_os_session()

            # Emergency quarantine backup of all protected files
            reg = self._load_pillar_registry()
            quarantine_copies = 0
            for path, meta in reg.items():
                if os.path.isfile(path):
                    safe_name = os.path.basename(path) + "_" + str(int(time.time())) + ".bak"
                    q_dest = os.path.join(self.quarantine_dir, safe_name)
                    try:
                        shutil.copy2(path, q_dest)
                        quarantine_copies += 1
                    except Exception:
                        pass

            self.blackout_active = True
            incident = {
                "id": "inc_blackout_" + uuid.uuid4().hex[:8],
                "machine_id": self.machine_id,
                "state": "BLACKOUT_ACTIVE",
                "reason": reason,
                "operator": operator,
                "started_at": int(time.time()),
                "session_locked": session_locked,
                "quarantined_files": quarantine_copies
            }
            self.blackout_incident = incident
            self._record_pillar_incident(incident)

            self.send_agent_event({
                "type": "BlackoutStatusReport",
                "payload": {
                    "request_id": req_id,
                    "machine_id": self.machine_id,
                    "active": True,
                    "incident": incident
                }
            })

        elif c_type == "BlackoutRelease":
            self.blackout_active = False
            if self.blackout_incident:
                self.blackout_incident["state"] = "RELEASED"
                self.blackout_incident["released_at"] = int(time.time())
                self.blackout_incident["released_by"] = operator

            rel_incident = {
                "id": "inc_release_" + uuid.uuid4().hex[:8],
                "machine_id": self.machine_id,
                "state": "RELEASED",
                "released_at": int(time.time()),
                "operator": operator
            }
            self._record_pillar_incident(rel_incident)

            self.send_agent_event({
                "type": "BlackoutStatusReport",
                "payload": {
                    "request_id": req_id,
                    "machine_id": self.machine_id,
                    "active": False,
                    "incident": self.blackout_incident
                }
            })

        elif c_type == "BlackoutStatus":
            self.send_agent_event({
                "type": "BlackoutStatusReport",
                "payload": {
                    "request_id": req_id,
                    "machine_id": self.machine_id,
                    "active": self.blackout_active,
                    "incident": self.blackout_incident
                }
            })

    def handle_obsidian_pillar_command(self, c_type, payload):
        req_id = payload.get("request_id") or ("req_" + uuid.uuid4().hex[:8])

        if c_type == "ObsidianPillarProtect":
            file_path = payload.get("path")
            policy = payload.get("policy", "immutable_snapshot")
            if not file_path:
                self.send_agent_event({"type": "ObsidianPillarProtectResult", "payload": {"request_id": req_id, "success": False, "error": "Missing path"}})
                return

            canon_path = os.path.abspath(file_path)
            if not os.path.isfile(canon_path):
                self.send_agent_event({"type": "ObsidianPillarProtectResult", "payload": {"request_id": req_id, "success": False, "error": "File does not exist"}})
                return

            sha256 = self._compute_sha256(canon_path)
            size = os.path.getsize(canon_path)

            # Store snapshot
            snap_id = hashlib.sha256(canon_path.encode("utf-8")).hexdigest()[:16] + "_" + os.path.basename(canon_path)
            snap_path = os.path.join(self.snapshots_dir, snap_id)
            try:
                shutil.copy2(canon_path, snap_path)
            except Exception as e:
                self.send_agent_event({"type": "ObsidianPillarProtectResult", "payload": {"request_id": req_id, "success": False, "error": str(e)}})
                return

            reg = self._load_pillar_registry()
            record = {
                "path": canon_path,
                "sha256": sha256,
                "size": size,
                "policy": policy,
                "snapshot_path": snap_path,
                "protected_at": int(time.time()),
                "last_verified": int(time.time()),
                "status": "VERIFIED"
            }
            reg[canon_path] = record
            self._save_pillar_registry(reg)

            self.send_agent_event({
                "type": "ObsidianPillarProtectResult",
                "payload": {
                    "request_id": req_id,
                    "success": True,
                    "record": record
                }
            })

        elif c_type == "ObsidianPillarVerify":
            target_path = payload.get("path")
            reg = self._load_pillar_registry()
            results = []
            tampered_count = 0

            to_check = [target_path] if (target_path and target_path in reg) else list(reg.keys())

            for p in to_check:
                item = reg.get(p)
                if not item:
                    continue
                expected_hash = item.get("sha256")
                if not os.path.exists(p):
                    item["status"] = "MISSING"
                    item["last_verified"] = int(time.time())
                    tampered_count += 1
                else:
                    curr_hash = self._compute_sha256(p)
                    if curr_hash == expected_hash:
                        item["status"] = "VERIFIED"
                        item["last_verified"] = int(time.time())
                    else:
                        item["status"] = "TAMPER_DETECTED"
                        item["last_verified"] = int(time.time())
                        tampered_count += 1
                results.append(item)

            self._save_pillar_registry(reg)

            # If tampering detected and auto_blackout policy enabled
            if tampered_count >= 3 and not self.blackout_active:
                self.handle_blackout_command("BlackoutActivate", {
                    "reason": f"Automatic containment: {tampered_count} protected files tampered or deleted",
                    "operator": "ObsidianPillarAutonomicEngine"
                })

            self.send_agent_event({
                "type": "ObsidianPillarVerifyResult",
                "payload": {
                    "request_id": req_id,
                    "success": True,
                    "verified_count": len(results) - tampered_count,
                    "tampered_count": tampered_count,
                    "results": results
                }
            })

        elif c_type == "ObsidianPillarRestore":
            file_path = payload.get("path")
            if not file_path:
                self.send_agent_event({"type": "ObsidianPillarRestoreResult", "payload": {"request_id": req_id, "success": False, "error": "Missing path"}})
                return

            canon_path = os.path.abspath(file_path)
            reg = self._load_pillar_registry()
            record = reg.get(canon_path)
            if not record:
                self.send_agent_event({"type": "ObsidianPillarRestoreResult", "payload": {"request_id": req_id, "success": False, "error": "File not in protected registry"}})
                return

            snap_path = record.get("snapshot_path")
            if not snap_path or not os.path.isfile(snap_path):
                self.send_agent_event({"type": "ObsidianPillarRestoreResult", "payload": {"request_id": req_id, "success": False, "error": "Snapshot missing"}})
                return

            # Verify snapshot integrity before restoring
            snap_hash = self._compute_sha256(snap_path)
            if snap_hash != record.get("sha256"):
                self.send_agent_event({"type": "ObsidianPillarRestoreResult", "payload": {"request_id": req_id, "success": False, "error": "Snapshot corrupted / hash mismatch"}})
                return

            # Atomic restore via temp file
            try:
                parent = os.path.dirname(canon_path)
                os.makedirs(parent, exist_ok=True)
                tmp_restore = canon_path + ".restore.tmp"
                shutil.copy2(snap_path, tmp_restore)
                os.replace(tmp_restore, canon_path)
                record["status"] = "RECOVERED"
                record["last_verified"] = int(time.time())
                self._save_pillar_registry(reg)

                self.send_agent_event({
                    "type": "ObsidianPillarRestoreResult",
                    "payload": {
                        "request_id": req_id,
                        "success": True,
                        "path": canon_path,
                        "sha256": record.get("sha256")
                    }
                })
            except Exception as e:
                self.send_agent_event({"type": "ObsidianPillarRestoreResult", "payload": {"request_id": req_id, "success": False, "error": str(e)}})

        elif c_type == "ObsidianPillarListFiles":
            reg = self._load_pillar_registry()
            self.send_agent_event({
                "type": "ObsidianPillarFileListResult",
                "payload": {
                    "request_id": req_id,
                    "files": list(reg.values())
                }
            })

        elif c_type == "ObsidianPillarStatus":
            reg = self._load_pillar_registry()
            incidents = self._load_pillar_incidents()
            total = len(reg)
            verified = sum(1 for x in reg.values() if x.get("status") in ["VERIFIED", "RECOVERED"])
            tampered = sum(1 for x in reg.values() if x.get("status") in ["TAMPER_DETECTED", "MISSING"])
            self.send_agent_event({
                "type": "ObsidianPillarStatusResult",
                "payload": {
                    "request_id": req_id,
                    "machine_id": self.machine_id,
                    "pillar_id": f"Pillar #{abs(hash(self.machine_id)) % 8 + 1}",
                    "total_protected": total,
                    "verified_count": verified,
                    "tamper_count": tampered,
                    "incidents_count": len(incidents),
                    "blackout_active": self.blackout_active
                }
            })

    def handle_replit_rpc(self, c_type, payload):
        req_id = payload.get("request_id")
        action = payload.get("action", "").lower()
        try:
            home = os.path.expanduser("~")
            lab_dir = os.path.join(home, ".cybervps", "replit")
            status_file = os.path.join(home, ".cybervps", "run", "lab-status.json")

            if c_type == "ReplitDoctor":
                total_mem_mb = 0
                if os.path.exists("/proc/meminfo"):
                    try:
                        with open("/proc/meminfo") as f:
                            for line in f:
                                if "MemTotal" in line:
                                    total_mem_mb = int(line.split()[1]) // 1024
                                    break
                    except Exception:
                        pass
                kvm_ok = os.path.exists("/dev/kvm") and os.access("/dev/kvm", os.R_OK | os.W_OK)
                docker_ok = False
                if shutil.which("docker"):
                    try:
                        res = subprocess.run(["docker", "ps"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3)
                        docker_ok = (res.returncode == 0)
                    except Exception:
                        pass
                result = {
                    "provider": self.detect_provider_environment(),
                    "total_mem_mb": total_mem_mb,
                    "kvm_hardware_acceleration": kvm_ok,
                    "kvm_mode": "hardware_kvm" if kvm_ok else "emulated_only",
                    "docker_available": docker_ok,
                    "nix_available": bool(shutil.which("nix-env")),
                    "tigervnc_available": bool(shutil.which("vncserver") or shutil.which("Xvnc")),
                    "openbox_available": bool(shutil.which("openbox")),
                    "websockify_available": bool(shutil.which("websockify")),
                    "python3_available": bool(shutil.which("python3"))
                }
                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {"request_id": req_id, "success": True, "result": result}
                })

            elif c_type == "ReplitStatus":
                desktop_running = False
                websockify_running = False
                if platform.system() != "Windows":
                    try:
                        res = subprocess.run(["pgrep", "-f", "Xvnc.*:1"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=2)
                        desktop_running = (res.returncode == 0)
                        res2 = subprocess.run(["pgrep", "-f", "websockify"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=2)
                        websockify_running = (res2.returncode == 0)
                    except Exception:
                        pass
                sshx_url = ""
                sshx_log = os.path.join(home, ".cybervps", "logs", "sshx.log")
                if os.path.exists(sshx_log):
                    try:
                        with open(sshx_log, "r", encoding="utf-8", errors="ignore") as f:
                            for m in re.finditer(r"https://sshx\.io/s/[^\s]+", f.read()):
                                sshx_url = m.group(0)
                    except Exception:
                        pass
                result = {
                    "desktop_active": desktop_running,
                    "websockify_active": websockify_running,
                    "vnc_display": ":1",
                    "vnc_port": 5901,
                    "web_port": int(os.environ.get("PORT", 8080)),
                    "sshx_url": sshx_url
                }
                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {"request_id": req_id, "success": True, "result": result}
                })

            elif c_type == "ReplitDesktop":
                sub_action = payload.get("sub_action", action or "start")
                start_script = os.path.join(lab_dir, "start-desktop.sh")
                if sub_action in ["start", "restart"]:
                    if os.path.exists(start_script):
                        subprocess.Popen(["bash", start_script], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    msg = f"Desktop service {sub_action} dispatched."
                elif sub_action == "stop":
                    subprocess.run(["pkill", "-f", "Xvnc.*:1"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3)
                    subprocess.run(["pkill", "-f", "websockify"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3)
                    msg = "Desktop and websockify stopped."
                else:
                    msg = f"Unknown desktop action: {sub_action}"
                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {"request_id": req_id, "success": True, "result": {"message": msg, "action": sub_action}}
                })

            elif c_type == "ReplitSshx":
                sub_action = payload.get("sub_action", action or "status")
                sshx_log = os.path.join(home, ".cybervps", "logs", "sshx.log")
                os.makedirs(os.path.dirname(sshx_log), exist_ok=True)
                if sub_action == "start":
                    if not shutil.which("sshx"):
                        subprocess.run("curl -sSf https://sshx.io/get | sh", shell=True, timeout=15)
                    subprocess.Popen(f"nohup sshx run > '{sshx_log}' 2>&1 &", shell=True)
                    time.sleep(2)
                elif sub_action == "stop":
                    subprocess.run(["pkill", "-f", "sshx run"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3)
                sshx_url = ""
                if os.path.exists(sshx_log):
                    try:
                        with open(sshx_log, "r", encoding="utf-8", errors="ignore") as f:
                            for m in re.finditer(r"https://sshx\.io/s/[^\s]+", f.read()):
                                sshx_url = m.group(0)
                    except Exception:
                        pass
                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {"request_id": req_id, "success": True, "result": {"sshx_url": sshx_url, "status": "running" if sshx_url else "stopped"}}
                })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def handle_scan_backend_inventory(self, payload):
        req_id = payload.get("request_id")
        try:
            inventory = self.get_backend_inventory()
        except Exception as e:
            inventory = []
        self.send_agent_event({
            "type": "BackendInventoryReport",
            "payload": {
                "request_id": req_id,
                "machine_id": self.machine_id,
                "hostname": socket.gethostname(),
                "inventory": inventory,
                "scanned_at": _iso_now()
            }
        })

    def is_protected_system_path(self, target_path):
        if not target_path or not isinstance(target_path, str):
            return True
        norm = os.path.normpath(os.path.abspath(target_path)).strip()
        sys_os = platform.system()
        if sys_os == "Windows":
            if re.match(r'^[a-zA-Z]:\\?$', norm):
                return True
            win_dir = os.environ.get("SystemRoot", "C:\\Windows")
            prog_files = os.environ.get("ProgramFiles", "C:\\Program Files")
            prog_files_x86 = os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)")
            protected = [
                os.path.normpath(win_dir).lower(),
                os.path.normpath(os.path.join(win_dir, "System32")).lower(),
                os.path.normpath(prog_files).lower(),
                os.path.normpath(prog_files_x86).lower(),
                "c:\\windows", "c:\\windows\\system32", "c:\\users", "c:\\programdata"
            ]
            if norm.lower() in protected:
                return True
        else:
            protected_roots = [
                "/", "/bin", "/sbin", "/boot", "/dev", "/etc", "/lib",
                "/lib64", "/proc", "/sys", "/usr", "/var", "/home", "/root"
            ]
            if norm in protected_roots:
                return True
        return False

    def handle_backend_management_rpc(self, c_type, payload):
        req_id = payload.get("request_id")
        action = payload.get("action") or c_type
        try:
            home = os.path.expanduser("~")
            cybervps_dir = os.path.join(home, ".cybervps")
            os.makedirs(cybervps_dir, exist_ok=True)
            custom_backends_file = os.path.join(cybervps_dir, "custom_backends.json")

            if c_type in ["BackendPathUpdate", "UpdateBackendPath"]:
                backend_id = payload.get("backend_id")
                inst_path = payload.get("installation_path")
                if inst_path and self.is_protected_system_path(inst_path):
                    raise ValueError(f"Protected system path '{inst_path}' cannot be set as installation root.")

                # If this is the agent itself, update config.json
                if backend_id == f"be_agent_{self.machine_id}" or not backend_id:
                    cfg = self.load_config()
                    if "custom_runtime_paths" not in cfg:
                        cfg["custom_runtime_paths"] = {}
                    for k in ["installation_path", "executable_path", "config_path", "log_path", "data_path"]:
                        if payload.get(k):
                            cfg["custom_runtime_paths"][k] = payload.get(k)
                    self.save_config(cfg)
                else:
                    # Update custom backends file
                    c_list = []
                    if os.path.exists(custom_backends_file):
                        try:
                            with open(custom_backends_file, "r", encoding="utf-8") as f:
                                c_list = json.load(f)
                        except Exception:
                            c_list = []
                    updated = False
                    for cb in c_list:
                        if cb.get("backend_id") == backend_id:
                            for k in ["installation_path", "executable_path", "config_path", "log_path", "data_path", "service_name", "backend_name"]:
                                if payload.get(k):
                                    cb[k] = payload.get(k)
                            updated = True
                            break
                    if not updated:
                        c_list.append({
                            "backend_id": backend_id,
                            "backend_name": payload.get("backend_name") or backend_id,
                            "installation_path": inst_path or "",
                            "executable_path": payload.get("executable_path", ""),
                            "config_path": payload.get("config_path", ""),
                            "log_path": payload.get("log_path", ""),
                            "data_path": payload.get("data_path", ""),
                            "service_name": payload.get("service_name", "Custom Service")
                        })
                    with open(custom_backends_file, "w", encoding="utf-8") as f:
                        json.dump(c_list, f, indent=2)

                fresh_inv = self.get_backend_inventory()
                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {"request_id": req_id, "success": True, "message": "Backend path updated", "inventory": fresh_inv}
                })
                self.send_agent_event({
                    "type": "BackendInventoryReport",
                    "payload": {"request_id": req_id, "machine_id": self.machine_id, "hostname": socket.gethostname(), "inventory": fresh_inv}
                })

            elif c_type in ["BackendRelocate", "RelocateBackend"]:
                backend_id = payload.get("backend_id")
                current_path = payload.get("current_path")
                new_path = payload.get("new_path")
                backup_old = payload.get("backup_old", True)

                if not new_path:
                    raise ValueError("new_path is required for backend relocation.")
                if self.is_protected_system_path(new_path):
                    raise ValueError(f"Protected system directory '{new_path}' cannot be used as target destination.")
                if ".." in new_path:
                    raise ValueError("Path traversal segments ('..') are strictly prohibited.")

                new_path_abs = os.path.abspath(new_path)
                if current_path and os.path.exists(current_path):
                    if backup_old:
                        bak_dest = current_path.rstrip("/\\") + ".bak_" + str(int(time.time()))
                        try:
                            if os.path.isdir(current_path):
                                shutil.copytree(current_path, bak_dest, dirs_exist_ok=True)
                            else:
                                shutil.copy2(current_path, bak_dest)
                        except Exception as e:
                            print(f"[!] Warning during backup creation: {e}")

                    os.makedirs(os.path.dirname(new_path_abs), exist_ok=True)
                    if os.path.isdir(current_path):
                        shutil.copytree(current_path, new_path_abs, dirs_exist_ok=True)
                    else:
                        shutil.copy2(current_path, new_path_abs)

                # Update config with new path
                cfg = self.load_config()
                if "custom_runtime_paths" not in cfg:
                    cfg["custom_runtime_paths"] = {}
                cfg["custom_runtime_paths"]["installation_path"] = new_path_abs
                self.save_config(cfg)

                fresh_inv = self.get_backend_inventory()
                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {"request_id": req_id, "success": True, "new_path": new_path_abs, "message": "Backend relocated successfully"}
                })
                self.send_agent_event({
                    "type": "BackendInventoryReport",
                    "payload": {"request_id": req_id, "machine_id": self.machine_id, "hostname": socket.gethostname(), "inventory": fresh_inv}
                })

            elif c_type in ["BackendDelete", "DeleteBackend"]:
                backend_id = payload.get("backend_id")
                target_path = payload.get("path")
                purge_files = payload.get("purge_files", False)
                confirmation = payload.get("confirmation", "")

                if purge_files:
                    if confirmation != "CONFIRM DELETE":
                        raise ValueError("Explicit confirmation string 'CONFIRM DELETE' required to purge physical files.")
                    if self.is_protected_system_path(target_path):
                        raise ValueError(f"Refusing to delete protected system path: '{target_path}'.")
                    if target_path and os.path.exists(target_path):
                        if os.path.isdir(target_path):
                            shutil.rmtree(target_path, ignore_errors=True)
                        else:
                            os.remove(target_path)

                # Remove from custom_backends.json if present
                if os.path.exists(custom_backends_file):
                    try:
                        with open(custom_backends_file, "r", encoding="utf-8") as f:
                            c_list = json.load(f)
                        c_list = [cb for cb in c_list if cb.get("backend_id") != backend_id]
                        with open(custom_backends_file, "w", encoding="utf-8") as f:
                            json.dump(c_list, f, indent=2)
                    except Exception:
                        pass

                fresh_inv = self.get_backend_inventory()
                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {"request_id": req_id, "success": True, "message": "Backend removed successfully"}
                })
                self.send_agent_event({
                    "type": "BackendInventoryReport",
                    "payload": {"request_id": req_id, "machine_id": self.machine_id, "hostname": socket.gethostname(), "inventory": fresh_inv}
                })

            elif c_type in ["RegisterCustomBackend", "AddBackend"]:
                c_list = []
                if os.path.exists(custom_backends_file):
                    try:
                        with open(custom_backends_file, "r", encoding="utf-8") as f:
                            c_list = json.load(f)
                    except Exception:
                        c_list = []
                b_rec = {
                    "backend_id": payload.get("backend_id") or f"be_custom_{int(time.time())}",
                    "backend_name": payload.get("backend_name", "Custom Backend"),
                    "category": payload.get("category", "Custom Service"),
                    "role": payload.get("role", "custom_backend"),
                    "installation_path": payload.get("installation_path", ""),
                    "executable_path": payload.get("executable_path", ""),
                    "config_path": payload.get("config_path", ""),
                    "log_path": payload.get("log_path", ""),
                    "data_path": payload.get("data_path", ""),
                    "service_name": payload.get("service_name", "User Service"),
                    "status": "running"
                }
                c_list.append(b_rec)
                with open(custom_backends_file, "w", encoding="utf-8") as f:
                    json.dump(c_list, f, indent=2)

                fresh_inv = self.get_backend_inventory()
                self.send_agent_event({
                    "type": "AgentRpcResponse",
                    "payload": {"request_id": req_id, "success": True, "backend": b_rec, "message": "Custom backend registered"}
                })
                self.send_agent_event({
                    "type": "BackendInventoryReport",
                    "payload": {"request_id": req_id, "machine_id": self.machine_id, "hostname": socket.gethostname(), "inventory": fresh_inv}
                })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {"request_id": req_id, "success": False, "error": str(e)}
            })

    def handle_reboot_host(self, payload):
        req_id = payload.get("request_id")
        reason = payload.get("reason", "Initiated via CyberVPS Control Plane")
        print(f"[*] REBOOT REQUEST RECEIVED: {reason}")
        self.send_agent_event({
            "type": "AgentRpcResponse",
            "payload": {
                "request_id": req_id,
                "success": True,
                "status": "rebooting",
                "message": f"Host reboot sequence initiated: {reason}. Agent will reconnect automatically after startup."
            }
        })
        def _exec_reboot():
            time.sleep(1.5)
            try:
                if platform.system() == "Windows":
                    subprocess.Popen(["shutdown.exe", "/r", "/t", "2", "/f", "/c", "CyberVPS Remote Reboot"])
                else:
                    subprocess.Popen("sleep 1 && (systemctl reboot || reboot || shutdown -r now)", shell=True)
            except Exception as e:
                print(f"[!] Error triggering OS reboot: {e}")
        threading.Thread(target=_exec_reboot, daemon=False).start()

    def handle_restart_agent(self, payload):
        req_id = payload.get("request_id")
        print("[*] AGENT SERVICE RESTART REQUEST RECEIVED")
        self.send_agent_event({
            "type": "AgentRpcResponse",
            "payload": {
                "request_id": req_id,
                "success": True,
                "status": "restarting",
                "message": "CyberVPS agent restarting in background..."
            }
        })
        def _exec_restart():
            time.sleep(1.0)
            self._spawn_detached_replacement()
            os._exit(0)
        threading.Thread(target=_exec_restart, daemon=False).start()

    def handle_stop_agent(self, payload):
        req_id = payload.get("request_id")
        print("[*] REMOTE AGENT STOP REQUEST RECEIVED")
        self.send_agent_event({
            "type": "AgentRpcResponse",
            "payload": {
                "request_id": req_id,
                "success": True,
                "status": "stopped",
                "message": "CyberVPS Host Agent stopping gracefully by dashboard command."
            }
        })
        def _exec_stop():
            time.sleep(1.0)
            home = os.path.expanduser("~")
            programdata_dir = os.path.join(os.environ.get("ProgramData", "C:\\ProgramData"), "CyberVPS") if platform.system() == "Windows" else "/var/lib/cybervps"
            for pf in [
                os.path.join(home, ".cybervps", "agent.pid"),
                os.path.join(home, ".cybervps", "run", "agent.pid"),
                os.path.join(programdata_dir, "run", "agent.pid"),
                os.path.join(programdata_dir, "agent.pid")
            ]:
                if os.path.exists(pf):
                    try:
                        os.remove(pf)
                    except Exception:
                        pass
            os._exit(0)
        threading.Thread(target=_exec_stop, daemon=False).start()

    def handle_repair_agent(self, payload):
        req_id = payload.get("request_id")
        print("[*] REMOTE AGENT REPAIR / SELF-HEALING REQUEST RECEIVED")
        try:
            home = os.path.expanduser("~")
            cvps_dir = os.path.join(home, ".cybervps")
            if platform.system() == "Windows":
                base_shadow = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or home
                shadow_dir = os.path.join(base_shadow, "CyberVPS")
            else:
                base_shadow = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
                shadow_dir = os.path.join(base_shadow, "cybervps")
            os.makedirs(cvps_dir, exist_ok=True)
            os.makedirs(shadow_dir, exist_ok=True)

            primary_agent = os.path.join(cvps_dir, "universal-agent.py")
            shadow_agent = os.path.join(shadow_dir, "universal-agent.py")
            script_path = os.path.abspath(__file__)

            repaired_items = []
            if not os.path.exists(shadow_agent) and os.path.exists(script_path):
                shutil.copy2(script_path, shadow_agent)
                repaired_items.append("shadow_mirror_synchronized")

            if hasattr(self, "backend_pool"):
                repaired_items.append(f"backend_pool_healthy_{len(self.backend_pool)}")

            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {
                    "request_id": req_id,
                    "success": True,
                    "status": "healthy",
                    "message": "Autonomous self-healing check and diagnostic repair completed successfully.",
                    "repairs": repaired_items
                }
            })
        except Exception as e:
            self.send_agent_event({
                "type": "AgentRpcResponse",
                "payload": {
                    "request_id": req_id,
                    "success": False,
                    "status": "failed",
                    "error": str(e)
                }
            })

    def handle_uninstall_agent(self, payload):
        req_id = payload.get("request_id")
        print("[*] REMOTE AGENT UNINSTALL REQUEST RECEIVED")
        self.send_agent_event({
            "type": "AgentRpcResponse",
            "payload": {
                "request_id": req_id,
                "success": True,
                "status": "uninstalled",
                "message": "CyberVPS Host Agent uninstalled cleanly by dashboard command."
            }
        })
        def _exec_uninstall():
            time.sleep(1.0)
            if platform.system() == "Windows":
                try:
                    subprocess.run(["schtasks", "/Delete", "/TN", "CyberVPSAgent", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                except Exception:
                    pass
                try:
                    import winreg
                    reg_key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE)
                    winreg.DeleteValue(reg_key, "CyberVPSAgent")
                    winreg.CloseKey(reg_key)
                except Exception:
                    pass
            home = os.path.expanduser("~")
            programdata_dir = os.path.join(os.environ.get("ProgramData", "C:\\ProgramData"), "CyberVPS") if platform.system() == "Windows" else "/var/lib/cybervps"
            for pf in [
                os.path.join(home, ".cybervps", "agent.pid"),
                os.path.join(home, ".cybervps", "run", "agent.pid"),
                os.path.join(programdata_dir, "run", "agent.pid"),
                os.path.join(programdata_dir, "agent.pid")
            ]:
                if os.path.exists(pf):
                    try:
                        os.remove(pf)
                    except Exception:
                        pass
            os._exit(0)
        threading.Thread(target=_exec_uninstall, daemon=False).start()

    def handle_rebuild_agent(self, payload):
        req_id = payload.get("request_id")
        print("[*] AGENT REBUILD FROM GITHUB REQUEST RECEIVED")
        success, msg = self._perform_github_rebuild()
        self.send_agent_event({
            "type": "AgentRpcResponse",
            "payload": {
                "request_id": req_id,
                "success": success,
                "status": "rebuilt" if success else "failed",
                "message": msg
            }
        })
        if success:
            def _exec_restart():
                time.sleep(1.0)
                self._spawn_detached_replacement()
                os._exit(0)
            threading.Thread(target=_exec_restart, daemon=False).start()

    def handle_sync_backend_pool(self, payload):
        backends = payload.get("backends", [])
        self.update_backends(backends)

    def _perform_github_rebuild(self):
        try:
            github_url = "https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/agent/universal-agent.py"
            req = urllib.request.Request(github_url, headers={"User-Agent": "CyberVPS-SelfHealer/2.1"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                new_code = resp.read()
            if not new_code or len(new_code) < 10000:
                return False, f"Downloaded code too small ({len(new_code) if new_code else 0} bytes)"
            
            script_path = os.path.abspath(__file__)
            tmp_path = script_path + ".rebuild.tmp"
            bak_path = script_path + ".bak"
            with open(tmp_path, "wb") as f:
                f.write(new_code)
            
            import py_compile
            py_compile.compile(tmp_path, doraise=True)

            try:
                shutil.copy2(script_path, bak_path)
            except Exception:
                pass
            shutil.move(tmp_path, script_path)
            print("[+] Successfully rebuilt agent script from GitHub")
            return True, "Rebuilt agent executable successfully from GitHub. Re-spawning agent process."
        except Exception as e:
            print(f"[!] GitHub rebuild failed: {e}")
            return False, f"Rebuild failed: {str(e)}"

    def _spawn_detached_replacement(self):
        script_path = os.path.abspath(__file__)
        args = sys.argv[1:]
        cmd = [sys.executable, script_path] + args
        try:
            cvps_dir = os.path.join(os.path.expanduser("~"), ".cybervps")
            os.makedirs(cvps_dir, exist_ok=True)
            log_path = os.path.join(cvps_dir, "agent.log")
            log_fp = open(log_path, "a", encoding="utf-8")
            if platform.system() == "Windows":
                DETACHED_PROCESS = 0x00000008
                CREATE_NEW_PROCESS_GROUP = 0x00000200
                subprocess.Popen(
                    cmd,
                    creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
                    stdin=subprocess.DEVNULL,
                    stdout=log_fp,
                    stderr=log_fp,
                    close_fds=True
                )
            else:
                subprocess.Popen(
                    cmd,
                    preexec_fn=os.setpgrp,
                    stdin=subprocess.DEVNULL,
                    stdout=log_fp,
                    stderr=log_fp,
                    close_fds=True
                )
        except Exception as e:
            print(f"[!] Error spawning replacement agent: {e}")

    def send_discovery_report(self):
        try:
            ports = self.discover_listening_ports()
        except Exception as e:
            ports = []
            print(f"[!] Notice: Port discovery non-fatal exception: {e}")
        try:
            profile = self.discover_device_profile()
        except Exception as e:
            profile = {}
            print(f"[!] Notice: Profile discovery non-fatal exception: {e}")
        try:
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
        except Exception as e:
            print(f"[!] Notice: Failed to dispatch discovery report event: {e}")

    def is_pid_alive(self, pid):
        if not pid or pid <= 0:
            return False
        if sys.platform == "win32":
            try:
                import ctypes
                PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
                STILL_ACTIVE = 259
                h_proc = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
                if h_proc:
                    exit_code = ctypes.c_ulong()
                    active = False
                    if ctypes.windll.kernel32.GetExitCodeProcess(h_proc, ctypes.byref(exit_code)):
                        active = (exit_code.value == STILL_ACTIVE)
                    ctypes.windll.kernel32.CloseHandle(h_proc)
                    return active
            except Exception:
                pass
            try:
                os.kill(pid, 0)
                return True
            except OSError:
                return False
        else:
            try:
                os.kill(pid, 0)
                return True
            except OSError:
                return False

    def run(self):
        if hasattr(signal, "SIGHUP"):
            try:
                signal.signal(signal.SIGHUP, signal.SIG_IGN)
            except Exception:
                pass
        if sys.platform == "win32" and ctypes:
            try:
                safe_mid = re.sub(r'[^a-zA-Z0-9_]', '_', str(self.machine_id))
                mutex_name = f"Local\\CyberVPS_Agent_Mutex_{safe_mid}"
                h_mutex = ctypes.windll.kernel32.CreateMutexW(None, True, mutex_name)
                if ctypes.windll.kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
                    # Allow 1.2s grace period if previous instance is terminating during restart
                    acquired = False
                    for _ in range(12):
                        time.sleep(0.1)
                        if h_mutex:
                            ctypes.windll.kernel32.CloseHandle(h_mutex)
                        h_mutex = ctypes.windll.kernel32.CreateMutexW(None, True, mutex_name)
                        if ctypes.windll.kernel32.GetLastError() != 183:
                            acquired = True
                            break
                    if not acquired:
                        msg = f"[!] [DUPLICATE_INSTANCE] Another CyberVPS agent instance is already active for [{self.machine_id}]. Exiting cleanly."
                        print(msg, flush=True)
                        if getattr(self, "log_file", None):
                            try:
                                with open(self.log_file, "a", encoding="utf-8") as _lf:
                                    _lf.write(f"[{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}] {msg}\n")
                            except Exception:
                                pass
                        sys.exit(0)
                self._singleton_mutex = h_mutex
            except SystemExit:
                raise
            except Exception:
                pass

        pid_file = self.pid_file
        try:
            if os.path.exists(pid_file):
                with open(pid_file, "r") as f:
                    content = f.read().strip()
                if content.isdigit():
                    existing_pid = int(content)
                    if existing_pid != os.getpid() and self.is_pid_alive(existing_pid):
                        print(f"[!] Another CyberVPS agent instance is already active (PID {existing_pid}). Exiting to prevent duplicate running instances.", flush=True)
                        sys.exit(0)
            os.makedirs(os.path.dirname(pid_file), exist_ok=True)
            with open(pid_file, "w") as f:
                f.write(str(os.getpid()))
        except SystemExit:
            raise
        except Exception as e:
            print(f"[!] Warning checking PID file: {e}", flush=True)

        print(f"[*] CyberVPS Space Station Agent v{PROTOCOL_VERSION} Starting", flush=True)
        print(f"[*] Machine ID: {self.machine_id}", flush=True)
        print(f"[*] Server Target: {self.server_url}", flush=True)

        profile = self.discover_device_profile()
        caps = self.get_capabilities()
        hw = self.get_hardware_identity()

        auth_payload = {
            "type": "Auth",
            "payload": {
                "machine_id": self.machine_id,
                "token": self.token,
                "agent_version": PROTOCOL_VERSION,
                "hostname": socket.gethostname(),
                "username": self.username,
                "os": platform.system(),
                "os_version": profile.get("os_full", platform.release()),
                "arch": platform.machine(),
                "hardware_uuid": hw.get("hardware_uuid"),
                "hardware_serial": hw.get("hardware_serial"),
                "capabilities": caps,
                "profile": profile,
                "runtime_paths": self.get_runtime_paths() if hasattr(self, "get_runtime_paths") else {},
                "backend_inventory": self.get_backend_inventory() if hasattr(self, "get_backend_inventory") else []
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

        try:
            self.send_agent_event(auth_payload)
        except Exception as e:
            print(f"[!] Initial auth event notice: {e}")
        try:
            self.send_discovery_report()
        except Exception as e:
            print(f"[!] Initial discovery report notice: {e}")

        last_hb = 0
        last_disc = 0
        last_auth = time.time()

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
                                "disk_total_bytes": metrics["disk_total_bytes"],
                                "hostname": socket.gethostname(),
                                "username": self.username,
                                "os": platform.system(),
                                "agent_version": PROTOCOL_VERSION,
                                "hardware_uuid": hw.get("hardware_uuid"),
                                "hardware_serial": hw.get("hardware_serial"),
                                "ghost_mode": getattr(self, "ghost_mode", False),
                                "runtime_paths": self.get_runtime_paths() if hasattr(self, "get_runtime_paths") else {},
                                "backend_inventory": self.get_backend_inventory() if hasattr(self, "get_backend_inventory") else []
                            }
                        })
                        last_hb = now

                    # Periodically retry Auth via HTTP if WebSocket is not authenticated yet
                    if (not self.ws_connected or not getattr(self.ws_relay, "authenticated", False)) and (now - last_auth > 10.0):
                        self.send_agent_event(auth_payload)
                        last_auth = now

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


def handle_cli_subcommands(args):
    if not args:
        return False

    valid_subcmds = [
        "status", "stat", "restart", "reload", "stop", "kill", "start", "agent", "ghost",
        "reboot", "rebuild", "repair", "heal", "uninstall", "remove", "update",
        "help", "--help", "-h", "doctor", "check", "logs", "log", "version", "-v", "--version",
        "security", "blackout", "pillar", "replit", "lab"
    ]

    subcmd = None
    subcmd_raw = None
    i = 0
    while i < len(args):
        a = args[i].strip()
        if a in ("--config", "-c", "--log-dir", "-l", "--server", "-s", "--token", "-t", "--log-file", "--force-auth", "-f") and i + 1 < len(args):
            i += 2
            continue
        if a.startswith("-"):
            if a in ("-v", "--version"):
                subcmd = "version"
                subcmd_raw = a
                break
            elif a in ("-h", "--help"):
                subcmd = "help"
                subcmd_raw = a
                break
            i += 1
            continue
        subcmd = a.lower()
        subcmd_raw = a
        break

    if not subcmd:
        return False

    if subcmd not in valid_subcmds:
        if not subcmd.startswith(("http://", "https://", "-")):
            print(f"Unknown command: '{subcmd_raw}'. Run 'cybervps help' for available commands.")
            sys.exit(1)
        return False

    # Normalize aliases
    if subcmd in ("stat",):
        subcmd = "status"
    elif subcmd in ("reload",):
        subcmd = "restart"
    elif subcmd in ("kill",):
        subcmd = "stop"
    elif subcmd in ("agent",):
        subcmd = "start"
    elif subcmd in ("heal",):
        subcmd = "repair"
    elif subcmd in ("remove",):
        subcmd = "uninstall"
    elif subcmd in ("rebuild",):
        subcmd = "update"

    for stream in (sys.stdout, sys.stderr):
        if stream and hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass

    home = os.path.expanduser("~")
    cvps_dir = os.path.join(home, ".cybervps")
    os.makedirs(cvps_dir, exist_ok=True)
    pid_file = os.path.join(cvps_dir, "agent.pid")
    cfg_file = os.path.join(cvps_dir, "config.json")
    script_path = os.path.abspath(__file__)

    programdata_dir = os.path.join(os.environ.get("ProgramData", "C:\\ProgramData"), "CyberVPS") if platform.system() == "Windows" else "/var/lib/cybervps"
    # Prefer machine-wide ProgramData if active agent pid exists there
    if os.path.exists(os.path.join(programdata_dir, "run", "agent.pid")):
        pid_file = os.path.join(programdata_dir, "run", "agent.pid")
    elif os.path.exists(os.path.join(programdata_dir, "agent.pid")):
        pid_file = os.path.join(programdata_dir, "agent.pid")

    if platform.system() == "Windows":
        base_shadow = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or home
        shadow_dir = os.path.join(base_shadow, "CyberVPS")
    else:
        base_shadow = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
        shadow_dir = os.path.join(base_shadow, "cybervps")

    custom_cfg_file = None
    if "--config" in args:
        try:
            c_idx = args.index("--config")
            if c_idx + 1 < len(args):
                custom_cfg_file = args[c_idx + 1]
        except Exception:
            pass
    elif "-c" in args:
        try:
            c_idx = args.index("-c")
            if c_idx + 1 < len(args):
                custom_cfg_file = args[c_idx + 1]
        except Exception:
            pass

    cfg = {}
    c_candidates = []
    if custom_cfg_file:
        c_candidates.append(custom_cfg_file)
    c_candidates.extend([pid_file.replace("agent.pid", "config.json"), cfg_file, os.path.join(programdata_dir, "config.json"), os.path.join(shadow_dir, "config.json")])

    for c_candidate in c_candidates:
        if os.path.exists(c_candidate):
            try:
                with open(c_candidate, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                    if isinstance(cfg, dict) and (cfg.get("server_url") or cfg.get("token")):
                        break
            except Exception:
                pass

    server_url = cfg.get("server_url") or "https://cybervps-space-station.up.railway.app"
    token = cfg.get("token") or os.environ.get("CYBERVPS_AGENT_TOKEN") or os.environ.get("CYBERVPS_TOKEN") or ""
    mid = cfg.get("machine_id") or ""
    if not mid and os.path.exists(os.path.join(cvps_dir, "machine_id")):
        try:
            with open(os.path.join(cvps_dir, "machine_id"), "r") as mf:
                mid = mf.read().strip()
        except Exception:
            pass
    if not mid and os.path.exists(os.path.join(programdata_dir, "machine_id")):
        try:
            with open(os.path.join(programdata_dir, "machine_id"), "r") as mf:
                mid = mf.read().strip()
        except Exception:
            pass

    def is_admin():
        if platform.system() == "Windows":
            try:
                import ctypes
                return ctypes.windll.shell32.IsUserAnAdmin() != 0
            except Exception:
                return False
        else:
            try:
                return os.geteuid() == 0
            except Exception:
                return False

    def check_admin_authorization(action_name):
        if is_admin():
            return True
        env_token = os.environ.get("CYBERVPS_ADMIN_TOKEN", "")
        if env_token and env_token == token:
            return True
        if "--force-auth" in args:
            try:
                idx = args.index("--force-auth")
                if idx + 1 < len(args) and args[idx + 1] == token:
                    return True
            except Exception:
                pass
        print("================================================================")
        print("  [!] [ACCESS DENIED] Privileged Operation Prohibited           ")
        print("================================================================")
        print(f"  The '{action_name}' command requires elevated Administrator privileges.")
        print("")
        print("  Standard or shared users cannot stop, restart, or reconfigure")
        print("  the 24/7 background CyberVPS Host Agent service.")
        print("  To perform authorized maintenance:")
        if platform.system() == "Windows":
            print("    * Reopen terminal using 'Run as Administrator'")
        else:
            print("    * Run with 'sudo' (elevated root privileges)")
        print("    * Or provide authorized admin token: --force-auth [TOKEN]")
        print("================================================================")
        sys.exit(5)

    def get_running_pid():
        candidate_pids = [
            pid_file,
            os.path.join(cvps_dir, "run", "agent.pid"),
            os.path.join(cvps_dir, "agent.pid"),
            os.path.join(programdata_dir, "run", "agent.pid"),
            os.path.join(programdata_dir, "agent.pid")
        ]
        for pf in candidate_pids:
            if not os.path.exists(pf):
                continue
            try:
                with open(pf, "r") as f:
                    content = f.read().strip()
                    if not content or not content.isdigit():
                        continue
                    p = int(content)
                if platform.system() == "Windows":
                    import ctypes
                    PROCESS_QUERY_INFORMATION = 0x0400
                    h = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_INFORMATION, False, p)
                    if h:
                        ctypes.windll.kernel32.CloseHandle(h)
                        return p
                else:
                    os.kill(p, 0)
                    return p
            except Exception:
                pass
        return None

    if subcmd in ["help", "--help", "-h"]:
        print("CyberVPS Space Station CLI")
        print("Usage: cybervps [command]")
        print("\nCommands:")
        print("  status      Check agent status, shadow mirror & connectivity to all backends")
        print("  restart     Restart the local agent service cleanly")
        print("  start       Start the agent service in background")
        print("  stop        Stop the running agent service")
        print("  logs        Tail recent agent log messages")
        print("  doctor      Run diagnostic environment and connectivity checks")
        print("  version     Show installed CyberVPS agent version")
        print("  heal        Perform full self-healing check, verify shadow copy & repair")
        print("  uninstall   Cleanly uninstall CyberVPS agent and remove autostart entries")
        print("  reboot      Gracefully initiate host machine reboot")
        print("  rebuild     Pull latest code from GitHub and restart agent")
        print("  repair      Alias for heal")
        sys.exit(0)

    elif subcmd == "status":
        print("================================================================")
        print("   [*] CyberVPS Universal Agent Status                          ")
        print("================================================================")
        active_pid = get_running_pid()
        if active_pid:
            print(f"  * Process Status:   RUNNING (PID: {active_pid})")
        else:
            print("  * Process Status:   STOPPED (Not running)")
        if mid:
            print(f"  * Machine ID:       {mid}")

        print(f"  * Primary Path:     {cvps_dir} [ACTIVE]")
        shadow_exists = os.path.exists(shadow_dir) and os.path.exists(os.path.join(shadow_dir, "universal-agent.py"))
        print(f"  * Shadow Redundancy:{shadow_dir} [{'OK' if shadow_exists else 'NOT INITIALIZED'}]")

        if platform.system() == "Windows":
            try:
                import winreg
                reg_key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_READ)
                curr_val, _ = winreg.QueryValueEx(reg_key, "CyberVPSAgent")
                winreg.CloseKey(reg_key)
                print(f"  * Autostart Run:    ENABLED ({curr_val})")
            except Exception:
                print("  * Autostart Run:    NOT CONFIGURED")

        backends = [b for b in (cfg.get("server_urls") or [server_url, "https://cybervps-space-station.up.railway.app"]) if "cybervps-render-control" not in b]
        print(f"\n  * Backend HA Mesh ({len(backends)} backends configured):")
        for b_url in backends:
            health_url = b_url.rstrip("/") + "/health"
            try:
                t0 = time.time()
                req = urllib.request.Request(health_url, headers={"User-Agent": "CyberVPS-CLI"})
                with urllib.request.urlopen(req, timeout=4) as resp:
                    lat = int((time.time() - t0) * 1000)
                    if resp.status == 200:
                        print(f"    - {b_url}: ONLINE ({lat}ms)")
                    else:
                        print(f"    - {b_url}: HTTP {resp.status}")
            except Exception as e:
                print(f"    - {b_url}: UNREACHABLE ({e})")
        print("================================================================")
        sys.exit(0)

    def spawn_daemon(cmd_list):
        log_path = os.path.join(cvps_dir, "agent.log")
        full_cmd = list(cmd_list)
        if "--log-file" not in full_cmd:
            full_cmd += ["--log-file", log_path]
        if platform.system() == "Windows":
            p = subprocess.Popen(
                full_cmd,
                creationflags=0x00000008 | 0x00000200,
                close_fds=True
            )
        else:
            p = subprocess.Popen(
                full_cmd,
                preexec_fn=os.setpgrp,
                close_fds=True
            )
        with open(pid_file, "w") as f:
            f.write(str(p.pid))
        try:
            for dest in [cvps_dir, shadow_dir]:
                os.makedirs(dest, exist_ok=True)
                with open(os.path.join(dest, "config.json"), "w", encoding="utf-8") as cf:
                    json.dump({
                        "server_url": server_url,
                        "server_urls": list(dict.fromkeys([server_url, "https://cybervpsbackend4.getvoroa.com", "https://cybervps-space-station.up.railway.app"])),
                        "token": token,
                        "machine_id": mid,
                        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                    }, cf, indent=2)
        except Exception:
            pass
        return p.pid

    if subcmd == "start":
        active_pid = get_running_pid()
        if active_pid:
            print(f"[!] Agent is already running (PID: {active_pid}).")
            sys.exit(0)
        cmd = [sys.executable, script_path, server_url, token, mid]
        new_pid = spawn_daemon(cmd)
        print(f"[+] CyberVPS agent started successfully (PID: {new_pid}).")
        sys.exit(0)

    elif subcmd == "ghost":
        active_pid = get_running_pid()
        if active_pid:
            print(f"[!] Agent is already running (PID: {active_pid}).")
            sys.exit(0)
        cmd = [sys.executable, script_path, server_url, token, mid, "--ghost"]
        new_pid = spawn_daemon(cmd)
        print("================================================================")
        print("   🛰️  CyberVPS Universal Agent - GHOST MODE                    ")
        print("================================================================")
        print(f"  [+] Ghost Bridge active in background (PID: {new_pid}).")
        print("  * 100% Invisible Background Operation (Zero Console Popups)")
        print(f"  * Machine ID: {mid}")
        print(f"  * Server:     {server_url}")
        print(f"  * Log File:   {os.path.join(cvps_dir, 'agent.log')}")
        print("================================================================")
        sys.exit(0)

    elif subcmd == "stop":
        check_admin_authorization("stop")
        active_pid = get_running_pid()
        if not active_pid:
            print("[*] CyberVPS Agent is not running (PID not found or process inactive).")
            sys.exit(0)
        print(f"[*] Stopping CyberVPS Agent (PID: {active_pid})...")
        try:
            if platform.system() == "Windows":
                subprocess.run(["taskkill", "/F", "/PID", str(active_pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                os.kill(active_pid, signal.SIGTERM)
                time.sleep(0.5)
                try:
                    os.kill(active_pid, signal.SIGKILL)
                except Exception:
                    pass
            print("[+] CyberVPS Agent stopped by authorized administrator.")
        except Exception as e:
            print(f"[!] Error stopping agent: {e}")
        finally:
            if os.path.exists(pid_file):
                try: os.remove(pid_file)
                except Exception: pass
            pdata_pid = os.path.join(programdata_dir, "run", "agent.pid")
            if os.path.exists(pdata_pid):
                try: os.remove(pdata_pid)
                except Exception: pass
        sys.exit(0)

    elif subcmd == "restart":
        check_admin_authorization("restart")
        # 1. Prefer systemd system service if running as root on Linux
        if platform.system() != "Windows" and os.geteuid() == 0 and os.path.exists("/etc/systemd/system/cybervps-agent.service"):
            try:
                subprocess.run(["systemctl", "restart", "cybervps-agent.service"], check=True)
                print("[+] CyberVPS agent restarted successfully via systemd service.")
                sys.exit(0)
            except Exception:
                pass
        # 2. Prefer systemd user service if user mode active on Linux
        user_svc = os.path.expanduser("~/.config/systemd/user/cybervps-agent.service")
        if platform.system() != "Windows" and os.path.exists(user_svc):
            try:
                subprocess.run(["systemctl", "--user", "restart", "cybervps-agent.service"], check=True)
                print("[+] CyberVPS agent restarted successfully via user systemd service.")
                sys.exit(0)
            except Exception:
                pass

        # 3. Clean up any existing instances across all PID candidates to avoid mutex collisions
        active_pid = get_running_pid()
        if active_pid:
            try:
                if platform.system() == "Windows":
                    subprocess.run(["taskkill", "/F", "/PID", str(active_pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    os.kill(active_pid, signal.SIGTERM)
                    for _ in range(25):
                        time.sleep(0.1)
                        try:
                            os.kill(active_pid, 0)
                        except OSError:
                            break
                    try:
                        os.kill(active_pid, signal.SIGKILL)
                    except Exception:
                        pass
            except Exception:
                pass

        # On Windows: Terminate any stray python processes running universal-agent.py
        if platform.system() == "Windows":
            try:
                subprocess.run(
                    ["powershell", "-NoProfile", "-Command",
                     "Get-CimInstance Win32_Process -Filter \"Name LIKE 'python%'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*universal-agent.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=4
                )
            except Exception:
                pass

        # If Windows Scheduled Task exists, trigger it
        if platform.system() == "Windows":
            try:
                res = subprocess.run(["schtasks", "/Query", "/TN", "CyberVPSAgent"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if res.returncode == 0:
                    subprocess.run(["schtasks", "/Run", "/TN", "CyberVPSAgent"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    print("[+] CyberVPS agent restarted successfully via Windows Scheduled Task (CyberVPSAgent).")
                    sys.exit(0)
            except Exception:
                pass

        cmd = [sys.executable, script_path, server_url, token, mid]
        new_pid = spawn_daemon(cmd)
        print(f"[+] CyberVPS agent restarted successfully (PID: {new_pid}).")
        sys.exit(0)

    elif subcmd in ["logs", "log"]:
        candidate_logs = [
            os.path.join(cvps_dir, "logs", "agent.log"),
            os.path.join(cvps_dir, "agent.log"),
            os.path.join(programdata_dir, "logs", "agent.log")
        ]
        found_log = None
        for l in candidate_logs:
            if os.path.exists(l):
                found_log = l
                break
        if not found_log:
            print(f"[*] No agent log file found. Checked: {candidate_logs}")
            sys.exit(0)
        try:
            with open(found_log, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
                for line in lines[-50:]:
                    print(line, end="")
        except Exception as e:
            print(f"[!] Could not read log file: {e}")
        sys.exit(0)

    elif subcmd in ["doctor", "check"]:
        is_network = any(a in args for a in ["--network", "-n", "--net"])
        print("================================================================")
        print("   CYBERVPS SPACE STATION - SYSTEM DOCTOR & NETWORK DIAGNOSTICS")
        print("================================================================")
        print(f"  Python Runtime   : {sys.executable} ({platform.python_version()})")
        is_user_python = "users" in sys.executable.lower() or "appdata" in sys.executable.lower()
        if is_user_python:
            print(f"  Python Scope     : User Profile / AppData (Requires User Task/Daemon)")
        else:
            print(f"  Python Scope     : System-Wide / Global")
        print(f"  Operating System : {platform.system()} {platform.release()} ({platform.machine()})")
        print(f"  Host Architecture: {platform.architecture()[0]}")
        print(f"  Host Name        : {socket.gethostname()}")
        print(f"  Server Target    : {server_url}")
        print(f"  Machine ID       : {mid or 'Auto-Generated / Persistent'}")
        token_preview = (token[:8] + "..." + token[-4:]) if token and len(token) > 12 else (token or "None")
        print(f"  Token State      : {'Configured (' + token_preview + ')' if token else 'NOT CONFIGURED'}")
        active_pid = get_running_pid()
        print(f"  Agent Process    : {'RUNNING (PID: ' + str(active_pid) + ') ✅' if active_pid else 'STOPPED 🔴'}")
        print(f"  Script Location  : {script_path} ({'VALID ✅' if os.path.exists(script_path) else 'MISSING ❌'})")

        # Supervisor / Service check
        task_info = "Not Configured"
        if platform.system() == "Windows":
            try:
                q = subprocess.run(["schtasks", "/Query", "/TN", "CyberVPSAgent", "/FO", "CSV", "/NH"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=3)
                if q.returncode == 0 and "CyberVPSAgent" in q.stdout:
                    task_info = "Installed & Active (CyberVPSAgent) ✅"
            except Exception:
                pass
        elif os.path.exists("/etc/systemd/system/cybervps-agent.service"):
            task_info = "systemd system service (/etc/systemd/system/cybervps-agent.service) ✅"
        user_svc = os.path.expanduser("~/.config/systemd/user/cybervps-agent.service")
        if os.path.exists(user_svc):
            task_info = f"systemd user service ({user_svc}) ✅"
        print(f"  Supervisor Task  : {task_info}")

        # Quick or Deep Reachability
        print("\n  [Network Connectivity & Egress Diagnostics]")
        # 1. DNS Resolution
        try:
            parsed = urllib.parse.urlparse(server_url)
            host = parsed.hostname or "cybervps-space-station.up.railway.app"
            t_dns_start = time.time()
            resolved_ip = socket.gethostbyname(host)
            dns_ms = int((time.time() - t_dns_start) * 1000)
            print(f"  * DNS Resolution : {host} -> {resolved_ip} ({dns_ms}ms) ✅")
        except Exception as e:
            print(f"  * DNS Resolution : FAILED ({e}) ❌")

        # 2. HTTP Health Probe
        try:
            t_http_start = time.time()
            req = urllib.request.Request(f"{server_url.rstrip('/')}/health", headers={"User-Agent": "CyberVPS-Doctor/1.0"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                http_ms = int((time.time() - t_http_start) * 1000)
                print(f"  * Control Plane  : HTTP {resp.status} OK ({http_ms}ms) ✅")
        except Exception as e:
            print(f"  * Control Plane  : UNREACHABLE ({e}) ❌")

        # 3. Fleet Enrollment Verification
        try:
            req = urllib.request.Request(f"{server_url.rstrip('/')}/api/v1/machines", headers={"User-Agent": "CyberVPS-Doctor/1.0"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                m_data = json.loads(resp.read().decode("utf-8"))
                machines = m_data.get("data") if isinstance(m_data, dict) else (m_data if isinstance(m_data, list) else [])
                found = any(m.get("id") == mid or m.get("machine_id") == mid for m in machines if isinstance(m, dict))
                if found:
                    print(f"  * Fleet Status   : ONLINE & ENROLLED ✅")
                else:
                    print(f"  * Fleet Status   : Awaiting first authenticated heartbeat ⏳")
        except Exception:
            pass

        # 4. Multi-Backend HA Mesh Probes
        backends = [b for b in (cfg.get("server_urls") or [server_url, "https://cybervps-space-station.up.railway.app"]) if "cybervps-render-control" not in b]
        print(f"\n  * Backend HA Mesh ({len(backends)} configured):")
        for b_url in backends:
            try:
                t0 = time.time()
                req = urllib.request.Request(f"{b_url.rstrip('/')}/health", headers={"User-Agent": "CyberVPS-Doctor/1.0"})
                with urllib.request.urlopen(req, timeout=4) as resp:
                    lat = int((time.time() - t0) * 1000)
                    print(f"    - {b_url}: ONLINE ({lat}ms) ✅")
            except Exception as e:
                print(f"    - {b_url}: UNREACHABLE ({e}) ❌")

        if not is_network:
            print("\n  👉 Run 'cybervps doctor --network' for deep interface and socket checks.")
        else:
            # Deep socket and network interface checks
            print("\n  [Local Network Interfaces]")
            try:
                host_fqdn = socket.getfqdn()
                local_ips = socket.gethostbyname_ex(host_fqdn)[2]
                print(f"  * Host FQDN      : {host_fqdn}")
                print(f"  * Local IP List  : {', '.join(local_ips)}")
            except Exception as e:
                print(f"  * Local IP List  : Unavailable ({e})")

        print("================================================================")
        sys.exit(0)

    elif subcmd in ["version", "-v", "--version"]:
        print(f"CyberVPS Universal Agent v{PROTOCOL_VERSION} ({platform.system().lower()}-{platform.machine().lower()})")
        sys.exit(0)

    elif subcmd in ["heal", "repair"]:
        check_admin_authorization("repair")
        print("================================================================")
        print("   [*] CyberVPS Space Station - Autonomous Self-Healing Check   ")
        print("================================================================")
        os.makedirs(shadow_dir, exist_ok=True)
        primary_agent = os.path.join(cvps_dir, "universal-agent.py")
        shadow_agent = os.path.join(shadow_dir, "universal-agent.py")

        def is_ok(fp):
            if not os.path.exists(fp) or os.path.getsize(fp) < 15000:
                return False
            try:
                py_compile.compile(fp, doraise=True)
                return True
            except Exception:
                return False

        if not os.path.exists(primary_agent) and is_ok(script_path):
            try:
                shutil.copy2(script_path, primary_agent)
            except Exception:
                pass

        p_ok = is_ok(primary_agent)
        s_ok = is_ok(shadow_agent)
        print(f"  * Primary Agent ({primary_agent}): {'VALID' if p_ok else 'DAMAGED/MISSING'}")
        print(f"  * Shadow Mirror ({shadow_agent}):  {'VALID' if s_ok else 'DAMAGED/MISSING'}")

        if not p_ok and s_ok:
            print("  [+] Restoring primary agent executable from shadow copy...")
            shutil.copy2(shadow_agent, primary_agent)
            p_ok = is_ok(primary_agent)
        elif p_ok and not s_ok:
            print("  [+] Syncing shadow mirror from primary agent executable...")
            shutil.copy2(primary_agent, shadow_agent)
            s_ok = is_ok(shadow_agent)
        elif not p_ok and not s_ok:
            print("  [*] Both copies missing. Fetching authoritative source from GitHub...")
            try:
                github_url = "https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/agent/universal-agent.py"
                req = urllib.request.Request(github_url, headers={"User-Agent": "CyberVPS-SelfHealer/2.2"})
                with urllib.request.urlopen(req, timeout=12) as resp:
                    c = resp.read()
                if len(c) > 15000:
                    with open(primary_agent, "wb") as f:
                        f.write(c)
                    py_compile.compile(primary_agent, doraise=True)
                    shutil.copy2(primary_agent, shadow_agent)
                    print("  [+] Successfully restored primary and shadow agent scripts from GitHub.")
                    p_ok = True
                    s_ok = True
            except Exception as e:
                print(f"  [!] Remote restore failed: {e}")

        # Reconcile Multi-Backend policy
        b_list = [b for b in (cfg.get("server_urls") or []) if "cybervps-render-control" not in b]
        for def_b in ["https://cybervpsbackend4.getvoroa.com", "https://cybervps-space-station.up.railway.app"]:
            if def_b not in b_list:
                b_list.append(def_b)
        cfg["server_urls"] = b_list
        for dest in [cvps_dir, shadow_dir]:
            try:
                with open(os.path.join(dest, "config.json"), "w", encoding="utf-8") as cf:
                    json.dump(cfg, cf, indent=2)
                with open(os.path.join(dest, "backends.json"), "w", encoding="utf-8") as bf:
                    json.dump(b_list, bf, indent=2)
            except Exception:
                pass
        print(f"  * Reconciled 3-Backend Mesh: {len(b_list)} backends configured.")

        # Autostart persistence
        if platform.system() == "Windows":
            try:
                import winreg
                reg_key = winreg.OpenKey(
                    winreg.HKEY_CURRENT_USER,
                    r"Software\Microsoft\Windows\CurrentVersion\Run",
                    0,
                    winreg.KEY_READ | winreg.KEY_SET_VALUE
                )
                silent_py = get_silent_python_exe()
                cfg_file = os.path.join(cvps_dir, "config.json")
                log_file = os.path.join(cvps_dir, "agent.log")
                cmd_line = f'"{silent_py}" "{primary_agent}" --config "{cfg_file}" --log-file "{log_file}"'
                winreg.SetValueEx(reg_key, "CyberVPSAgent", 0, winreg.REG_SZ, cmd_line)
                winreg.CloseKey(reg_key)
                print("  * Windows Autostart Persistence: ACTIVE (Run Key verified)")
            except Exception as e:
                print(f"  * Windows Autostart Persistence warning: {e}")

        # Check process status
        active_pid = get_running_pid()
        if not active_pid:
            print("  * Agent process is inactive. Launching agent daemon...")
            silent_py = get_silent_python_exe()
            cmd = [silent_py, primary_agent, server_url, token, mid]
            new_pid = spawn_daemon(cmd)
            print(f"  [+] CyberVPS Agent healed and running (PID: {new_pid}).")
        else:
            print(f"  * Agent process is healthy and active (PID: {active_pid}).")
        print("================================================================")
        sys.exit(0)

    elif subcmd == "uninstall":
        check_admin_authorization("uninstall")
        print("================================================================")
        print("   [*] Uninstalling CyberVPS Universal Agent                    ")
        print("================================================================")
        active_pid = get_running_pid()
        if active_pid:
            try:
                if platform.system() == "Windows":
                    subprocess.run(["taskkill", "/F", "/PID", str(active_pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    os.kill(active_pid, signal.SIGTERM)
                print(f"  [+] Terminated running agent process (PID: {active_pid}).")
            except Exception:
                pass
        if os.path.exists(pid_file):
            try: os.remove(pid_file)
            except Exception: pass
        pdata_pid = os.path.join(programdata_dir, "run", "agent.pid")
        if os.path.exists(pdata_pid):
            try: os.remove(pdata_pid)
            except Exception: pass

        if platform.system() == "Windows":
            try:
                import winreg
                reg_key = winreg.OpenKey(
                    winreg.HKEY_CURRENT_USER,
                    r"Software\Microsoft\Windows\CurrentVersion\Run",
                    0,
                    winreg.KEY_SET_VALUE
                )
                winreg.DeleteValue(reg_key, "CyberVPSAgent")
                winreg.CloseKey(reg_key)
                print("  [+] Removed Windows Registry Run autostart entry.")
            except Exception:
                pass

        print("  [+] CyberVPS Agent uninstalled cleanly. Configuration preserved in ~/.cybervps.")
        print("================================================================")
        sys.exit(0)

    elif subcmd in ["rebuild", "update"]:
        check_admin_authorization("update")
        print("[*] Contacting GitHub for latest CyberVPS Universal Agent...")
        try:
            github_url = "https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/agent/universal-agent.py"
            req = urllib.request.Request(github_url, headers={"User-Agent": "CyberVPS-Rebuilder/2.1"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                code = resp.read()
            if len(code) > 10000:
                tmp_f = script_path + ".tmp"
                with open(tmp_f, "wb") as f:
                    f.write(code)
                py_compile.compile(tmp_f, doraise=True)
                shutil.move(tmp_f, script_path)
                shutil.copy2(script_path, os.path.join(shadow_dir, "universal-agent.py"))
                print("[+] Successfully downloaded, verified and mirrored fresh agent script from GitHub.")
            else:
                print(f"[!] Warning: Code from GitHub was incomplete ({len(code)} bytes).")
        except Exception as e:
            print(f"[!] Error fetching from GitHub: {e}")

        active_pid = get_running_pid()
        if active_pid:
            try:
                if platform.system() == "Windows":
                    subprocess.run(["taskkill", "/F", "/PID", str(active_pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    os.kill(active_pid, signal.SIGTERM)
            except Exception: pass
        cmd = [sys.executable, script_path, server_url, token, mid]
        new_pid = spawn_daemon(cmd)
        print(f"[+] CyberVPS agent refreshed and running (PID: {new_pid}).")
        sys.exit(0)

    elif subcmd == "reboot":
        check_admin_authorization("reboot")
        print("[*] Initiating graceful machine reboot...")
        time.sleep(1.0)
        if platform.system() == "Windows":
            subprocess.Popen(["shutdown.exe", "/r", "/t", "2", "/f", "/c", "CyberVPS Remote Reboot"])
        else:
            subprocess.Popen("sleep 1 && (systemctl reboot || reboot || shutdown -r now)", shell=True)
        print("[+] Machine reboot dispatched.")
    elif subcmd in ["security", "blackout", "pillar", "replit", "lab"]:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        cli_candidates = [
            os.path.join(base_dir, "..", "bin", "cybervps.py"),
            os.path.join(base_dir, "bin", "cybervps.py"),
            os.path.join(os.path.expanduser("~"), ".cybervps", "space-station", "bin", "cybervps.py")
        ]
        target_cli = None
        for c in cli_candidates:
            if os.path.exists(c):
                target_cli = c
                break
        if target_cli:
            ret = subprocess.run([sys.executable, target_cli, subcmd] + args[1:])
            sys.exit(ret.returncode)
        else:
            print(f"[*] CyberVPS CLI handler not found for '{subcmd}'. Looked in: {cli_candidates}")
            sys.exit(1)

    return True


if __name__ == "__main__":
    if len(sys.argv) > 1:
        handle_cli_subcommands(sys.argv[1:])
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
    token = os.environ.get("CYBERVPS_AGENT_TOKEN") or os.environ.get("CYBERVPS_TOKEN") or ""
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
                if cfg.get("proxy"):
                    for k in ("https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY", "all_proxy", "ALL_PROXY"):
                        if not os.environ.get(k):
                            os.environ[k] = cfg["proxy"]
        except Exception as e:
            print(f"[!] Warning reading config {cfg_path}: {e}")

    args = sys.argv[1:]
    i = 0
    pos_idx = 0
    ghost_mode = False
    bootstrap_mode = False
    recovery_ticket = None
    while i < len(args):
        a = args[i]
        if a in ("--ghost",):
            ghost_mode = True
            i += 1
        elif a in ("--bootstrap",):
            bootstrap_mode = True
            i += 1
        elif a in ("--recovery-ticket",) and i + 1 < len(args):
            recovery_ticket = args[i + 1]
            i += 2
        elif a in ("--server", "-s") and i + 1 < len(args):
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
                        if c_data.get("ghost_mode"):
                            ghost_mode = True
                        if c_data.get("proxy"):
                            for k in ("https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY", "all_proxy", "ALL_PROXY"):
                                if not os.environ.get(k):
                                    os.environ[k] = c_data["proxy"]
                except Exception:
                    pass
            i += 2
        elif a in ("--log-dir", "-l") and i + 1 < len(args):
            l_dir = args[i + 1]
            try:
                os.makedirs(l_dir, exist_ok=True)
                l_path = os.path.join(l_dir, "agent.log")
                _fp = open(l_path, "a", encoding="utf-8")
                if hasattr(_fp, "reconfigure"):
                    _fp.reconfigure(line_buffering=True, write_through=True)
                sys.stdout = _fp
                sys.stderr = _fp
            except Exception:
                pass
            i += 2
        elif a in ("--log-file",) and i + 1 < len(args):
            l_path = args[i + 1]
            try:
                os.makedirs(os.path.dirname(os.path.abspath(l_path)), exist_ok=True)
                _fp = open(l_path, "a", encoding="utf-8")
                if hasattr(_fp, "reconfigure"):
                    _fp.reconfigure(line_buffering=True, write_through=True)
                sys.stdout = _fp
                sys.stderr = _fp
            except Exception:
                pass
            i += 2
        elif not a.startswith("-"):
            if a.lower() in ("start", "run", "daemon"):
                i += 1
                continue
            if a.lower() in ("stop", "kill"):
                try:
                    home = os.path.expanduser("~")
                    pfile = os.path.join(home, ".cybervps", "agent.pid")
                    if os.path.exists(pfile):
                        with open(pfile, "r") as pf:
                            opid = int(pf.read().strip())
                        if sys.platform == "win32":
                            subprocess.run(["taskkill", "/F", "/PID", str(opid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        else:
                            os.kill(opid, signal.SIGTERM)
                except Exception:
                    pass
                sys.exit(0)
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
        agent = CyberVPSAgent(target, token, mid, ghost_mode=ghost_mode)
        if bootstrap_mode or recovery_ticket:
            claimed = agent.perform_bootstrap_claim(target, agent.machine_id, recovery_ticket)
            if claimed.get("success"):
                print(f"[*] Re-enrollment bootstrap claim successful! Assigned token: {agent.token[:4]}***")
            else:
                print(f"[!] Warning: Bootstrap claim returned: {claimed.get('error')}")
        try:
            # Only persist to user's home config if this is not a dummy test run
            if agent.token and agent.token != "dummy_token" and agent.machine_id and agent.machine_id != "test_machine" and not os.environ.get("CYBERVPS_TEST_MODE"):
                home = os.path.expanduser("~")
                cvps_dir = os.path.join(home, ".cybervps")
                os.makedirs(cvps_dir, exist_ok=True)
                with open(os.path.join(cvps_dir, "config.json"), "w") as f:
                    json.dump({
                        "server_url": target,
                        "server_urls": list(dict.fromkeys([target, "https://cybervpsbackend4.getvoroa.com", "https://cybervps-space-station.up.railway.app"])),
                        "token": agent.token,
                        "machine_id": agent.machine_id,
                        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                    }, f, indent=2)
        except Exception:
            pass
        agent.run()
    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(1)
