use cybervps-shared-types::MachineCapabilities;
use std::env;
use std::fs;
use std::process::Command;

pub fn detect_windows_capabilities() -> MachineCapabilities {
    // Check if running elevated/admin
    let is_admin = Command::new("net")
        .args(["session"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let temp_dir = env::temp_dir();
    let test_file = temp_dir.join(".cvps_win_test");
    let writable_fs = fs::write(&test_file, b"test")
        .map(|_| {
            let _ = fs::remove_file(&test_file);
            true
        })
        .unwrap_or(false);

    let outbound_dns = Command::new("nslookup")
        .args(["dns.google"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let outbound_tls = Command::new("curl.exe")
        .args(["-s", "--connect-timeout", "3", "https://cloudflare.com"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    MachineCapabilities {
        is_root: is_admin,
        has_systemd: false,
        writable_fs,
        pty_supported: true,
        outbound_dns,
        outbound_tls,
        process_inspection: true,
        shell: "powershell.exe".to_string(),
    }
}
