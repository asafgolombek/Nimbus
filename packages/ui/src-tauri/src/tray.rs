use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Listener, Manager};

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum TrayIconState {
    Normal,
    Amber,
    Red,
}

#[derive(Deserialize)]
struct TrayStateChange {
    icon: TrayIconState,
    #[serde(default)]
    badge: u32,
}

fn icon_bytes(state: TrayIconState) -> &'static [u8] {
    match state {
        TrayIconState::Normal => include_bytes!("../icons/tray-normal.png"),
        TrayIconState::Amber => include_bytes!("../icons/tray-amber.png"),
        TrayIconState::Red => include_bytes!("../icons/tray-red.png"),
    }
}

pub fn init_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItemBuilder::with_id("open-dashboard", "Open Dashboard").build(app)?;
    let quick = MenuItemBuilder::with_id("quick-query", "Quick Query\tCtrl+Shift+N").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&open, &quick, &settings, &quit])
        .build()?;

    #[cfg(target_os = "macos")]
    let icon_is_template = true;
    #[cfg(not(target_os = "macos"))]
    let icon_is_template = false;

    let tray = TrayIconBuilder::with_id("nimbus-tray")
        .icon(Image::from_bytes(if icon_is_template {
            include_bytes!("../icons/tray-template.png")
        } else {
            icon_bytes(TrayIconState::Normal)
        })?)
        .icon_as_template(icon_is_template)
        .menu(&menu)
        .on_menu_event(|app_handle, event| match event.id().as_ref() {
            "open-dashboard" => focus_main(app_handle),
            "quick-query" => { let _ = crate::quick_query::spawn_or_focus(app_handle); },
            "settings" => {
                focus_main(app_handle);
                let _ = app_handle.emit("tray://navigate", "/settings");
            }
            "quit" => app_handle.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|_icon, _event: TrayIconEvent| {})
        .build(app)?;

    let tray_for_listener = tray.clone();
    app.listen("tray://state-changed", move |event| {
        let Ok(change) = serde_json::from_str::<TrayStateChange>(event.payload()) else { return };
        let bytes = icon_bytes(change.icon);
        let _ = tray_for_listener.set_icon(Some(Image::from_bytes(bytes).unwrap()));
        let tooltip = if change.badge > 0 {
            format!("Nimbus ({} pending)", change.badge)
        } else {
            "Nimbus".to_string()
        };
        let _ = tray_for_listener.set_tooltip(Some(tooltip));
    });

    Ok(())
}

fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}
