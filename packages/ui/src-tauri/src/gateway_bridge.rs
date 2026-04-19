use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

pub const ALLOWED_METHODS: &[&str] = &[
    "diag.snapshot",
    "connector.list",
    "connector.startAuth",
    "engine.askStream",
    "db.getMeta",
    "db.setMeta",
];

#[derive(Debug, Serialize, Deserialize)]
pub struct RpcError(pub String);

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for RpcError {}

pub struct BridgeState;

impl BridgeState {
    pub fn new() -> Self {
        Self
    }
}

pub fn is_method_allowed(method: &str) -> bool {
    ALLOWED_METHODS.iter().any(|&m| m == method)
}

#[tauri::command]
pub async fn rpc_call(
    _state: State<'_, BridgeState>,
    method: String,
    _params: Value,
) -> Result<Value, String> {
    if !is_method_allowed(&method) {
        return Err(format!("ERR_METHOD_NOT_ALLOWED:{}", method));
    }
    Err("ERR_GATEWAY_OFFLINE".into())
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
