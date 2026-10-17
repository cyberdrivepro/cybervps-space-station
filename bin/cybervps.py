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

os.makedirs(RUN_DIR, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)


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


def cmd_doctor():
    print("================================================================")
    print("   CYBERVPS SPACE STATION - SYSTEM DOCTOR")
    print("================================================================")
    print(f"  Python Runtime   : {sys.executable} ({platform.python_version()})")
    print(f"  Operating System : {platform.system()} {platform.release()} ({platform.machine()})")
    print(f"  Host Architecture: {platform.architecture()[0]}")
    cfg = load_config()
    print(f"  Config Server    : {cfg.get('server_url')}")
    print(f"  Config Machine   : {cfg.get('machine_id')}")
    token = cfg.get("token", "")
    print(f"  Token State      : {'CONFIGURED (' + token[:8] + '...)' if token else 'NOT CONFIGURED'}")
    script = get_agent_script()
    print(f"  Agent Script     : {'FOUND' if os.path.exists(script) else 'MISSING'} ({script})")
    try:
        req = urllib.request.Request(f"{cfg.get('server_url').rstrip('/')}/health", headers={"User-Agent": "CyberVPS-Doctor/1.0"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            print(f"  Backend Reachable: HTTP {resp.status} (OK)")
    except Exception as e:
        print(f"  Backend Reachable: UNREACHABLE ({e})")
    print("================================================================")


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
    elif command in ["logs", "log"]:
        cmd_logs()
    elif command in ["version", "-v", "--version"]:
        print(f"CyberVPS Space Station v{VERSION} ({platform.system().lower()}-{platform.machine().lower()})")
    elif command in ["doctor", "check"]:
        cmd_doctor()
    elif command in ["help", "--help", "-h"]:
        print(f"""
🛰️  CYBERVPS SPACE STATION CLI v{VERSION}
================================================================
Usage: cybervps <command> [options]

Commands:
  status          Show agent health, fleet enrollment, and central dashboard
  start           Start CyberVPS Host Agent in background (24/7 connection)
  stop            Stop running background Host Agent
  restart         Restart background Host Agent
  logs            Tail recent agent log messages
  doctor          Run diagnostic health checks on host environment
  version         Show installed CyberVPS CLI version
================================================================
""")
    else:
        print(f"Unknown command: '{command}'. Run 'cybervps help' for available commands.")
        sys.exit(1)


if __name__ == "__main__":
    main()
