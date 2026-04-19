use interprocess::local_socket::{
    tokio::{prelude::*, Stream},
    GenericFilePath, ToFsName,
};
#[cfg(target_os = "windows")]
use interprocess::local_socket::{GenericNamespaced, ToNsName};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::sleep;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct PendingHitl {
    pub request_id: String,
    pub prompt: String,
    pub details: Option<Value>,
    pub received_at_ms: u64,
}

pub struct HitlInbox {
    list: StdMutex<Vec<PendingHitl>>,
}

impl HitlInbox {
    pub fn new() -> Self {
        Self {
            list: StdMutex::new(Vec::new()),
        }
    }
    pub fn push_dedup(&self, r: PendingHitl) -> bool {
        let mut g = self.list.lock().unwrap();
        if g.iter().any(|x| x.request_id == r.request_id) {
            return false;
        }
        g.push(r);
        true
    }
    pub fn remove(&self, request_id: &str) {
        let mut g = self.list.lock().unwrap();
        g.retain(|x| x.request_id != request_id);
    }
    pub fn snapshot(&self) -> Vec<PendingHitl> {
        self.list.lock().unwrap().clone()
    }
}

impl Default for HitlInbox {
    fn default() -> Self {
        Self::new()
    }
}

pub const ALLOWED_METHODS: &[&str] = &[
    // Sub-project A
    "diag.snapshot",
    "connector.list",
    "connector.startAuth",
    "engine.askStream",
    "db.getMeta",
    "db.setMeta",
    // Sub-project B additions
    "connector.listStatus",
    "index.metrics",
    "audit.list",
    "consent.respond",
];

pub fn is_method_allowed(method: &str) -> bool {
    ALLOWED_METHODS.contains(&method)
}

type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, Value>>>>>;

pub struct BridgeState {
    pub(crate) write_tx: Arc<Mutex<Option<mpsc::Sender<Vec<u8>>>>>,
    pub(crate) pending: PendingMap,
    pub(crate) next_id: Arc<Mutex<u64>>,
}

impl BridgeState {
    pub fn new() -> Self {
        Self {
            write_tx: Arc::new(Mutex::new(None)),
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
            let name =
                std::env::var("NIMBUS_SOCKET").unwrap_or_else(|_| "nimbus-gateway".to_string());
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
                let (tx, rx) = mpsc::channel::<Vec<u8>>(16);
                {
                    let mut w = state.write_tx.lock().await;
                    *w = Some(tx);
                }
                let _ = app.emit("gateway://connection-state", "connected");
                let pending = state.pending.clone();
                let app_cloned = app.clone();
                let reader = BufReader::new(read_half);
                let writer_task = tokio::spawn(run_write_loop(write_half, rx));
                run_read_loop(reader, pending, app_cloned).await;
                writer_task.abort();
                let mut w = state.write_tx.lock().await;
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

async fn run_write_loop<W>(mut writer: W, mut rx: mpsc::Receiver<Vec<u8>>)
where
    W: AsyncWriteExt + Unpin,
{
    while let Some(data) = rx.recv().await {
        if writer.write_all(&data).await.is_err() {
            break;
        }
        if writer.flush().await.is_err() {
            break;
        }
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
        } else if let Some(method) = msg.get("method").and_then(|v| v.as_str()).map(String::from) {
            classify_notification(&app, &method, msg.get("params"));
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
    let tx = {
        let guard = state.write_tx.lock().await;
        guard
            .as_ref()
            .ok_or_else(|| "ERR_GATEWAY_OFFLINE".to_string())?
            .clone()
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

    let (resp_tx, resp_rx) = oneshot::channel();
    state.pending.lock().await.insert(id.clone(), resp_tx);

    if tx.send(line.into_bytes()).await.is_err() {
        state.pending.lock().await.remove(&id);
        return Err("ERR_GATEWAY_OFFLINE".into());
    }

    match resp_rx.await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err("ERR_GATEWAY_OFFLINE".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_ws5a_methods() {
        assert!(is_method_allowed("diag.snapshot"));
        assert!(is_method_allowed("connector.list"));
        assert!(is_method_allowed("connector.startAuth"));
        assert!(is_method_allowed("engine.askStream"));
        assert!(is_method_allowed("db.getMeta"));
        assert!(is_method_allowed("db.setMeta"));
    }

    #[test]
    fn allowlist_ws5b_additions() {
        assert!(is_method_allowed("connector.listStatus"));
        assert!(is_method_allowed("index.metrics"));
        assert!(is_method_allowed("audit.list"));
        assert!(is_method_allowed("consent.respond"));
    }

    #[test]
    fn allowlist_rejects_vault_and_raw_db_writes() {
        assert!(!is_method_allowed("vault.get"));
        assert!(!is_method_allowed("vault.set"));
        assert!(!is_method_allowed("vault.list"));
        assert!(!is_method_allowed("db.put"));
        assert!(!is_method_allowed("db.delete"));
        assert!(!is_method_allowed("config.set"));
        assert!(!is_method_allowed("index.rebuild"));
    }

    #[test]
    fn allowlist_exact_size() {
        // Prevents accidental additions without an updated test.
        assert_eq!(ALLOWED_METHODS.len(), 10);
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

#[tauri::command]
pub async fn get_pending_hitl(state: State<'_, HitlInbox>) -> Result<Vec<PendingHitl>, String> {
    Ok(state.snapshot())
}

#[tauri::command]
pub async fn hitl_resolved(
    app: AppHandle,
    state: State<'_, HitlInbox>,
    request_id: String,
    approved: bool,
) -> Result<(), String> {
    state.remove(&request_id);
    let _ = app.emit(
        "consent://resolved",
        json!({ "request_id": request_id, "approved": approved }),
    );
    Ok(())
}

fn classify_notification(app: &AppHandle, method: &str, params: Option<&Value>) {
    match method {
        "consent.request" => {
            let Some(params) = params else {
                return;
            };
            let (Some(request_id), Some(prompt)) = (
                params
                    .get("requestId")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                params
                    .get("prompt")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            ) else {
                return;
            };
            let received_at_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let details = params.get("details").cloned();
            let record = PendingHitl {
                request_id,
                prompt,
                details,
                received_at_ms,
            };
            if let Some(inbox) = app.try_state::<HitlInbox>() {
                if inbox.push_dedup(record.clone()) {
                    let _ = app.emit("consent://request", &record);
                    let _ = crate::hitl_popup::open_or_focus(app);
                }
            }
        }
        "connector.healthChanged" => {
            if let Some(p) = params.cloned() {
                let _ = app.emit("connector://health-changed", p);
            }
        }
        _ => {}
    }
}
