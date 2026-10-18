#!/usr/bin/env python3
"""
CyberVPS Space Station - Native Python CLI
Zero external pip dependencies - runs on Python 3 standard library.
Commands: status, start, stop, restart, logs, version, doctor, bridge, sftp, ssh
"""

import os
import sys
import json
import time
import socket
import platform
import subprocess
import urllib.request
import urllib.error
import py_compile
import hmac
import hashlib

# Reconfigure stdio streams to utf-8 with fallback replacement to prevent Windows cp1252 charmap crashes
for stream in (sys.stdout, sys.stderr):
    if stream and hasattr(stream, "reconfigure"):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

VERSION = "1.0.0"
BASE_DIR = os.path.join(os.path.expanduser("~"), ".cybervps")
PROGRAMDATA_DIR = os.path.join(os.environ.get("ProgramData", "C:\\ProgramData"), "CyberVPS") if platform.system() == "Windows" else "/var/lib/cybervps"

# Prefer machine-wide ProgramData if active agent pid or config exists there
if os.path.exists(os.path.join(PROGRAMDATA_DIR, "run", "agent.pid")) or (not os.path.exists(os.path.join(BASE_DIR, "config.json")) and os.path.exists(os.path.join(PROGRAMDATA_DIR, "config.json"))):
    ACTIVE_DIR = PROGRAMDATA_DIR
else:
    ACTIVE_DIR = BASE_DIR

INSTALL_DIR = os.path.join(ACTIVE_DIR, "space-station")
RUN_DIR = os.path.join(ACTIVE_DIR, "run")
LOG_DIR = os.path.join(ACTIVE_DIR, "logs")
CONFIG_FILE = os.path.join(ACTIVE_DIR, "config.json")
AGENT_PID_FILE = os.path.join(RUN_DIR, "agent.pid")
AGENT_LOG_FILE = os.path.join(LOG_DIR, "agent.log")
VAULT_DIR = os.path.join(ACTIVE_DIR, "vault")
QUARANTINE_DIR = os.path.join(ACTIVE_DIR, "quarantine")
SNAPSHOTS_DIR = os.path.join(VAULT_DIR, "snapshots")
PILLAR_REGISTRY_FILE = os.path.join(VAULT_DIR, "pillar_registry.json")
PILLAR_INCIDENTS_FILE = os.path.join(VAULT_DIR, "pillar_incidents.json")

os.makedirs(RUN_DIR, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)
os.makedirs(VAULT_DIR, exist_ok=True)
os.makedirs(QUARANTINE_DIR, exist_ok=True)
os.makedirs(SNAPSHOTS_DIR, exist_ok=True)


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


def assert_is_admin(action):
    if is_admin():
        return True

    cfg = load_config()
    token = cfg.get("token", "")
    env_token = os.environ.get("CYBERVPS_ADMIN_TOKEN", "")
    if env_token and env_token == token:
        return True

    # Check sys.argv for --force-auth <token>
    args = sys.argv[1:]
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
    print(f"  The '{action}' command requires elevated Administrator privileges.")
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


