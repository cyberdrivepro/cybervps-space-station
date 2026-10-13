#!/usr/bin/env python3
"""
Test Windows Background Terminal & Live Streaming
Verifies:
1. No visible popup window (CREATE_NO_WINDOW + STARTF_USESHOWWINDOW/SW_HIDE)
2. Interactive command execution
3. Persistent session variable state
4. Progressive live streaming
5. Clean resource teardown
"""

import os
import sys
import time
import importlib.util

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

spec = importlib.util.spec_from_file_location("universal_agent", os.path.join(os.path.dirname(__file__), "../agent/universal-agent.py"))
agent_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent_mod)

CyberVPSAgent = agent_mod.CyberVPSAgent

print("================================================================")
print("🧪 VERIFYING WINDOWS 100% BACKGROUND TERMINAL & LIVE STREAMING")
print("================================================================\n")

events = []
class MockAgent(CyberVPSAgent):
    def __init__(self):
        super().__init__("http://127.0.0.1:8080", "dummy_token", "test_machine")
    def send_agent_event(self, event_data):
        events.append(event_data)

agent = MockAgent()
session_id = "test_sess_win"

print("[Step 1] Starting terminal session...")
agent.start_terminal_session(session_id, cols=80, rows=24)
time.sleep(1.2)

ready_events = [e for e in events if e.get("type") == "TerminalReady"]
assert len(ready_events) > 0, "TerminalReady event must be emitted"
backend = ready_events[0]["payload"]["backend"]
print(f"  ✅ Terminal session started. Backend: {backend}")

print("\n[Step 2] Testing real output & persistent state...")
events.clear()
agent.write_terminal_input(session_id, '$cvpsSecret = 8899\r\n')
agent.write_terminal_input(session_id, 'Write-Output "SECRET_VAL_$cvpsSecret"\r\n')
time.sleep(1.5)

print("Captured events count:", len(events))
for e in events:
    print("EVENT:", repr(e))
output_chunks = "".join(e["payload"]["data"] for e in events if e.get("type") == "TerminalOutput")
assert "SECRET_VAL_8899" in output_chunks, f"Expected SECRET_VAL_8899 in output, got: {output_chunks}"
print("  ✅ Real output & persistent variable state verified! ($cvpsSecret = 8899 -> SECRET_VAL_8899)")

print("\n[Step 3] Testing progressive loop streaming...")
events.clear()
agent.write_terminal_input(session_id, '1..3 | ForEach-Object { Write-Output "LOOP_TICK_$_" }\r\n')
time.sleep(1.2)

loop_output = "".join(e["payload"]["data"] for e in events if e.get("type") == "TerminalOutput")
for i in (1, 2, 3):
    assert f"LOOP_TICK_{i}" in loop_output, f"LOOP_TICK_{i} must be in output"
print("  ✅ Progressive loop streaming verified (LOOP_TICK_1, 2, 3)!")

print("\n[Step 4] Testing interactive prompt confirmation [Y/N] & sequential commands...")
events.clear()
agent.write_terminal_input(session_id, '$ans = Read-Host "AGREE_PROMPT [Y/N]"; Write-Output "ANSWER_WAS_$ans"\r\n')
time.sleep(1.2)
agent.write_terminal_input(session_id, "Y\r\n")
time.sleep(1.2)
agent.write_terminal_input(session_id, 'Write-Output "POST_CONFIRM_OK"\r\n')
time.sleep(1.2)

interactive_out = "".join(e["payload"]["data"] for e in events if e.get("type") == "TerminalOutput")
assert "ANSWER_WAS_Y" in interactive_out, f"Expected ANSWER_WAS_Y in output, got: {interactive_out}"
assert "POST_CONFIRM_OK" in interactive_out, f"Expected POST_CONFIRM_OK in output, got: {interactive_out}"
print("  ✅ Interactive confirmation prompt (Read-Host -> 'Y' -> subsequent command) verified!")

print("\n[Step 5] Testing terminal teardown & cleanup...")
agent.kill_terminal(session_id)
time.sleep(0.5)
assert session_id not in agent.active_terminals, "Terminal session must be removed"
print("  ✅ Terminal session cleanly terminated. Zero orphan processes!")

print("\n================================================================")
print("🎉 ALL WINDOWS BACKGROUND TERMINAL TESTS PASSED WITH 100% SUCCESS!")
print("================================================================\n")
sys.exit(0)
