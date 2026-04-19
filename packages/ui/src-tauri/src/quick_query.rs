use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub fn spawn_or_focus(app: &AppHandle) -> tauri::Result<()> {
    if let Some(existing) = app.get_webview_window("quick-query") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(app, "quick-query", WebviewUrl::App("index.html#/quick".into()))
        .inner_size(560.0, 220.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .focused(true)
        .build()?;

    let handle_for_event = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Focused(false)) {
            let hnd = handle_for_event.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                if let Some(win) = hnd.get_webview_window("quick-query") {
                    let _ = win.close();
                }
            });
        }
    });
    Ok(())
}
