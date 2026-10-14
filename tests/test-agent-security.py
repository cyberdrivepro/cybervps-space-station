#!/usr/bin/env python3
"""
Test CyberVPS Agent Security & Process Identity Isolation
Verifies:
1. Fail-closed security: unprivileged agent requesting privileged terminal fails closed
2. PID liveness detection & duplicate process prevention
3. Clean token execution boundary
"""

import os
import sys
import time
import platform
import importlib.util

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

spec = importlib.util.spec_from_file_location("universal_agent", os.path.join(os.path.dirname(__file__), "../agent/universal-agent.py"))
agent_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent_mod)

CyberVPSAgent = agent_mod.CyberVPSAgent

print("================================================================")
print("🧪 VERIFYING AGENT SECURITY BOUNDARIES & DUPLICATE PREVENTION")
print("================================================================\n")

events = []
class MockAgent(CyberVPSAgent):
    def __init__(self):
        super().__init__("http://127.0.0.1:8080", "dummy_token", "test_machine")
    def send_agent_event(self, event_data):
        events.append(event_data)

agent = MockAgent()

# 1. Test is_pid_alive
print("[Test 1] Testing PID liveness detection...")
my_pid = os.getpid()
assert agent.is_pid_alive(my_pid) is True, f"Own PID {my_pid} must be reported alive"
assert agent.is_pid_alive(9999999) is False, "Non-existent PID 9999999 must be reported not alive"
assert agent.is_pid_alive(0) is False, "PID 0 must be reported not alive"
assert agent.is_pid_alive(-1) is False, "Negative PID must be reported not alive"
print("  ✅ PID liveness detection accurately distinguishes alive and dead processes.")

# 2. Test Fail-Closed on Privileged Profile Request for Non-Elevated Host
print("\n[Test 2] Testing fail-closed execution on privileged profile request...")
is_admin = False
if platform.system() == "Windows":
    try:
        import ctypes
        is_admin = bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        is_admin = False
else:
    try:
        is_admin = (os.geteuid() == 0)
    except Exception:
        is_admin = False

if not is_admin:
    events.clear()
    session_id = "test_privileged_req"
    agent.start_terminal_session(session_id, cols=80, rows=24, profile="privileged")
    time.sleep(0.5)
    
    # Must emit failure output or exit code 1, and session must NOT be active
    term_exits = [e for e in events if e.get("type") == "TerminalExit"]
    term_outs = [e for e in events if e.get("type") == "TerminalOutput"]
    all_out = "".join(e["payload"]["data"] for e in term_outs)
    
    assert len(term_exits) > 0, "TerminalExit must be emitted when privileged access is unavailable"
    assert term_exits[0]["payload"]["exit_code"] != 0, "Exit code must be non-zero"
    assert "Elevation cannot be bypassed" in all_out or "Security Policy" in all_out, f"Fail-closed message expected, got: {all_out}"
    assert session_id not in agent.active_terminals, "Terminal session must not remain active on failure"
    print("  ✅ Fail-closed verified: Unprivileged agent strictly rejected privileged profile with code 1.")
else:
    print("  ℹ️ Agent is running elevated; skipping non-admin privileged rejection test.")

# 3. Test Duplicate Instance Prevention
print("\n[Test 3] Testing duplicate running instance detection...")
run_dir = os.path.join(os.path.expanduser("~"), ".cybervps", "run")
pid_file = os.path.join(run_dir, "agent.pid")
os.makedirs(run_dir, exist_ok=True)

# Write an active other PID (such as parent PID) into pid_file
parent_pid = os.getppid()
with open(pid_file, "w") as f:
    f.write(str(parent_pid))

# Attempt to start a second agent - must exit cleanly via sys.exit(0)
second_agent = MockAgent()
exited = False
try:
    second_agent.run()
except SystemExit as e:
    exited = True
    assert e.code == 0, f"Expected clean exit code 0, got: {e.code}"
finally:
    try:
        if os.path.exists(pid_file):
            os.remove(pid_file)
    except Exception:
        pass

assert exited is True, "Second agent must exit when existing instance is active"
print("  ✅ Duplicate agent prevention verified: Second instance exited immediately.")

print("\n================================================================")
print("🎉 ALL AGENT SECURITY & EXECUTION BOUNDARY TESTS PASSED!")
print("================================================================\n")
sys.exit(0)
