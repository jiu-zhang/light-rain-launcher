pub mod apps;
mod commands;
mod db;
mod models;
mod recent;
mod search;
mod sys;

use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{ShortcutState};

use commands::{Apps, IconCache, LastForeground, UiFlags};

fn show_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_always_on_top(true);
        let _ = w.set_focus();
        let _ = app.emit("window-shown", ());
    }
}

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let visible = w.is_visible().unwrap_or(false);
        let focused = w.is_focused().unwrap_or(false);
        if visible && focused {
            let _ = w.hide();
        } else {
            show_window(app);
        }
    }
}

fn capture_foreground(app: &tauri::AppHandle) {
    if let Some(store) = app.try_state::<LastForeground>() {
        let fg = sys::foreground();
        if let Ok(mut g) = store.0.lock() {
            *g = Some(fg);
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        capture_foreground(app);
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::list_pinned,
            commands::list_recent,
            commands::list_all,
            commands::search_files,
            commands::toggle_pin,
            commands::reorder_pins,
            commands::set_group,
            commands::remove_file,
            commands::record_open,
            commands::open_file,
            commands::reveal_file,
            commands::get_icon,
            commands::detect_foreground,
            commands::add_paths,
            commands::cleanup_missing,
            commands::verify_files,
            commands::stats,
            commands::get_settings,
            commands::save_settings,
            commands::refresh_recent,
            commands::refresh_apps,
            commands::app_version,
            commands::check_update,
            commands::install_update,
            commands::set_blur_guard,
            commands::hide_window,
            commands::quit_app,
            commands::pin_foreground_result,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let dir = handle.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("light-rain.db"))?;
            app.manage(db::Db(Mutex::new(conn)));
            app.manage(Apps::default());
            app.manage(IconCache::default());
            app.manage(LastForeground(Mutex::new(None)));
            app.manage(UiFlags::default());

            build_tray(app)?;

            let settings = commands::load_settings(&handle);
            if commands::register_hotkey(&handle, &settings.hotkey).is_err() {
                let _ = commands::register_hotkey(&handle, "Ctrl+Alt+Space");
            }

            // 后台索引开始菜单里的应用
            let app_scan = handle.clone();
            std::thread::spawn(move || {
                commands::sync_apps(&app_scan);
            });

            let bg = handle.clone();
            std::thread::spawn(move || {
                if commands::load_settings(&bg).sync_system_recent {
                    commands::sync_system_recent(&bg);
                    let _ = bg.emit("data-changed", ());
                }
            });

            let empty = {
                let state = handle.state::<db::Db>();
                state.0.lock().map(|c| db::count(&c, "")).unwrap_or(0) == 0
            };
            // 开机自启时静默待在托盘，手动启动则直接亮出来
            let silent = std::env::args().any(|a| a == "--hidden");
            if !silent {
                let late = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    show_window(&late);
                });
            }
            if empty {
                // 首次启动：用常用目录里最近修改的文件垫底，并立刻展示窗口
                let seed = handle.clone();
                std::thread::spawn(move || {
                    let items = recent::scan_common_dirs(40);
                    if let Some(state) = seed.try_state::<db::Db>() {
                        if let Ok(conn) = state.0.lock() {
                            for (path, mtime) in items {
                                db::touch(&conn, &path, "scan", mtime, false);
                            }
                        }
                    }
                    let _ = seed.emit("data-changed", ());
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Focused(false) => {
                let app = window.app_handle();
                let suppressed = app
                    .try_state::<UiFlags>()
                    .and_then(|f| f.suppress_blur.lock().ok().map(|g| *g))
                    .unwrap_or(false);
                if !suppressed && commands::load_settings(app).hide_on_blur {
                    let _ = window.hide();
                }
            }
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("LightRain 启动失败");
}

fn build_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show_i = MenuItem::with_id(app, "show", "显示 LightRain", true, None::<&str>)?;
    let pin_i = MenuItem::with_id(app, "pin_current", "固定当前正在编辑的文件", true, None::<&str>)?;
    let refresh_i = MenuItem::with_id(app, "refresh", "同步系统最近文件", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show_i, &pin_i, &refresh_i, &sep, &quit_i])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("LightRain — 最近与置顶文件")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id.as_ref() {
            "show" => show_window(app),
            "pin_current" => {
                capture_foreground(app);
                show_window(app);
                let _ = app.emit("pin-current-request", ());
            }
            "refresh" => {
                let h = app.clone();
                std::thread::spawn(move || {
                    commands::sync_system_recent(&h);
                    let _ = h.emit("data-changed", ());
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}
