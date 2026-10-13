use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, Mutex};
use tracing::{error, info};

pub struct ActiveSession {
    pub session_id: String,
    pub stdin: Arc<Mutex<Option<ChildStdin>>>,
    pub child: Arc<Mutex<Option<Child>>>,
}

pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, ActiveSession>>>,
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn start_session(
        &self,
        session_id: String,
        _cols: u16,
        _rows: u16,
        shell_preference: Option<String>,
        output_tx: mpsc::Sender<(String, String)>,
    ) -> anyhow::Result<()> {
        let (shell_cmd, shell_args) = if let Some(pref) = shell_preference {
            (pref, vec![])
        } else {
            #[cfg(target_os = "windows")]
            {
                ("powershell.exe".to_string(), vec!["-NoProfile", "-ExecutionPolicy", "Bypass"])
            }
            #[cfg(not(target_os = "windows"))]
            {
                if std::path::Path::new("/bin/bash").exists() {
                    ("/bin/bash".to_string(), vec!["-i"])
                } else {
                    ("/bin/sh".to_string(), vec!["-i"])
                }
            }
        };

        let mut cmd = Command::new(&shell_cmd);
        cmd.args(&shell_args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn()?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let stdin_arc = Arc::new(Mutex::new(stdin));
        let child_arc = Arc::new(Mutex::new(Some(child)));

        let sess_id_clone = session_id.clone();
        let sess_id_err = session_id.clone();
        let tx_out = output_tx.clone();
        let tx_err = output_tx.clone();

        // Spawn stdout reader
        if let Some(mut reader) = stdout {
            tokio::spawn(async move {
                let mut buf = [0u8; 2048];
                while let Ok(n) = reader.read(&mut buf).await {
                    if n == 0 {
                        break;
                    }
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    if tx_out.send((sess_id_clone.clone(), text)).await.is_err() {
                        break;
                    }
                }
            });
        }

        // Spawn stderr reader
        if let Some(mut reader) = stderr {
            tokio::spawn(async move {
                let mut buf = [0u8; 2048];
                while let Ok(n) = reader.read(&mut buf).await {
                    if n == 0 {
                        break;
                    }
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    if tx_err.send((sess_id_err.clone(), text)).await.is_err() {
                        break;
                    }
                }
            });
        }

        let mut map = self.sessions.lock().await;
        map.insert(
            session_id.clone(),
            ActiveSession {
                session_id,
                stdin: stdin_arc,
                child: child_arc,
            },
        );

        Ok(())
    }

    pub async fn write_input(&self, session_id: &str, data: &str) -> anyhow::Result<()> {
        let map = self.sessions.lock().await;
        if let Some(sess) = map.get(session_id) {
            let mut stdin_lock = sess.stdin.lock().await;
            if let Some(ref mut stdin) = *stdin_lock {
                stdin.write_all(data.as_bytes()).await?;
                stdin.flush().await?;
            }
        }
        Ok(())
    }

    pub async fn kill_session(&self, session_id: &str) {
        let mut map = self.sessions.lock().await;
        if let Some(sess) = map.remove(session_id) {
            let mut child_lock = sess.child.lock().await;
            if let Some(mut child) = child_lock.take() {
                let _ = child.kill().await;
            }
        }
    }
}
