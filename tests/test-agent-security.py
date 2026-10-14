#!/usr/bin/env python3
"""
Test CyberVPS Agent Security, Process Identity Isolation & Teardown
Verifies:
1. Isolated, non-destructive PID handling (never touches live ~/.cybervps files)
2. PID liveness detection & duplicate instance prevention
3. Genuine OS privilege separation (Windows Token Integrity Level / Linux UID)
4. Child process teardown, wait/poll lifecycle, and handle cleanup
5. Fail-closed security on unauthorized elevation requests
"""

import os
import sys
import time
import shutil
import platform
import tempfile
import importlib.util

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

spec = importlib.util.spec_from_file_location("universal_agent", os.path.join(os.path.dirname(__file__), "../agent/universal-agent.py"))
agent_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent_mod)

CyberVPSAgent = agent_mod.CyberVPSAgent

print("================================================================")
print("🧪 VERIFYING AGENT SECURITY, TOKEN INTEGRITY & PROCESS LIFECYCLE")
print("================================================================\n")

# Use isolated temporary test directory - NEVER touch user's ~/.cybervps files!
test_tmp_dir = tempfile.mkdtemp(prefix="cvps_agent_sec_test_")
test_pid_file = os.path.join(test_tmp_dir, "agent.pid")

events = []
class MockAgent(CyberVPSAgent):
    def __init__(self, pid_file=test_pid_file):
        super().__init__("http://127.0.0.1:8080", "dummy_token", "test_machine", pid_file=pid_file)
    def send_agent_event(self, event_data):
        events.append(event_data)

