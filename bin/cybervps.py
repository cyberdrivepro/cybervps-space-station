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

VERSION = "1.0.0"
BASE_DIR = os.path.join(os.path.expanduser("~"), ".cybervps")
INSTALL_DIR = os.path.join(BASE_DIR, "space-station")
RUN_DIR = os.path.join(BASE_DIR, "run")
LOG_DIR = os.path.join(BASE_DIR, "logs")
CONFIG_FILE = os.path.join(BASE_DIR, "config.json")
AGENT_PID_FILE = os.path.join(RUN_DIR, "agent.pid")
AGENT_LOG_FILE = os.path.join(LOG_DIR, "agent.log")

os.makedirs(RUN_DIR, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)


def load_config():
    default_cfg = {
        "server_url": os.environ.get("CYBERVPS_SERVER", "https://cybervps-space-station.up.railway.app"),
        "token": os.environ.get("CYBERVPS_TOKEN", "cvps_enroll_master_token"),
        "machine_id": f"cvps_{socket.gethostname()}",
        "hostname": socket.gethostname()
    }
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                default_cfg.update(saved)
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
        print(f"[X] Error: Agent script not found at {script}")
        sys.exit(1)

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
                print(f"[!] CyberVPS Host Agent is already running (PID: {existing}).")
                print(f"    Target: {cfg.get('server_url')}")
                print("    Run 'cybervps status' to inspect or 'cybervps stop' to terminate.")
                return
        except Exception:
            pass

    print("[*] Starting CyberVPS Host Agent in background...")
    cmd = [sys.executable, "-u", script, "--config", CONFIG_FILE, "--log-dir", LOG_DIR]
    log_fp = open(AGENT_LOG_FILE, "a", encoding="utf-8")
    if platform.system() == "Windows":
        DETACHED_PROCESS = 0x00000008
        CREATE_NO_WINDOW = 0x08000000
        p = subprocess.Popen(cmd, stdout=log_fp, stderr=log_fp, stdin=subprocess.DEVNULL, creationflags=DETACHED_PROCESS | CREATE_NO_WINDOW)
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
        print(f"[X] Agent process exited immediately. Inspect logs at: {AGENT_LOG_FILE}")


def cmd_stop():
    if platform.system() != "Windows" and os.geteuid() == 0 and os.path.exists("/etc/systemd/system/cybervps-agent.service"):
        try:
            subprocess.run(["systemctl", "stop", "cybervps-agent.service"])
            print("[+] Stopped CyberVPS agent systemd service.")
        except Exception:
            pass

    if not os.path.exists(AGENT_PID_FILE):
        print("[*] CyberVPS Host Agent PID file not found.")
        return

    try:
        with open(AGENT_PID_FILE, "r") as f:
            pid = int(f.read().strip())
        if is_pid_running(pid):
            print(f"[*] Stopping CyberVPS Agent (PID: {pid})...")
            if platform.system() == "Windows":
                subprocess.run(["taskkill", "/F", "/PID", str(pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                os.kill(pid, 15)
                time.sleep(0.5)
                if is_pid_running(pid):
                    os.kill(pid, 9)
            print("[+] CyberVPS Agent stopped.")
        else:
            print(f"[*] Agent PID {pid} was not active.")
    except Exception as e:
        print(f"[!] Error stopping agent: {e}")
    finally:
        try: os.remove(AGENT_PID_FILE)
        except Exception: pass


def cmd_restart():
    cmd_stop()
    time.sleep(1)
    cmd_start()


def cmd_logs():
    if not os.path.exists(AGENT_LOG_FILE):
        print(f"[*] No log file found at: {AGENT_LOG_FILE}")
        return
    try:
        with open(AGENT_LOG_FILE, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
            for line in lines[-50:]:
                print(line, end="")
    except Exception as e:
        print(f"[!] Could not read logs: {e}")


def cmd_doctor():
    print("================================================================")
    print("   CYBERVPS SPACE STATION - SYSTEM DOCTOR")
    print("================================================================")
    print(f"  Python Runtime  : {sys.executable} ({platform.python_version()})")
    print(f"  Operating System: {platform.system()} {platform.release()} ({platform.machine()})")
    print(f"  Host Architecture: {platform.architecture()[0]}")
    cfg = load_config()
    print(f"  Config Server   : {cfg.get('server_url')}")
    print(f"  Config Machine  : {cfg.get('machine_id')}")
    script = get_agent_script()
    print(f"  Agent Script    : {'FOUND' if os.path.exists(script) else 'MISSING'} ({script})")
    print("================================================================")


def main():
    args = sys.argv[1:]
    command = (args[0] if len(args) > 0 else "status").lower()

    if command in ["status", "stat"]:
        cmd_status()
    elif command in ["start", "agent"]:
        cmd_start()
    elif command == "stop":
        cmd_stop()
    elif command == "restart":
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


if __name__ == "__main__":
    main()
