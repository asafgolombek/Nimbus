use interprocess::local_socket::{
    tokio::{prelude::*, Stream},
    GenericFilePath, GenericNamespaced, ToFsName, ToNsName,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{oneshot, Mutex};
use tokio::time::sleep;

pub const ALLOWED_METHODS: &[&str] = &[
    "diag.snapshot",
    "connector.list",
    "connector.startAuth",
    "engine.askStream",
    "db.getMeta",
    "db.setMeta",
];

pub fn is_method_allowed(method: &str) -> bool {
    ALLOWED_METHODS.iter().any(|&m| m == method)
}

type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, Value>>>>>;

pub struct BridgeState {
    pub(crate) writer: Arc<Mutex<Option<Box<dyn AsyncWriteExt + Send + Unpin>>>>,
    pub(crate) pending: PendingMap,
    pub(crate) next_id: Arc<Mutex<u64>>,
}

impl BridgeState {
    pub fn new() -> Self {
        Self {
            writer: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(Mutex::new(0)),
        }
    }
}

pub async fn connect_and_run(app: AppHandle, state: BridgeState) {
    let mut attempt: u32 = 0;
    loop {
        let _ = app.emit("gateway://connection-state", "connecting");

        #[cfg(target_os = "windows")]
        let connect_result = {
            let name = std::env::var("NIMBUS_SOCKET")
                .unwrap_or_else(|_| "nimbus-gateway".to_string());
            let ns_name = name
                .to_ns_name::<GenericNamespaced>()
                .expect("valid named pipe");
            Stream::connect(ns_name).await
        };

        #[cfg(not(target_os = "windows"))]
        let connect_result = {
            let path = std::env::var("NIMBUS_SOCKET").unwrap_or_else(|_| {
                let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
                format!("{}/.local/share/nimbus/nimbus.sock", home)
            });
            let fs_name = path
                .to_fs_name::<GenericFilePath>()
                .expect("valid socket path");
            Stream::connect(fs_name).await
        };

        match connect_result {
            Ok(stream) => {
                attempt = 0;
                let (read_half, write_half) = stream.split();
                {
                    let mut w = state.writer.lock().await;
                    *w = Some(Box::new(write_half));
                }
                let _ = app.emit("gateway://connection-state", "connected");
                let pending = state.pending.clone();
                let app_cloned = app.clone();
                let reader = BufReader::new(read_half);
                run_read_loop(reader, pending, app_cloned).await;
                let mut w = state.writer.lock().await;
                *w = None;
            }
            Err(_err) => {}
        }
        let _ = app.emit("gateway://connection-state", "disconnected");
        let backoff_ms = match attempt {
            0 => 200,
            1 => 2_000,
            _ => 10_000,
        };
        attempt = attempt.saturating_add(1);
        sleep(Duration::from_millis(backoff_ms)).await;
    }
}

async fn run_read_loop<R>(reader: BufReader<R>, pending: PendingMap, app: AppHandle)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(id) = msg.get("id").and_then(|v| v.as_str()).map(String::from) {
            let mut map = pending.lock().await;
            if let Some(tx) = map.remove(&id) {
                let payload = if let Some(err) = msg.get("error") {
                    Err(err.clone())
                } else {
                    Ok(msg.get("result").cloned().unwrap_or(Value::Null))
                };
                let _ = tx.send(payload);
            }
        } else if msg.get("method").is_some() {
            let _ = app.emit("gateway://notification", msg);
        }
    }
    let mut map = pending.lock().await;
    for (_id, tx) in map.drain() {
        let _ = tx.send(Err(Value::String("ERR_GATEWAY_OFFLINE".into())));
    }
}

#[tauri::command]
pub async fn rpc_call(
    state: State<'_, BridgeState>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    if !is_method_allowed(&method) {
        return Err(format!("ERR_METHOD_NOT_ALLOWED:{}", method));
    }
    let writer_slot = state.writer.clone();
    let mut writer_guard = writer_slot.lock().await;
    let Some(writer) = writer_guard.as_mut() else {
        return Err("ERR_GATEWAY_OFFLINE".into());
    };
    let mut id_guard = state.next_id.lock().await;
    *id_guard = id_guard.wrapping_add(1);
    let id = format!("r{}", *id_guard);
    drop(id_guard);

    let frame = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": if params.is_null() { Value::Null } else { params },
    });
    let mut line = frame.to_string();
    line.push('\n');
    writer
        .write_all(line.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    writer.flush().await.map_err(|e| e.to_string())?;
    drop(writer_guard);

    let (tx, rx) = oneshot::channel();
    state.pending.lock().await.insert(id, tx);
    match rx.await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err("ERR_GATEWAY_OFFLINE".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_contains_expected_methods() {
        assert!(is_method_allowed("diag.snapshot"));
        assert!(is_method_allowed("connector.list"));
        assert!(is_method_allowed("connector.startAuth"));
        assert!(is_method_allowed("engine.askStream"));
        assert!(is_method_allowed("db.getMeta"));
        assert!(is_method_allowed("db.setMeta"));
    }

    #[test]
    fn allowlist_rejects_sensitive_methods() {
        assert!(!is_method_allowed("vault.get"));
        assert!(!is_method_allowed("vault.set"));
        assert!(!is_method_allowed("db.query"));
        assert!(!is_method_allowed("engine.ask"));
    }

    #[test]
    fn allowlist_rejects_empty_and_unknown() {
        assert!(!is_method_allowed(""));
        assert!(!is_method_allowed("unknown.method"));
    }
}

use tauri_plugin_shell::ShellExt;

#[tauri::command]
pub async fn shell_start_gateway(app: AppHandle) -> Result<(), String> {
    app.shell()
        .command("nimbus")
        .args(["start"])
        .spawn()
        .map(|_child| ())
        .map_err(|e| format!("Failed to launch nimbus: {e} (is it on PATH?)"))
}
