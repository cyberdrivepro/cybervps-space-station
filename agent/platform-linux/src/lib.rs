use cybervps-shared-types::MachineCapabilities;
use std::fs;
use std::path::Path;
use std::process::Command;

pub fn detect_linux_capabilities() -> MachineCapabilities {
    let is_root = unsafe {
        #[cfg(target_os = "linux")]
        {
            libc::geteuid() == 0
        }
        #[cfg(not(target_os = "linux"))]
        {
            false
        }
    };

    let has_systemd = Path::new("/run/systemd/system").exists();
    let writable_fs = fs::write("/tmp/.cvps_test", b"test")
        .map(|_| {
            let _ = fs::remove_file("/tmp/.cvps_test");
            true
        })
        .unwrap_or(false);

    let outbound_dns = Command::new("getent")
        .args(["hosts", "dns.google"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let outbound_tls = Command::new("curl")
        .args(["-s", "--connect-timeout", "3", "https://cloudflare.com"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    MachineCapabilities {
        is_root,
        has_systemd,
        writable_fs,
        pty_supported: true,
        outbound_dns,
        outbound_tls,
        process_inspection: true,
        shell: "/bin/bash".to_string(),
    }
}
