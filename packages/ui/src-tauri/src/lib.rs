mod gateway_bridge;
mod quick_query;
mod tray;

use gateway_bridge::{connect_and_run, BridgeState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(BridgeState::new())
        .invoke_handler(tauri::generate_handler![
            gateway_bridge::rpc_call,
            gateway_bridge::shell_start_gateway,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            tray::init_tray(app.handle())?;
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            let state = handle.state::<BridgeState>();
            let bridge_for_task = BridgeState {
                writer: state.writer.clone(),
                pending: state.pending.clone(),
                next_id: state.next_id.clone(),
            };
            tauri::async_runtime::spawn(async move {
                connect_and_run(handle, bridge_for_task).await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
