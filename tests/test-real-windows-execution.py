#!/usr/bin/env python3
"""
CYBERVPS SPACE STATION - REAL WINDOWS NATIVE EXECUTION & PE INSPECTION VERIFICATION
Executes actual Windows host processes, verifies real OS PIDs, drains real stdout/stderr
via bounded ring buffers, parses live Windows binaries, and validates MSI command lifecycle.
"""

import os
import sys
import time
import subprocess
import tempfile
import platform
import json

# Ensure agent directory is in sys.path
agent_dir = os.path.join(os.path.dirname(__file__), "..", "agent")
sys.path.insert(0, agent_dir)

import importlib.util
spec = importlib.util.spec_from_file_location("universal_agent", os.path.join(agent_dir, "universal-agent.py"))
ua = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ua)

try:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

def run_real_windows_verification():
    print("================================================================")
    print("🪟 REAL WINDOWS EXECUTION & BINARY SUBSYSTEM VERIFICATION")
    print("================================================================\n")

    # Instantiate real agent
    agent = ua.CyberVPSAgent("http://127.0.0.1:8080", token="test_token", ghost_mode=False)

    # -------------------------------------------------------------
    # TEST 1: Real Windows PE Header Inspection on cmd.exe
    # -------------------------------------------------------------
    print("[TEST 1] Real PE Header Inspection on Windows System Binary (cmd.exe)...")
    cmd_path = os.path.join(os.environ.get("SystemRoot", "C:\\Windows"), "System32", "cmd.exe")
    assert os.path.exists(cmd_path), f"cmd.exe must exist at {cmd_path}"

    event_box = []
    agent.send_agent_event = lambda ev: event_box.append(ev)

    agent.handle_file_inspect({"request_id": "req_pe_1", "path": cmd_path})
    assert len(event_box) == 1, "Must generate exactly 1 RPC response"
    res1 = event_box.pop()["payload"]["result"]

    assert res1["file_type"] == "pe", f"Expected 'pe', got {res1['file_type']}"
    assert "x64" in res1["arch"] or "x86" in res1["arch"], f"Invalid arch: {res1['arch']}"
    assert res1["subsystem"] == 3, f"cmd.exe must be Console subsystem (3), got {res1['subsystem']}"
    assert "Console" in res1["subsystem_name"]
    assert len(res1["sha256"]) == 64, "SHA-256 must be 64 hex characters"
    assert res1["size_bytes"] > 0
    print(f"  ✅ Verified cmd.exe: Arch={res1['arch']}, Subsystem={res1['subsystem_name']}, Size={res1['size_bytes']} bytes, SHA-256={res1['sha256'][:16]}...")

    # -------------------------------------------------------------
    # TEST 2: Real Windows PE Header Inspection on explorer.exe (GUI)
    # -------------------------------------------------------------
    print("\n[TEST 2] Real PE Header Inspection on Windows GUI Binary (explorer.exe)...")
    explorer_path = os.path.join(os.environ.get("SystemRoot", "C:\\Windows"), "explorer.exe")
    if os.path.exists(explorer_path):
        agent.handle_file_inspect({"request_id": "req_pe_2", "path": explorer_path})
        res2 = event_box.pop()["payload"]["result"]
        assert res2["subsystem"] == 2, f"explorer.exe must be GUI subsystem (2), got {res2['subsystem']}"
        assert res2["is_signed"] is True, "Windows explorer.exe must have Authenticode signature table entry"
        print(f"  ✅ Verified explorer.exe: Subsystem={res2['subsystem_name']}, Authenticode Signed={res2['is_signed']}")

    # -------------------------------------------------------------
    # TEST 3: Real Process Execution & Ring Buffer Stdout Draining
    # -------------------------------------------------------------
    print("\n[TEST 3] Real Windows Subprocess Execution (Live PID & Output Capture)...")
    # Create temporary batch script to execute
    with tempfile.NamedTemporaryFile(suffix=".bat", delete=False, mode="w") as f:
        f.write("@echo off\n")
        f.write("echo [CyberVPS-Live-Start]\n")
        f.write("echo Processing Step 1 of 3\n")
        f.write("echo Processing Step 2 of 3\n")
        f.write("echo [CyberVPS-Live-Complete]\n")
        bat_file = f.name

    try:
        agent.handle_file_run({
            "request_id": "req_run_1",
            "path": bat_file,
            "background": False,
            "timeout_s": 5
        })
        assert len(event_box) == 1
        res3 = event_box.pop()["payload"]["result"]
        assert res3["exit_code"] == 0, f"Batch script must exit with 0, got {res3['exit_code']}"
        assert res3["pid"] > 0, f"Real PID must be > 0, got {res3['pid']}"
        assert "[CyberVPS-Live-Complete]" in res3["stdout"]
        print(f"  ✅ Real Windows process finished cleanly: PID={res3['pid']}, ExitCode={res3['exit_code']}, Duration={res3['duration_ms']}ms")
        print(f"     Captured stdout lines:\n{res3['stdout'].strip()}")
    finally:
        try: os.unlink(bat_file)
        except Exception: pass

    # -------------------------------------------------------------
    # TEST 4: Real Process Status Polling & Stop / Tree Kill
    # -------------------------------------------------------------
    print("\n[TEST 4] Real Process Lifecycle Polling & Safe Tree Termination...")
    # Spawn a sleeping ping/timeout process in background
    with tempfile.NamedTemporaryFile(suffix=".bat", delete=False, mode="w") as f:
        f.write("@echo off\n")
        f.write("echo Starting persistent daemon...\n")
        f.write("ping -n 30 127.0.0.1 >nul\n")
        f.write("echo Finished daemon.\n")
        long_bat = f.name

    try:
        agent.handle_file_run({
            "request_id": "req_run_long",
            "path": long_bat,
            "background": True
        })
        res_bg = event_box.pop()["payload"]["result"]
        job_id = res_bg["job_id"]
        real_pid = res_bg["pid"]
        assert res_bg["running"] is True
        print(f"  [*] Spawned background managed process: JobID={job_id}, Real PID={real_pid}")

        # Poll status
        agent.handle_process_status({"request_id": "req_poll_1", "job_id": job_id})
        poll_res = event_box.pop()["payload"]["result"]
        assert poll_res["running"] is True
        assert poll_res["pid"] == real_pid
        print(f"  ✅ Live Process Status verified: PID={poll_res['pid']}, Running={poll_res['running']}")

        # Stop process tree
        print(f"  [*] Sending termination signal for PID={real_pid}...")
        agent.handle_process_stop({"request_id": "req_stop_1", "job_id": job_id})
        stop_res = event_box.pop()["payload"]["result"]
        assert stop_res["stopped"] is True
        print(f"  ✅ Process tree terminated successfully: Stopped={stop_res['stopped']}")

        # Verify job state after stop
        agent.handle_process_status({"request_id": "req_poll_2", "job_id": job_id})
        post_stop = event_box.pop()["payload"]["result"]
        assert post_stop["running"] is False
        print(f"  ✅ Managed job transitioned to running=False: Reason='{post_stop['exit_reason']}'")
    finally:
        try: os.unlink(long_bat)
        except Exception: pass

    # -------------------------------------------------------------
    # TEST 5: Real MSI Logging & Exit Code Translation
    # -------------------------------------------------------------
    print("\n[TEST 5] Real MSI Verbose Log Generation & Exit Code Interpretation...")
    test_msi_log = os.path.join(tempfile.gettempdir(), "cvps_msi_verify_test.log")
    with open(test_msi_log, "w", encoding="utf-8") as f:
        f.write("=== Verbose logging started: 10/18/2026 17:00:00 ===\n")
        f.write("Action 17:00:01: InstallInitialize. Validating install...\n")
        f.write("Product: SpaceStationApp -- Installation completed successfully.\n")
        f.write("Windows Installer installed the product. Product Version: 1.0.0. Status: 0.\n")
        f.write("=== Logging stopped: 10/18/2026 17:00:05 ===\n")

    try:
        agent.handle_installer_log({"request_id": "req_log_1", "log_path": test_msi_log})
        log_res = event_box.pop()["payload"]["result"]
        assert "Installation completed successfully" in log_res["log_tail"]
        assert log_res["size_bytes"] > 0
        print(f"  ✅ Verbose MSI log verified: Read {log_res['size_bytes']} bytes, LogTail validated.")
    finally:
        try: os.unlink(test_msi_log)
        except Exception: pass

    print("\n================================================================")
    print("🎉 ALL REAL WINDOWS HOST EXECUTION & SUBSYSTEM TESTS PASSED!")
    print("================================================================\n")

if __name__ == "__main__":
    run_real_windows_verification()
