use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use cybervps-protocol::AgentMessage;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, error, info};

pub struct ActiveTunnelStream {
    pub stream_id: String,
    pub writer: Arc<Mutex<Option<OwnedWriteHalf>>>,
}

pub struct TunnelManager {
    streams: Arc<Mutex<HashMap<String, ActiveTunnelStream>>>,
}

impl Default for TunnelManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TunnelManager {
    pub fn new() -> Self {
        Self {
            streams: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn open_stream(
        &self,
        tunnel_id: String,
        stream_id: String,
        target_port: u16,
        agent_outbox: mpsc::Sender<AgentMessage>,
    ) -> anyhow::Result<()> {
        let addr = format!("127.0.0.1:{}", target_port);
        let stream = match TcpStream::connect(&addr).await {
            Ok(s) => s,
            Err(e) => {
                let _ = agent_outbox
                    .send(AgentMessage::TunnelStreamOpened {
                        tunnel_id: tunnel_id.clone(),
                        stream_id: stream_id.clone(),
                        success: false,
                        error: Some(format!("Failed to connect to localhost:{}: {}", target_port, e)),
                    })
                    .await;
                return Err(e.into());
            }
        };

        let (mut reader, writer) = stream.into_split();
        let writer_arc = Arc::new(Mutex::new(Some(writer)));

        let mut map = self.streams.lock().await;
        map.insert(
            stream_id.clone(),
            ActiveTunnelStream {
                stream_id: stream_id.clone(),
                writer: writer_arc,
            },
        );

        // Notify server that stream connected to local port successfully
        let _ = agent_outbox
            .send(AgentMessage::TunnelStreamOpened {
                tunnel_id: tunnel_id.clone(),
                stream_id: stream_id.clone(),
                success: true,
                error: None,
            })
            .await;

        let tid = tunnel_id.clone();
        let sid = stream_id.clone();
        let outbox = agent_outbox.clone();

        // Spawn reader from local target port back to Relay
        tokio::spawn(async move {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf).await {
                    Ok(0) => {
                        debug!("Local service closed socket for stream {}", sid);
                        break;
                    }
                    Ok(n) => {
                        let encoded = BASE64.encode(&buf[..n]);
                        if outbox
                            .send(AgentMessage::TunnelData {
                                tunnel_id: tid.clone(),
                                stream_id: sid.clone(),
                                data_base64: encoded,
                            })
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(e) => {
                        error!("Read error from local port for stream {}: {}", sid, e);
                        break;
                    }
                }
            }

            let _ = outbox
                .send(AgentMessage::TunnelStreamClosed {
                    tunnel_id: tid,
                    stream_id: sid,
                })
                .await;
        });

        Ok(())
    }

    pub async fn write_data(&self, stream_id: &str, data: &[u8]) -> anyhow::Result<()> {
        let map = self.streams.lock().await;
        if let Some(stream) = map.get(stream_id) {
            let mut writer_lock = stream.writer.lock().await;
            if let Some(ref mut writer) = *writer_lock {
                writer.write_all(data).await?;
                writer.flush().await?;
            }
        }
        Ok(())
    }

    pub async fn close_stream(&self, stream_id: &str) {
        let mut map = self.streams.lock().await;
        if let Some(stream) = map.remove(stream_id) {
            let mut writer_lock = stream.writer.lock().await;
            *writer_lock = None;
        }
    }
}