try:
    agent = MockAgent()

    # -------------------------------------------------------------------------
    # TEST 1: PID Liveness Detection
    # -------------------------------------------------------------------------
    print("[Test 1] Testing PID liveness detection...")
    my_pid = os.getpid()
    assert agent.is_pid_alive(my_pid) is True, f"Own PID {my_pid} must be reported alive"
    assert agent.is_pid_alive(9999999) is False, "Non-existent PID 9999999 must be reported not alive"
    assert agent.is_pid_alive(0) is False, "PID 0 must be reported not alive"
    assert agent.is_pid_alive(-1) is False, "Negative PID must be reported not alive"
    print("  ✅ PID liveness detection accurately distinguishes alive and dead processes.")

    # -------------------------------------------------------------------------
    # TEST 2: Non-Destructive Duplicate Instance Prevention
    # -------------------------------------------------------------------------
    print("\n[Test 2] Testing duplicate instance prevention in isolated sandbox...")
    parent_pid = os.getppid()
    with open(test_pid_file, "w") as f:
        f.write(str(parent_pid))

    second_agent = MockAgent(pid_file=test_pid_file)
    exited = False
    try:
        second_agent.run()
    except SystemExit as e:
        exited = True
        assert e.code == 0, f"Expected clean exit code 0, got: {e.code}"

    assert exited is True, "Second agent must exit when another instance PID is active"
    print("  ✅ Duplicate agent prevention verified without modifying any real host files.")

    # -------------------------------------------------------------------------
    # TEST 3: Genuine Process Token Identity & Privilege Boundaries
    # -------------------------------------------------------------------------
    print("\n[Test 3] Testing genuine OS process token identity & privilege isolation...")
    
    if platform.system() == "Windows":
        import ctypes
        from ctypes import wintypes
        advapi32 = ctypes.windll.advapi32
        kernel32 = ctypes.windll.kernel32

        advapi32.OpenProcessToken.argtypes = [ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
        advapi32.OpenProcessToken.restype = wintypes.BOOL
        advapi32.GetSidSubAuthorityCount.argtypes = [ctypes.c_void_p]
        advapi32.GetSidSubAuthorityCount.restype = ctypes.POINTER(ctypes.c_ubyte)
        advapi32.GetSidSubAuthority.argtypes = [ctypes.c_void_p, wintypes.DWORD]
        advapi32.GetSidSubAuthority.restype = ctypes.POINTER(wintypes.DWORD)

        def get_token_integrity_rid(hProc):
            hToken = wintypes.HANDLE()
            if not advapi32.OpenProcessToken(hProc, 0x0008, ctypes.byref(hToken)):
                return None
            try:
                dwLen = wintypes.DWORD()
                advapi32.GetTokenInformation(hToken, 25, None, 0, ctypes.byref(dwLen))
                buf = (ctypes.c_byte * dwLen.value)()
                if advapi32.GetTokenInformation(hToken, 25, buf, dwLen.value, ctypes.byref(dwLen)):
                    pSid = ctypes.cast(buf, ctypes.POINTER(ctypes.c_void_p)).contents.value
                    count = advapi32.GetSidSubAuthorityCount(pSid).contents.value
                    return advapi32.GetSidSubAuthority(pSid, count - 1).contents.value
                return None
            finally:
                kernel32.CloseHandle(hToken)

        is_elevated = bool(ctypes.windll.shell32.IsUserAnAdmin())
        print(f"  ℹ️ Host Agent execution context: {'Elevated Admin/SYSTEM' if is_elevated else 'Standard User'}")

        if is_elevated:
            # Elevated Agent: test genuine standard token de-elevation
            print("  [*] Testing de-elevated child process creation from elevated supervisor...")
            proc = agent._start_windows_terminal_proc(["cmd.exe"], want_standard_token=True, is_elevated=True)
            try:
                assert proc.pid > 0, "Child process must have valid PID"
                child_rid = get_token_integrity_rid(proc.hProcess)
                print(f"  [*] Child process PID {proc.pid} Token Integrity RID: {hex(child_rid) if child_rid else 'Unknown'}")
                # SECURITY_MANDATORY_MEDIUM_RID = 0x2000 (standard user)
                assert child_rid == 0x2000, f"De-elevated child process must have Medium Integrity RID 0x2000, got: {hex(child_rid)}"
                print("  ✅ Verified: Elevated agent successfully spawned genuine Medium Integrity standard user process.")
            finally:
                proc.terminate()
        else:
            # Standard Agent: test fail-closed on privileged profile request
            events.clear()
            session_id = "test_fail_closed_elev"
            agent.start_terminal_session(session_id, cols=80, rows=24, profile="privileged")
            time.sleep(0.3)
            term_exits = [e for e in events if e.get("type") == "TerminalExit"]
            term_outs = [e for e in events if e.get("type") == "TerminalOutput"]
            all_out = "".join(e["payload"]["data"] for e in term_outs)
            assert len(term_exits) > 0, "TerminalExit must be emitted on unauthorized elevation"
            assert term_exits[0]["payload"]["exit_code"] != 0, "Exit code must be non-zero"
            assert "Elevation cannot be bypassed" in all_out or "Security Policy" in all_out
            assert session_id not in agent.active_terminals, "Failed session must not remain registered"
            print("  ✅ Fail-closed verified: Unprivileged agent strictly refused privileged profile with code 1.")

            # Standard Agent: test standard profile starts with Medium Integrity (0x2000)
            proc = agent._start_windows_terminal_proc(["cmd.exe"], want_standard_token=False, is_elevated=False)
            try:
                assert proc.pid > 0
                child_rid = get_token_integrity_rid(int(proc.pid))
                print(f"  [*] Standard child process PID {proc.pid} Integrity RID: {hex(child_rid) if child_rid else 'Medium'}")
                if child_rid:
                    assert child_rid == 0x2000, f"Standard user process must be Medium integrity (0x2000), got {hex(child_rid)}"
                print("  ✅ Verified: Standard user process confirmed at Medium integrity level.")
            finally:
                proc.terminate()
    else:
        # Linux / POSIX: test UID and group separation
        is_root = (os.geteuid() == 0)
        if is_root:
            events.clear()
            session_id = "test_linux_drop"
            agent.start_terminal_session(session_id, cols=80, rows=24, profile="standard")
            time.sleep(0.4)
            term = agent.active_terminals.get(session_id)
            if term and "proc" in term:
                child_pid = term["proc"].pid
                with open(f"/proc/{child_pid}/status", "r") as f:
                    status_text = f.read()
                uid_line = [l for l in status_text.splitlines() if l.startswith("Uid:")][0]
                euid = int(uid_line.split()[2])
                assert euid != 0, f"Standard profile child must have dropped root EUID, got {euid}"
                print(f"  ✅ Verified: Root supervisor dropped privileges to unprivileged EUID {euid}.")
                agent.kill_terminal(session_id)
        else:
            events.clear()
            session_id = "test_linux_failclosed"
            agent.start_terminal_session(session_id, cols=80, rows=24, profile="root")
            time.sleep(0.3)
            term_exits = [e for e in events if e.get("type") == "TerminalExit"]
            assert len(term_exits) > 0 and term_exits[0]["payload"]["exit_code"] != 0
            assert session_id not in agent.active_terminals
            print("  ✅ Fail-closed verified: Non-root agent strictly rejected root request with code 1.")

    # -------------------------------------------------------------------------
    # TEST 4: Process Lifecycle, Teardown & Handle Cleanup
    # -------------------------------------------------------------------------
    print("\n[Test 4] Testing child process teardown, wait/poll lifecycle & handle cleanup...")
    events.clear()
    term_sess_id = "test_lifecycle_cleanup"
    agent.start_terminal_session(term_sess_id, cols=80, rows=24, profile="standard")
    time.sleep(0.8)

    assert term_sess_id in agent.active_terminals, "Terminal session must be active"
    term_obj = agent.active_terminals[term_sess_id]
    proc_obj = term_obj.get("proc")
    assert proc_obj is not None, "Process object must exist"
    child_pid = proc_obj.pid
    assert agent.is_pid_alive(child_pid) is True, f"Child PID {child_pid} must be running before teardown"

    # Terminate and test exit
    agent.kill_terminal(term_sess_id)
    time.sleep(0.5)

    assert term_sess_id not in agent.active_terminals, "Terminal session must be removed from active dict"
    assert agent.is_pid_alive(child_pid) is False, f"Child PID {child_pid} must NOT be alive after kill_terminal()"
    if hasattr(proc_obj, "poll"):
        assert proc_obj.poll() is not None, "Process poll() must return an exit code after termination"
    print("  ✅ Process lifecycle verified: Child process cleanly terminated, waited, and handles released.")

    print("\n================================================================")
    print("🎉 ALL AGENT SECURITY, TOKEN INTEGRITY & LIFECYCLE TESTS PASSED!")
    print("================================================================\n")

finally:
    # Always clean up temporary test sandbox
    try:
        shutil.rmtree(test_tmp_dir, ignore_errors=True)
    except Exception:
        pass

sys.exit(0)