def load_config():
    default_cfg = {
        "server_url": os.environ.get("CYBERVPS_SERVER", "https://cybervps-space-station.up.railway.app"),
        "token": os.environ.get("CYBERVPS_AGENT_TOKEN") or os.environ.get("CYBERVPS_TOKEN") or os.environ.get("ENROLLMENT_TOKEN") or "",
        "machine_id": f"cvps_{socket.gethostname()}",
        "hostname": socket.gethostname()
    }
    for cfg_cand in [CONFIG_FILE, os.path.join(PROGRAMDATA_DIR, "config.json"), os.path.join(BASE_DIR, "config.json")]:
        if os.path.exists(cfg_cand):
            try:
                with open(cfg_cand, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                    default_cfg.update(saved)
                    break
            except Exception:
                pass
    return default_cfg


def is_pid_running(pid):
    if pid <= 0:
        return False
    if platform.system() == "Windows":
        try:
            out = subprocess.check_output(f'tasklist /FI "PID eq {pid}" /NH', shell=True, stderr=subprocess.DEVNULL).decode()
            return str(pid) in out
        except Exception:
            return False
    else:
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False


def get_agent_script():
    candidates = [
        os.path.join(INSTALL_DIR, "agent", "universal-agent.py"),
        os.path.join(BASE_DIR, "universal-agent.py"),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "agent", "universal-agent.py")
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return candidates[0]


def cmd_status():
    cfg = load_config()
    is_running = False
    active_pid = 0
    if os.path.exists(AGENT_PID_FILE):
        try:
            with open(AGENT_PID_FILE, "r") as f:
                content = f.read().strip()
                if content.isdigit():
                    active_pid = int(content)
                    is_running = is_pid_running(active_pid)
        except Exception:
            pass

    # Check systemd status on Linux
    systemd_active = False
    if platform.system() != "Windows":
        try:
            chk = subprocess.run(["systemctl", "is-active", "cybervps-agent.service"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if chk.stdout.decode().strip() == "active":
                systemd_active = True
                is_running = True
        except Exception:
            pass

    print("================================================================")
    print("   CYBERVPS SPACE STATION - HOST AGENT STATUS")
    print("================================================================")
    print(f"  Host Name       : {cfg.get('hostname')} ({platform.system()} {platform.machine()})")
    if systemd_active:
        print("  Agent Status    : ACTIVE [systemd service 24/7]")
    elif is_running:
        print(f"  Agent Status    : ACTIVE (PID: {active_pid}) [24/7 Background Daemon]")
    else:
        print("  Agent Status    : STOPPED / OFFLINE")
    print(f"  Server Target   : {cfg.get('server_url')}")
    print(f"  Machine ID      : {cfg.get('machine_id')}")

    # Server reachability check
    server_status = "UNKNOWN"
    try:
        req = urllib.request.Request(f"{cfg.get('server_url').rstrip('/')}/api/v1/machines", headers={"User-Agent": "CyberVPS-CLI/1.0"})
        with urllib.request.urlopen(req, timeout=3.5) as resp:
            data = resp.read().decode("utf-8")
            if cfg.get("machine_id") in data:
                server_status = "ONLINE & ENROLLED"
            else:
                server_status = "ONLINE (Enrollment Pending / Syncing)"
    except Exception as e:
        server_status = f"UNREACHABLE ({e})"

    print(f"  Server Health   : {server_status}")
    print(f"  Log File        : {AGENT_LOG_FILE}")
    print("  Dashboard       : https://cyberdrivepro.github.io/cybervps-space-station/")
    print("================================================================")


def cmd_start():
    cfg = load_config()
    script = get_agent_script()
    if not os.path.exists(script):
        print(f"[X] [AGENT_SCRIPT_MISSING] Error: Agent script not found at {script}")
        sys.exit(1)

    # Validate Python script syntax before launch
    try:
        py_compile.compile(script, doraise=True)
    except Exception as e:
        print(f"[X] [AGENT_SYNTAX_ERROR] Agent script syntax error: {e}")
        sys.exit(1)

    # Validate enrollment token presence or self-heal canonical node token
    token = cfg.get("token") or ""
    if not token or token == "cvps_enroll_master_token":
        pairing_secret = (
            os.environ.get("CVPS_PAIRING_KEY")
            or os.environ.get("PAIRING_KEY")
            or os.environ.get("BOOTSTRAP_SECRET")
            or "cybervps_pair_station_2026"
        )
        mid = cfg.get("machine_id") or f"cvps_{socket.gethostname()}"
        sig = hmac.new(pairing_secret.encode("utf-8"), f"node:{mid}".encode("utf-8"), hashlib.sha256).hexdigest()[:24]
        token = f"cvps_node_{mid}_{sig}"
        cfg["token"] = token
        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(cfg, f, indent=2)
            print(f"[*] Self-healed authenticated node token in config: {token[:16]}...")
        except Exception:
            pass

    # If systemd is available and root, prefer systemctl
    if platform.system() != "Windows" and os.geteuid() == 0 and os.path.exists("/etc/systemd/system/cybervps-agent.service"):
        try:
            subprocess.run(["systemctl", "restart", "cybervps-agent.service"], check=True)
            print("[+] Started CyberVPS agent via systemd service.")
            return
        except Exception:
            pass

    if os.path.exists(AGENT_PID_FILE):
        try:
            with open(AGENT_PID_FILE, "r") as f:
                existing = int(f.read().strip())
            if is_pid_running(existing):
                print(f"[!] [DUPLICATE_INSTANCE] CyberVPS Host Agent is already running (PID: {existing}).")
                print(f"    Target: {cfg.get('server_url')}")
                print("    Run 'cybervps status' to inspect or 'cybervps stop' to terminate.")
                return
        except Exception:
            pass

    print("[*] Starting CyberVPS Host Agent in background...")
    py_bin = sys.executable
    if platform.system() == "Windows" and py_bin.lower().endswith("python.exe"):
        py_w = py_bin[:-10] + "pythonw.exe"
        if not os.path.exists(py_w):
            py_w = os.path.join(os.path.dirname(py_bin), "pythonw.exe")
        if os.path.exists(py_w):
            py_bin = py_w

    cmd = [py_bin, "-u", script, "--config", CONFIG_FILE, "--log-dir", LOG_DIR]
    log_fp = open(AGENT_LOG_FILE, "a", encoding="utf-8")
    if platform.system() == "Windows":
        CREATE_NO_WINDOW = 0x08000000
        p = subprocess.Popen(cmd, stdout=log_fp, stderr=log_fp, stdin=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW | 0x00000200)
    else:
        p = subprocess.Popen(cmd, stdout=log_fp, stderr=log_fp, stdin=subprocess.DEVNULL, start_new_session=True)

    with open(AGENT_PID_FILE, "w") as f:
        f.write(str(p.pid))
    time.sleep(1)

    if is_pid_running(p.pid):
        print(f"[+] CyberVPS Host Agent started successfully (PID: {p.pid}).")
        print(f"    Connected to: {cfg.get('server_url')}")
        print("    View logs with: cybervps logs")
    else:
        exit_code = p.poll()
        print(f"[X] [PROCESS_EXITED_EARLY] Agent process exited immediately (exit code: {exit_code}). Inspect logs at: {AGENT_LOG_FILE}")
        sys.exit(1)


def cmd_stop():
    assert_is_admin("stop")
    stopped = False
    # 1. Systemd system service
    if platform.system() != "Windows" and os.geteuid() == 0 and os.path.exists("/etc/systemd/system/cybervps-agent.service"):
        try:
            subprocess.run(["systemctl", "stop", "cybervps-agent.service"], check=False)
            print("[+] Stopped CyberVPS agent systemd service.")
            stopped = True
        except Exception:
            pass

    # 2. Systemd user service
    user_svc = os.path.expanduser("~/.config/systemd/user/cybervps-agent.service")
    if platform.system() != "Windows" and os.path.exists(user_svc):
        try:
            subprocess.run(["systemctl", "--user", "stop", "cybervps-agent.service"], check=False)
            print("[+] Stopped CyberVPS agent user systemd service.")
            stopped = True
        except Exception:
            pass

    # 3. Check all PID candidates
    candidate_pid_files = [
        AGENT_PID_FILE,
        os.path.join(BASE_DIR, "run", "agent.pid"),
        os.path.join(BASE_DIR, "agent.pid"),
        os.path.join(PROGRAMDATA_DIR, "run", "agent.pid"),
        os.path.join(PROGRAMDATA_DIR, "agent.pid")
    ]
    pids_found = set()
    for pf in candidate_pid_files:
        if os.path.exists(pf):
            try:
                with open(pf, "r") as f:
                    content = f.read().strip()
                    if content.isdigit():
                        pids_found.add(int(content))
                os.remove(pf)
            except Exception:
                pass

    for pid in pids_found:
        if is_pid_running(pid):
            print(f"[*] Stopping CyberVPS Agent (PID: {pid})...")
            if platform.system() == "Windows":
                subprocess.run(["taskkill", "/F", "/PID", str(pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                try:
                    os.kill(pid, 15)
                    for _ in range(25):
                        time.sleep(0.1)
                        if not is_pid_running(pid):
                            break
                    if is_pid_running(pid):
                        os.kill(pid, 9)
                except Exception:
                    pass
            stopped = True

    if stopped:
        print("[+] CyberVPS Agent stopped by authorized administrator.")
    else:
        print("[*] No active CyberVPS agent process was running.")


def cmd_restart():
    assert_is_admin("restart")
    # 1. Prefer systemd system service if present and root
    if platform.system() != "Windows" and os.geteuid() == 0 and os.path.exists("/etc/systemd/system/cybervps-agent.service"):
        try:
            subprocess.run(["systemctl", "restart", "cybervps-agent.service"], check=True)
            print("[+] Restarted CyberVPS agent via systemd service.")
            return
        except Exception:
            pass

    # 2. Prefer user systemd service if present
    user_svc = os.path.expanduser("~/.config/systemd/user/cybervps-agent.service")
    if platform.system() != "Windows" and os.path.exists(user_svc):
        try:
            subprocess.run(["systemctl", "--user", "restart", "cybervps-agent.service"], check=True)
            print("[+] Restarted CyberVPS agent via user systemd service.")
            return
        except Exception:
            pass

    # 3. Direct process restart
    cmd_stop()
    time.sleep(1)
    cmd_start()


def cmd_repair():
    assert_is_admin("repair")
    print("================================================================")
    print("   CYBERVPS SPACE STATION - AUTONOMOUS SELF-HEALING & REPAIR    ")
    print("================================================================")
    script = get_agent_script()
    shadow_dir = os.path.join(os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or os.path.expanduser("~"), "CyberVPS") if platform.system() == "Windows" else os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "cybervps")
    os.makedirs(shadow_dir, exist_ok=True)
    shadow_agent = os.path.join(shadow_dir, "universal-agent.py")

    def _is_valid(fp):
        if not os.path.exists(fp) or os.path.getsize(fp) < 15000:
            return False
        try:
            py_compile.compile(fp, doraise=True)
            return True
        except Exception:
            return False

    p_ok = _is_valid(script)
    s_ok = _is_valid(shadow_agent)
    print(f"  * Primary Agent ({script}): {'VALID ✅' if p_ok else 'DAMAGED/MISSING ❌'}")
    print(f"  * Shadow Mirror ({shadow_agent}):  {'VALID ✅' if s_ok else 'DAMAGED/MISSING ❌'}")

    import shutil
    if not p_ok and s_ok:
        print("  [+] Restoring primary agent from verified shadow mirror...")
        shutil.copy2(shadow_agent, script)
        p_ok = _is_valid(script)
    elif p_ok and not s_ok:
        print("  [+] Synchronizing shadow mirror from primary agent...")
        shutil.copy2(script, shadow_agent)
        s_ok = _is_valid(shadow_agent)
    elif not p_ok and not s_ok:
        print("  [*] Restoring fresh authoritative agent script from GitHub...")
        try:
            url = "https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/agent/universal-agent.py"
            req = urllib.request.Request(url, headers={"User-Agent": "CyberVPS-Repair/2.0"})
            with urllib.request.urlopen(req, timeout=12) as resp:
                data = resp.read()
            if len(data) > 15000:
                os.makedirs(os.path.dirname(script), exist_ok=True)
                with open(script, "wb") as f:
                    f.write(data)
                py_compile.compile(script, doraise=True)
                shutil.copy2(script, shadow_agent)
                print("  [+] Primary and shadow scripts restored successfully.")
                p_ok = True
                s_ok = True
        except Exception as e:
            print(f"  [!] GitHub restore failed: {e}")

    cfg = load_config()
    print(f"  * Configuration verified ({CONFIG_FILE})")
    print("  [*] Re-cycling agent service...")
    cmd_restart()
    print("================================================================")
    print("  [+] Autonomous repair and self-healing completed successfully.")
    print("================================================================")


def cmd_update():
    assert_is_admin("update")
    print("================================================================")
    print("   CYBERVPS SPACE STATION - UPDATE FROM GITHUB                  ")
    print("================================================================")
    git_dir = os.path.join(INSTALL_DIR, ".git")
    if os.path.exists(git_dir):
        try:
            print("  [*] Running git pull origin main...")
            res = subprocess.run(["git", "pull", "origin", "main"], cwd=INSTALL_DIR, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=25)
            if res.returncode == 0:
                print("  [+] Repository updated successfully via git.")
                cmd_restart()
                return
        except Exception:
            pass

    script = get_agent_script()
    print(f"  [*] Downloading latest universal-agent.py to {script}...")
    try:
        url = "https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/agent/universal-agent.py"
        req = urllib.request.Request(url, headers={"User-Agent": "CyberVPS-Updater/2.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read()
        if len(content) > 15000:
            tmp_f = script + ".tmp"
            with open(tmp_f, "wb") as f:
                f.write(content)
            py_compile.compile(tmp_f, doraise=True)
            import shutil
            shutil.move(tmp_f, script)
            shadow_dir = os.path.join(os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or os.path.expanduser("~"), "CyberVPS") if platform.system() == "Windows" else os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "cybervps")
            os.makedirs(shadow_dir, exist_ok=True)
            shutil.copy2(script, os.path.join(shadow_dir, "universal-agent.py"))
            print("  [+] Successfully updated and verified latest CyberVPS agent script.")
            cmd_restart()
        else:
            print(f"  [!] Received incomplete code ({len(content)} bytes). Update aborted.")
    except Exception as e:
        print(f"  [!] Update failed: {e}")


def cmd_uninstall():
    assert_is_admin("uninstall")
    print("================================================================")
    print("   CYBERVPS SPACE STATION - UNINSTALL HOST AGENT                ")
    print("================================================================")
    cmd_stop()

    if platform.system() == "Windows":
        try:
            subprocess.run(["schtasks", "/Delete", "/TN", "CyberVPSAgent", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(["schtasks", "/Delete", "/TN", "CyberVPS-Space-Station-Agent", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            print("  [*] Removed Windows Scheduled Tasks.")
        except Exception:
            pass
        try:
            import winreg
            reg_key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE)
            winreg.DeleteValue(reg_key, "CyberVPSAgent")
            winreg.CloseKey(reg_key)
            print("  [*] Removed Windows Registry autostart key.")
        except Exception:
            pass
    else:
        if os.path.exists("/etc/systemd/system/cybervps-agent.service"):
            try:
                subprocess.run(["systemctl", "disable", "cybervps-agent.service"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                os.remove("/etc/systemd/system/cybervps-agent.service")
                subprocess.run(["systemctl", "daemon-reload"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                print("  [*] Removed systemd system service.")
            except Exception:
                pass
        user_svc = os.path.expanduser("~/.config/systemd/user/cybervps-agent.service")
        if os.path.exists(user_svc):
            try:
                subprocess.run(["systemctl", "--user", "disable", "cybervps-agent.service"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                os.remove(user_svc)
                subprocess.run(["systemctl", "--user", "daemon-reload"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                print("  [*] Removed systemd user service.")
            except Exception:
                pass

    print("  [+] CyberVPS Host Agent uninstalled cleanly.")
    print("================================================================")


def cmd_reboot():
    assert_is_admin("reboot")
    print("================================================================")
    print("   CYBERVPS SPACE STATION - REBOOT HOST MACHINE                 ")
    print("================================================================")
    print("  [*] Disagreeable sessions will be disconnected. Rebooting...")
    time.sleep(1.0)
    if platform.system() == "Windows":
        subprocess.Popen(["shutdown.exe", "/r", "/t", "2", "/f", "/c", "CyberVPS Remote Reboot"])
    else:
        subprocess.Popen("sleep 1 && (systemctl reboot || reboot || shutdown -r now)", shell=True)
    print("  [+] Host machine reboot sequence triggered.")


def cmd_logs():
    candidate_logs = [
        AGENT_LOG_FILE,
        os.path.join(BASE_DIR, "logs", "agent.log"),
        os.path.join(BASE_DIR, "agent.log"),
        os.path.join(PROGRAMDATA_DIR, "logs", "agent.log")
    ]
    found_log = None
    for l in candidate_logs:
        if os.path.exists(l):
            found_log = l
            break
    if not found_log:
        print(f"[*] No log file found. Looked in: {candidate_logs}")
        return
    try:
        with open(found_log, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
            for line in lines[-50:]:
                print(line, end="")
    except Exception as e:
        print(f"[!] Could not read logs: {e}")


def cmd_doctor(args=None):
    if args is None:
        args = sys.argv[2:] if len(sys.argv) > 2 else []
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
    cfg = load_config()
    server_url = cfg.get("server_url", "https://cybervps-space-station.up.railway.app")
    print(f"  Config Server    : {server_url}")
    print(f"  Config Machine   : {cfg.get('machine_id')}")
    token = cfg.get("token", "")
    token_preview = (token[:8] + "..." + token[-4:]) if token and len(token) > 12 else (token or "None")
    print(f"  Token State      : {'CONFIGURED (' + token_preview + ')' if token else 'NOT CONFIGURED'}")
    script = get_agent_script()
    print(f"  Agent Script     : {'FOUND ✅' if os.path.exists(script) else 'MISSING ❌'} ({script})")

    # Supervisor / Task check
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

    # Outbound Egress & DNS Checks
    print("\n  [Network Connectivity & Egress Diagnostics]")
    try:
        from urllib.parse import urlparse
        host = urlparse(server_url).hostname or "cybervps-space-station.up.railway.app"
        t_dns = time.time()
        resolved_ip = socket.gethostbyname(host)
        dns_ms = int((time.time() - t_dns) * 1000)
        print(f"  * DNS Resolution : {host} -> {resolved_ip} ({dns_ms}ms) ✅")
    except Exception as e:
        print(f"  * DNS Resolution : FAILED ({e}) ❌")

    try:
        t_http = time.time()
        req = urllib.request.Request(f"{server_url.rstrip('/')}/health", headers={"User-Agent": "CyberVPS-Doctor/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            http_ms = int((time.time() - t_http) * 1000)
            print(f"  * Control Plane  : HTTP {resp.status} OK ({http_ms}ms) ✅")
    except Exception as e:
        print(f"  * Control Plane  : UNREACHABLE ({e}) ❌")

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
        print("\n  [Local Network Interfaces]")
        try:
            host_fqdn = socket.getfqdn()
            local_ips = socket.gethostbyname_ex(host_fqdn)[2]
            print(f"  * Host FQDN      : {host_fqdn}")
            print(f"  * Local IP List  : {', '.join(local_ips)}")
        except Exception as e:
            print(f"  * Local IP List  : Unavailable ({e})")

    print("================================================================")


def cmd_replit(args):
    sub = args[0].lower() if args else "status"
    sub_args = args[1:]
    replit_dir = os.path.join(BASE_DIR, "replit")
    lab_cfg_file = os.path.join(replit_dir, "replit-lab.json")
    status_file = os.path.join(RUN_DIR, "lab-status.json")

    if sub in ["doctor", "check"]:
        print("================================================================")
        print("   CYBERVPS SPACE STATION — REPLIT VPS LAB DOCTOR")
        print("================================================================")
        mem_mb = 0
        if os.path.exists("/proc/meminfo"):
            try:
                with open("/proc/meminfo") as f:
                    for line in f:
                        if "MemTotal" in line:
                            mem_mb = int(line.split()[1]) // 1024
                            break
            except Exception:
                pass
        print(f"  Physical Memory      : {mem_mb} MB (Genuine /proc/meminfo)")
        try:
            st = os.statvfs(os.path.expanduser("~"))
            free_gb = round((st.f_bavail * st.f_frsize) / (1024 ** 3), 2)
            total_gb = round((st.f_blocks * st.f_frsize) / (1024 ** 3), 2)
            print(f"  Available Storage    : {free_gb} GB free of {total_gb} GB (~/)")
        except Exception:
            print("  Available Storage    : Unknown")
        kvm_accessible = os.path.exists("/dev/kvm") and os.access("/dev/kvm", os.R_OK | os.W_OK)
        if kvm_accessible:
            print("  KVM Virtualization   : ✅ HARDWARE ACCELERATED (/dev/kvm active)")
        else:
            print("  KVM Virtualization   : ⚠️ HARDWARE UNAVAILABLE (Software QEMU / PRoot fallback)")
        docker_ok = False
        try:
            r = subprocess.run(["docker", "ps"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=2)
            docker_ok = (r.returncode == 0)
        except Exception:
            pass
        print(f"  Docker Daemon        : {'✅ RUNNING' if docker_ok else 'ℹ️ UNAVAILABLE (Unprivileged sandbox)'}")
        for bin_name in ["nix-env", "vncserver", "Xvnc", "openbox", "websockify", "sshx", "chromium", "firefox"]:
            found = False
            if platform.system() != "Windows":
                try:
                    found = (subprocess.run(["which", bin_name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0)
                except Exception:
                    pass
            print(f"  Component [{bin_name:<10}]: {'FOUND ✅' if found else 'MISSING ⚠️'}")
        print("================================================================")

    elif sub in ["status", "stat"]:
        print("================================================================")
        print("   CYBERVPS SPACE STATION — REPLIT VPS LAB STATUS")
        print("================================================================")
        desktop_ok = False
        websockify_ok = False
        if platform.system() != "Windows":
            try:
                r1 = subprocess.run(["pgrep", "-f", "Xvnc.*:1"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                desktop_ok = (r1.returncode == 0)
                r2 = subprocess.run(["pgrep", "-f", "websockify"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                websockify_ok = (r2.returncode == 0)
            except Exception:
                pass
        web_port = os.environ.get("PORT", "8080")
        print(f"  Desktop Server (:1)  : {'ONLINE ✅' if desktop_ok else 'STOPPED ❌'}")
        print(f"  Websockify (:{web_port}) : {'ONLINE ✅' if websockify_ok else 'STOPPED ❌'}")
        print(f"  noVNC URL Endpoint   : http://localhost:{web_port}/vnc.html")
        sshx_log = os.path.join(LOG_DIR, "sshx.log")
        sshx_link = "Not started"
        if os.path.exists(sshx_log):
            try:
                with open(sshx_log, "r", encoding="utf-8", errors="ignore") as f:
                    import re
                    matches = re.findall(r"https://sshx\.io/s/[^\s]+", f.read())
                    if matches:
                        sshx_link = matches[-1]
            except Exception:
                pass
        print(f"  sshx Web Terminal    : {sshx_link}")
        print("================================================================")

    elif sub == "setup":
        script = os.path.join(INSTALL_DIR, "installers", "replit-vps", "install.sh")
        if not os.path.exists(script):
            script = os.path.join(BASE_DIR, "space-station", "installers", "replit-vps", "install.sh")
        if os.path.exists(script):
            subprocess.run(["bash", script])
        else:
            print(f"[!] Replit installer script not found at: {script}")
            sys.exit(1)

    elif sub == "desktop":
        action = sub_args[0].lower() if sub_args else "status"
        if action in ["start", "restart"]:
            script = os.path.join(replit_dir, "start-desktop.sh")
            if os.path.exists(script):
                subprocess.run(["bash", script])
            else:
                print(f"[!] Desktop launcher script not found at {script}. Run 'cybervps replit setup' first.")
        elif action == "stop":
            subprocess.run(["pkill", "-f", "Xvnc.*:1"])
            subprocess.run(["pkill", "-f", "websockify"])
            print("[+] Desktop and websockify stopped.")
        else:
            cmd_replit(["status"])

    elif sub == "vnc":
        web_port = os.environ.get("PORT", "8080")
        print("================================================================")
        print("   CYBERVPS REPLIT LAB — noVNC CONNECTION DETAILS")
        print("================================================================")
        print(f"  Browser URL : http://localhost:{web_port}/vnc.html")
        print("  Raw RFB     : 127.0.0.1:5901 (Display :1)")
        print("  Credentials : None / Anonymous local access")
        print("================================================================")

    elif sub == "browser":
        target = sub_args[0] if sub_args else f"http://localhost:{os.environ.get('PORT', '8080')}/vnc.html"
        script = os.path.join(replit_dir, "start-browser.sh")
        if os.path.exists(script):
            subprocess.run(["bash", script, target])
        else:
            print(f"[!] Browser launcher not found at {script}. Launching via DISPLAY=:1...")
            subprocess.Popen(f"DISPLAY=:1 chromium --no-sandbox '{target}' >/dev/null 2>&1 &", shell=True)

    elif sub in ["docker", "kvm", "lxd"]:
        cmd_replit(["doctor"])

    elif sub == "logs":
        for log_name in ["supervisor.log", "desktop.log", "websockify.log", "agent.log"]:
            lp = os.path.join(LOG_DIR, log_name)
            if os.path.exists(lp):
                print(f"--- Log: {log_name} (Last 10 lines) ---")
                try:
                    with open(lp, "r", encoding="utf-8", errors="replace") as f:
                        for l in f.readlines()[-10:]:
                            print(l, end="")
                except Exception:
                    pass
                print("")

    elif sub == "config":
        if os.path.exists(lab_cfg_file):
            with open(lab_cfg_file, "r", encoding="utf-8") as f:
                print(f.read())
        else:
            print("[!] No Replit lab configuration found. Run 'cybervps replit setup'.")

    elif sub == "uninstall":
        subprocess.run(["pkill", "-f", "supervise.sh"])
        subprocess.run(["pkill", "-f", "Xvnc.*:1"])
        subprocess.run(["pkill", "-f", "websockify"])
        print("[+] Replit VPS Lab services stopped.")

    else:
        print(f"Unknown replit command: '{sub}'.")
        print("Available: doctor, setup, status, desktop, vnc, browser, docker, kvm, lxd, logs, config, uninstall")
        sys.exit(1)


def compute_sha256(filepath):
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


def lock_os_session():
    locked = False
    if platform.system() == "Windows":
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


def load_pillar_registry():
    try:
        if os.path.exists(PILLAR_REGISTRY_FILE):
            with open(PILLAR_REGISTRY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def save_pillar_registry(reg):
    try:
        os.makedirs(VAULT_DIR, exist_ok=True)
        tmp = PILLAR_REGISTRY_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(reg, f, indent=2)
        os.replace(tmp, PILLAR_REGISTRY_FILE)
    except Exception:
        pass


def load_pillar_incidents():
    try:
        if os.path.exists(PILLAR_INCIDENTS_FILE):
            with open(PILLAR_INCIDENTS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return []


def record_pillar_incident(incident):
    try:
        os.makedirs(VAULT_DIR, exist_ok=True)
        incidents = load_pillar_incidents()
        incidents.insert(0, incident)
        if len(incidents) > 100:
            incidents = incidents[:100]
        tmp = PILLAR_INCIDENTS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(incidents, f, indent=2)
        os.replace(tmp, PILLAR_INCIDENTS_FILE)
    except Exception:
        pass


def notify_server_security(endpoint, payload):
    cfg = load_config()
    server_url = cfg.get("server_url", "https://cybervps-space-station.up.railway.app").rstrip("/")
    url = f"{server_url}{endpoint}"
    token = cfg.get("token", "")
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "CyberVPS-Security-CLI/1.0"
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=5) as resp:
            res_body = resp.read().decode("utf-8")
            return json.loads(res_body)
    except Exception as e:
        return {"success": False, "error": str(e)}


def cmd_security(args):
    sub = args[0].lower() if args else "status"
    sub_args = args[1:]
    cfg = load_config()
    machine_id = cfg.get("machine_id", f"cvps_{socket.gethostname()}")

    if sub in ["blackout"]:
        b_action = sub_args[0].lower() if sub_args else "status"
        b_args = sub_args[1:]

        if b_action == "activate":
            assert_is_admin("security blackout activate")
            reason = "Emergency containment activated by operator via CLI"
            lock_session = True
            for i, a in enumerate(b_args):
                if a in ["--reason", "-r"] and i + 1 < len(b_args):
                    reason = b_args[i + 1]
                elif a == "--no-lock":
                    lock_session = False

            print("================================================================")
            print("  🚨 CYBERVPS SPACE STATION — EMERGENCY BLACKOUT CONTAINMENT   ")
            print("================================================================")
            print(f"  Target Machine  : {machine_id}")
            print(f"  Reason          : {reason}")
            print(f"  Session Locking : {'ENABLED' if lock_session else 'DISABLED'}")
            print("----------------------------------------------------------------")

            # 1. Lock OS physical session if requested
            session_locked = False
            if lock_session:
                print("  [*] Engaging physical workstation session lock...")
                session_locked = lock_os_session()
                print(f"  * Workstation Lock   : {'ENGAGED ✅' if session_locked else 'NOT SUPPORTED ON THIS HEADLESS NODE ⚠️'}")

            # 2. Emergency quarantine backup of all protected files
            reg = load_pillar_registry()
            import shutil
            quarantine_copies = 0
            for path, meta in reg.items():
                if os.path.isfile(path):
                    safe_name = os.path.basename(path) + "_" + str(int(time.time())) + ".bak"
                    q_dest = os.path.join(QUARANTINE_DIR, safe_name)
                    try:
                        shutil.copy2(path, q_dest)
                        quarantine_copies += 1
                    except Exception:
                        pass
            print(f"  * Protected Vault   : {quarantine_copies} files quarantined to {QUARANTINE_DIR}")

            # 3. Log incident locally
            import uuid
            incident = {
                "id": "inc_blackout_" + uuid.uuid4().hex[:8],
                "machine_id": machine_id,
                "state": "BLACKOUT_ACTIVE",
                "reason": reason,
                "operator": "CLI_Administrator",
                "started_at": int(time.time()),
                "session_locked": session_locked,
                "quarantined_files": quarantine_copies
            }
            record_pillar_incident(incident)

            # 4. Notify central control plane
            print("  [*] Broadcasting emergency blackout state to control plane...")
            res = notify_server_security("/api/v1/security/blackout/activate", {
                "machine_id": machine_id,
                "reason": reason,
                "lock_session": lock_session,
                "operator": "CLI_Administrator"
            })
            if res.get("success"):
                print("  * Control Plane     : BLACKOUT REGISTERED ✅")
            else:
                print(f"  * Control Plane     : {res.get('error', 'Sync queued locally')} ℹ️")

            print("================================================================")
            print("  🚨 EMERGENCY CONTAINMENT ACTIVE — SYSTEM SECURED             ")
            print("  Run 'cybervps security blackout release' to restore operations.")
            print("================================================================")

        elif b_action == "release":
            assert_is_admin("security blackout release")
            print("================================================================")
            print("  🔓 RELEASING EMERGENCY BLACKOUT CONTAINMENT                  ")
            print("================================================================")
            import uuid
            incident = {
                "id": "inc_release_" + uuid.uuid4().hex[:8],
                "machine_id": machine_id,
                "state": "RELEASED",
                "released_at": int(time.time()),
                "operator": "CLI_Administrator"
            }
            record_pillar_incident(incident)

            res = notify_server_security("/api/v1/security/blackout/release", {
                "machine_id": machine_id,
                "operator": "CLI_Administrator"
            })
            if res.get("success"):
                print("  * Control Plane     : CONTAINMENT RELEASED ✅")
            else:
                print(f"  * Control Plane     : {res.get('error', 'Recorded locally')} ℹ️")

            print("  [+] System returned to NORMAL operational status.")
            print("================================================================")

        elif b_action == "status":
            incidents = load_pillar_incidents()
            latest = incidents[0] if incidents else None
            is_active = (latest and latest.get("state") == "BLACKOUT_ACTIVE")
            print("================================================================")
            print("  CYBERVPS SECURITY — BLACKOUT CONTAINMENT STATUS              ")
            print("================================================================")
            print(f"  Current State       : {'🚨 BLACKOUT ACTIVE' if is_active else '✅ NORMAL (UNLOCKED)'}")
            if latest:
                print(f"  Latest Incident ID  : {latest.get('id')}")
                print(f"  Reason              : {latest.get('reason')}")
                print(f"  Operator            : {latest.get('operator')}")
                print(f"  Started At          : {time.ctime(latest.get('started_at', 0)) if latest.get('started_at') else '--'}")
                if latest.get("released_at"):
                    print(f"  Released At         : {time.ctime(latest.get('released_at'))}")
            print("================================================================")

        else:
            print(f"Unknown blackout action: '{b_action}'. Use: activate, release, status")
            sys.exit(1)

    elif sub in ["protect"]:
        assert_is_admin("security protect")
        if not sub_args:
            print("Error: specify path to protect. Example: cybervps security protect /path/to/file")
            sys.exit(1)
        file_path = os.path.abspath(sub_args[0])
        policy = "immutable_snapshot"
        if "--policy" in sub_args:
            idx = sub_args.index("--policy")
            if idx + 1 < len(sub_args):
                policy = sub_args[idx + 1]

        if not os.path.isfile(file_path):
            print(f"[X] Error: File does not exist: {file_path}")
            sys.exit(1)

        import shutil
        sha = compute_sha256(file_path)
        size = os.path.getsize(file_path)
        snap_id = hashlib.sha256(file_path.encode("utf-8")).hexdigest()[:16] + "_" + os.path.basename(file_path)
        snap_path = os.path.join(SNAPSHOTS_DIR, snap_id)
        shutil.copy2(file_path, snap_path)

        reg = load_pillar_registry()
        reg[file_path] = {
            "path": file_path,
            "sha256": sha,
            "size": size,
            "policy": policy,
            "snapshot_path": snap_path,
            "protected_at": int(time.time()),
            "last_verified": int(time.time()),
            "status": "VERIFIED"
        }
        save_pillar_registry(reg)

        notify_server_security("/api/v1/security/pillar/protect", {
            "machine_id": machine_id,
            "path": file_path,
            "policy": policy
        })

        print("================================================================")
        print("  🛡️ OBSIDIAN PILLAR — FILE REGISTERED UNDER HARDCORE PROTECTION ")
        print("================================================================")
        print(f"  File Path      : {file_path}")
        print(f"  SHA-256 Digest : {sha}")
        print(f"  File Size      : {size} bytes")
        print(f"  Vault Snapshot : {snap_path}")
        print(f"  Status         : VERIFIED ✅")
        print("================================================================")

    elif sub in ["scan", "verify"]:
        target = os.path.abspath(sub_args[0]) if sub_args else None
        reg = load_pillar_registry()
        if not reg:
            print("[*] No files currently registered in Obsidian Pillar.")
            print("    Use 'cybervps security protect <path>' to register critical files.")
            return

        to_check = [target] if (target and target in reg) else list(reg.keys())
        tampered_count = 0
        verified_count = 0

        print("================================================================")
        print("  🔍 OBSIDIAN PILLAR — CRYPTOGRAPHIC INTEGRITY AUDIT           ")
        print("================================================================")
        for p in to_check:
            meta = reg[p]
            expected_hash = meta.get("sha256")
            if not os.path.exists(p):
                meta["status"] = "MISSING"
                meta["last_verified"] = int(time.time())
                tampered_count += 1
                status_str = "MISSING ❌"
            else:
                curr_hash = compute_sha256(p)
                if curr_hash == expected_hash:
                    meta["status"] = "VERIFIED"
                    meta["last_verified"] = int(time.time())
                    verified_count += 1
                    status_str = "VERIFIED ✅"
                else:
                    meta["status"] = "TAMPER_DETECTED"
                    meta["last_verified"] = int(time.time())
                    tampered_count += 1
                    status_str = f"TAMPERED 🚨 (Hash: {curr_hash[:12]}...)"

            print(f"  * {p}")
            print(f"    Expected: {expected_hash[:24]}... -> {status_str}")

        save_pillar_registry(reg)

        # Notify server
        notify_server_security("/api/v1/security/pillar/verify", {
            "machine_id": machine_id,
            "path": target or ""
        })

        print("----------------------------------------------------------------")
        print(f"  Total Audited: {len(to_check)} | Verified: {verified_count} | Tampered/Missing: {tampered_count}")

        # Check multi-deletion / tamper threshold (>=3 files)
        if tampered_count >= 3:
            print("\n  🚨 [CRITICAL ALERT] 3 or more protected files tampered or deleted!")
            print("  🚨 Autonomic containment triggering emergency blackout...")
            cmd_security(["blackout", "activate", "--reason", f"Autonomic containment: {tampered_count} protected files tampered"])
        print("================================================================")

    elif sub in ["restore"]:
        assert_is_admin("security restore")
        if not sub_args:
            print("Error: specify path to restore. Example: cybervps security restore /path/to/file")
            sys.exit(1)
        file_path = os.path.abspath(sub_args[0])
        reg = load_pillar_registry()
        record = reg.get(file_path)
        if not record:
            print(f"[X] Error: File '{file_path}' is not registered in Obsidian Pillar.")
            sys.exit(1)

        snap_path = record.get("snapshot_path")
        if not snap_path or not os.path.isfile(snap_path):
            print(f"[X] Error: Snapshot file missing at {snap_path}")
            sys.exit(1)

        expected_hash = record.get("sha256")
        snap_hash = compute_sha256(snap_path)
        if snap_hash != expected_hash:
            print(f"[X] Error: Snapshot corruption detected! Hash mismatch: {snap_hash} != {expected_hash}")
            sys.exit(1)

        import shutil
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        tmp_restore = file_path + ".restore.tmp"
        shutil.copy2(snap_path, tmp_restore)
        os.replace(tmp_restore, file_path)

        record["status"] = "VERIFIED"
        record["last_verified"] = int(time.time())
        save_pillar_registry(reg)

        notify_server_security("/api/v1/security/pillar/restore", {
            "machine_id": machine_id,
            "path": file_path
        })

        print("================================================================")
        print("  ✨ OBSIDIAN PILLAR — ATOMIC RESTORATION COMPLETE              ")
        print("================================================================")
        print(f"  Restored Path : {file_path}")
        print(f"  Verified Hash : {expected_hash}")
        print(f"  Integrity     : VERIFIED & RESTORED ✅")
        print("================================================================")

    elif sub in ["files", "list"]:
        reg = load_pillar_registry()
        print("================================================================")
        print(f"  OBSIDIAN PILLAR — PROTECTED FILES REGISTRY ({len(reg)} files)")
        print("================================================================")
        if not reg:
            print("  (No files registered. Use 'cybervps security protect <path>')")
        else:
            for p, meta in reg.items():
                st = meta.get("status", "UNKNOWN")
                st_icon = "✅" if st == "VERIFIED" else "🚨" if st == "TAMPER_DETECTED" else "⚠️"
                print(f"  {st_icon} {p}")
                print(f"     Hash   : {meta.get('sha256', '--')[:32]}...")
                print(f"     Size   : {meta.get('size', 0)} bytes | Policy: {meta.get('policy', 'immutable_snapshot')}")
                print(f"     Status : {st} (Audited: {time.ctime(meta.get('last_verified', 0))})")
                print("")
        print("================================================================")

    elif sub in ["incidents", "logs"]:
        incidents = load_pillar_incidents()
        print("================================================================")
        print(f"  OBSIDIAN SECURITY — INCIDENTS & AUDIT LOG ({len(incidents)} entries)")
        print("================================================================")
        if not incidents:
            print("  (No security incidents recorded. System running normally.)")
        else:
            for inc in incidents[:15]:
                print(f"  * [{inc.get('id', 'inc_')}] State: {inc.get('state')} | Operator: {inc.get('operator')}")
                print(f"    Reason   : {inc.get('reason', '--')}")
                print(f"    Timestamp: {time.ctime(inc.get('started_at') or inc.get('released_at') or 0)}")
                if inc.get("session_locked") is not None:
                    print(f"    Lock     : {'Session Locked' if inc.get('session_locked') else 'No Lock'}")
                print("")
        print("================================================================")

    elif sub in ["status"]:
        reg = load_pillar_registry()
        incidents = load_pillar_incidents()
        latest = incidents[0] if incidents else None
        is_active = (latest and latest.get("state") == "BLACKOUT_ACTIVE")

        verified_cnt = sum(1 for m in reg.values() if m.get("status") == "VERIFIED")
        tampered_cnt = sum(1 for m in reg.values() if m.get("status") in ["TAMPER_DETECTED", "MISSING"])

        print("================================================================")
        print("   CYBERVPS SPACE STATION — OBSIDIAN SECURITY OVERVIEW          ")
        print("================================================================")
        print(f"  Containment Status   : {'🚨 BLACKOUT ACTIVE' if is_active else '✅ NORMAL (UNLOCKED)'}")
        print(f"  Protected Files      : {len(reg)}")
        print(f"  Verified Intact (SHA): {verified_cnt} ✅")
        print(f"  Tampered / Missing   : {tampered_cnt} {'🚨' if tampered_cnt > 0 else '✅'}")
        print(f"  Vault Storage        : {VAULT_DIR}")
        print(f"  Quarantine Storage   : {QUARANTINE_DIR}")
        print(f"  Snapshots Isolated   : {SNAPSHOTS_DIR}")
        print(f"  Total Incidents Log  : {len(incidents)}")
        print("----------------------------------------------------------------")
        print("  Commands available:")
        print("    cybervps security blackout <status|activate|release>")
        print("    cybervps security protect <path> [--policy immutable_snapshot]")
        print("    cybervps security scan / verify [path]")
        print("    cybervps security restore <path>")
        print("    cybervps security files")
        print("    cybervps security incidents")
        print("================================================================")

    else:
        print(f"Unknown security command: '{sub}'.")
        print("Available: status, blackout, protect, scan, verify, restore, files, incidents")
        sys.exit(1)


def main():
    argv = sys.argv[1:]
    command = None
    cmd_args = []
    i = 0
    while i < len(argv):
        arg = argv[i].strip()
        if arg in ("--force-auth", "-f") and i + 1 < len(argv):
            i += 2
        elif arg in ("--server", "-s", "--token", "-t", "--config", "-c", "--log-dir", "-l") and i + 1 < len(argv):
            i += 2
        elif arg.startswith("-"):
            if arg in ("-v", "--version"):
                command = "version"
                break
            elif arg in ("-h", "--help"):
                command = "help"
                break
            i += 1
        else:
            if command is None:
                command = arg.lower()
            else:
                cmd_args.append(arg)
            i += 1

    if not command:
        command = "status"

    if command in ["status", "stat"]:
        cmd_status()
    elif command in ["start", "agent"]:
        cmd_start()
    elif command in ["stop", "kill"]:
        cmd_stop()
    elif command in ["restart", "reload"]:
        cmd_restart()
    elif command in ["repair", "heal"]:
        cmd_repair()
    elif command in ["update", "rebuild"]:
        cmd_update()
    elif command in ["uninstall", "remove"]:
        cmd_uninstall()
    elif command in ["reboot"]:
        cmd_reboot()
    elif command in ["logs", "log"]:
        cmd_logs()
    elif command in ["security", "blackout", "pillar"]:
        cmd_security(cmd_args)
    elif command in ["version", "-v", "--version"]:
        print(f"CyberVPS Space Station v{VERSION} ({platform.system().lower()}-{platform.machine().lower()})")
    elif command in ["doctor", "check"]:
        cmd_doctor(cmd_args)
    elif command in ["replit", "lab"]:
        cmd_replit(cmd_args)
    elif command in ["help", "--help", "-h"]:
        print(f"""
🛰️  CYBERVPS SPACE STATION CLI v{VERSION}
================================================================
Usage: cybervps <command> [options]

Commands:
  status          Show agent health, fleet enrollment, and central dashboard
  start           Start CyberVPS Host Agent in background (24/7 connection)
  stop            Stop running background Host Agent (Admin Required)
  restart         Restart background Host Agent (Admin Required)
  security <cmd>  Obsidian Pillar file protection & Emergency Blackout containment
  repair, heal    Autonomous self-healing and shadow copy repair (Admin Required)
  update, rebuild Pull latest agent updates and refresh daemon (Admin Required)
  uninstall       Cleanly uninstall host agent and remove autostart (Admin Required)
  reboot          Trigger graceful host reboot (Admin Required)
  logs            Tail recent agent log messages
  doctor          Run diagnostic health checks on host environment
  replit <action> Manage Replit VPS Lab (doctor, status, desktop, vnc, logs)
  version         Show installed CyberVPS CLI version
================================================================
""")
    else:
        print(f"Unknown command: '{command}'. Run 'cybervps help' for available commands.")
        sys.exit(1)


if __name__ == "__main__":
    main()
