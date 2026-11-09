use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, Emitter, Manager, State};

use tauri_plugin_updater::UpdaterExt;

use crate::apps::{self, AppEntry};
use crate::db::{self, Db};
use crate::models::*;
use crate::recent;
use crate::search;
use crate::sys;

#[derive(Default)]
pub struct IconCache(pub Mutex<HashMap<String, Option<String>>>);

#[derive(Default)]
pub struct Apps(pub Mutex<Vec<AppEntry>>);

#[derive(Default)]
pub struct RecentWatcher(pub Mutex<Option<notify::RecommendedWatcher>>);

pub struct LastForeground(pub Mutex<Option<sys::Foreground>>);

#[derive(Default)]
pub struct UiFlags {
    pub suppress_blur: Mutex<bool>,
}

fn hide_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

pub fn load_settings(app: &AppHandle) -> AppSettings {
    let db = match app.try_state::<Db>() {
        Some(d) => d,
        None => return AppSettings::default(),
    };
    let conn = match db.0.lock() {
        Ok(c) => c,
        Err(_) => return AppSettings::default(),
    };
    match db::get_setting(&conn, "settings") {
        Some(json) => serde_json::from_str(&json).unwrap_or_default(),
        None => AppSettings::default(),
    }
}

pub fn register_hotkey(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let shortcut: tauri_plugin_global_shortcut::Shortcut = hotkey
        .parse()
        .map_err(|_| format!("无法识别的快捷键：{hotkey}"))?;
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())?;
    app.global_shortcut().register(shortcut).map_err(|e| {
        format!("快捷键 {hotkey} 注册失败（可能已被其他程序占用）：{e}")
    })?;
    Ok(())
}

pub fn sync_system_recent(app: &AppHandle) -> i64 {
    // 先做耗时的扫描（COM 解析快捷方式），再短暂持有数据库锁
    let items = recent::system_recent(500);
    let db = match app.try_state::<Db>() {
        Some(d) => d,
        None => return 0,
    };
    let conn = match db.0.lock() {
        Ok(c) => c,
        Err(_) => return 0,
    };
    let n = items.len() as i64;
    for (path, mtime) in items {
        db::touch(&conn, &path, "recent", mtime, false);
    }
    n
}

#[tauri::command]
pub fn list_pinned(state: State<'_, Db>) -> Vec<FileEntry> {
    match state.0.lock() {
        Ok(c) => db::list_pinned(&c),
        Err(_) => vec![],
    }
}

#[tauri::command]
pub fn list_recent(state: State<'_, Db>, limit: Option<i64>) -> Vec<FileEntry> {
    match state.0.lock() {
        Ok(c) => db::list_recent(&c, limit.unwrap_or(80)),
        Err(_) => vec![],
    }
}

#[tauri::command]
pub fn list_all(state: State<'_, Db>, limit: Option<i64>) -> Vec<FileEntry> {
    match state.0.lock() {
        Ok(c) => db::list_scored(&c, limit.unwrap_or(120)),
        Err(_) => vec![],
    }
}

/// 同时搜「开始菜单里的程序」和「库里的文件」。
/// 排序：先按匹配质量分档，同档内程序优先，再按细分分数。
#[tauri::command]
pub fn search_files(
    app: AppHandle,
    state: State<'_, Db>,
    query: String,
    limit: Option<i64>,
) -> Vec<FileEntry> {
    let limit = limit.unwrap_or(60) as usize;
    if query.trim().is_empty() {
        return vec![];
    }
    let mut hits: Vec<(u8, u8, i64, FileEntry)> = Vec::new();

    if let Some(store) = app.try_state::<Apps>() {
        if let Ok(list) = store.0.lock() {
            for item in list.iter() {
                if let Some((tier, sub)) = search::rank(&item.name, &item.pinyin, &item.path, &query) {
                    hits.push((tier, 0, sub, item.to_entry()));
                }
            }
        }
    }

    let entries = match state.0.lock() {
        Ok(c) => db::list_scored(&c, 3000),
        Err(_) => vec![],
    };
    for entry in entries {
        if let Some((tier, sub)) = search::rank(&entry.name, &entry.pinyin, &entry.path, &query) {
            hits.push((tier, 1, sub, entry));
        }
    }

    hits.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| a.1.cmp(&b.1))
            .then_with(|| b.2.cmp(&a.2))
    });
    hits.into_iter().take(limit).map(|(_, _, _, e)| e).collect()
}

pub fn sync_apps(app: &AppHandle) -> i64 {
    let list = apps::scan();
    let n = list.len() as i64;
    if let Some(store) = app.try_state::<Apps>() {
        if let Ok(mut guard) = store.0.lock() {
            *guard = list;
        }
    }
    n
}

#[tauri::command]
pub async fn refresh_apps(app: AppHandle) -> Result<i64, String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || sync_apps(&handle))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_pin(state: State<'_, Db>, path: String) -> bool {
    match state.0.lock() {
        Ok(c) => db::toggle_pin(&c, &path),
        Err(_) => false,
    }
}

#[tauri::command]
pub fn reorder_pins(state: State<'_, Db>, paths: Vec<String>) {
    if let Ok(c) = state.0.lock() {
        db::reorder_pins(&c, &paths);
    }
}

#[tauri::command]
pub fn set_group(state: State<'_, Db>, path: String, group: Option<String>) {
    if let Ok(c) = state.0.lock() {
        db::set_group(&c, &path, group.as_deref());
    }
}

#[tauri::command]
pub fn remove_file(state: State<'_, Db>, path: String) {
    if let Ok(c) = state.0.lock() {
        db::remove(&c, &path);
    }
}

#[tauri::command]
pub fn record_open(state: State<'_, Db>, path: String) {
    if let Ok(c) = state.0.lock() {
        db::bump_open(&c, &path);
    }
}

#[tauri::command]
pub fn open_file(app: AppHandle, state: State<'_, Db>, path: String) -> Result<(), String> {
    sys::open_path(&path)?;
    if let Ok(c) = state.0.lock() {
        // 记录这次打开：既是使用频次，也顺便把「刚启动过的程序」留在最近列表里
        let source = if path.to_lowercase().ends_with(".lnk") {
            "app"
        } else {
            "manual"
        };
        db::touch(&c, &path, source, db::now_secs(), true);
    }
    hide_main(&app);
    Ok(())
}

#[tauri::command]
pub fn reveal_file(app: AppHandle, path: String) -> Result<(), String> {
    let r = sys::reveal_path(&path);
    hide_main(&app);
    r
}

#[tauri::command]
pub fn get_icon(app: AppHandle, path: String) -> Option<String> {
    let cache = app.state::<IconCache>();
    let ext = Path::new(&path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    // 快捷方式 / 可执行文件按完整路径缓存，其余按扩展名缓存（图标通常一致）
    let key = if ext.is_empty() || ext == "lnk" || ext == "exe" || ext == "ico" || ext == "url" {
        path.clone()
    } else {
        ext.clone()
    };

    if let Ok(c) = cache.0.lock() {
        if let Some(v) = c.get(&key) {
            return v.clone();
        }
    }

    // 快捷方式取目标程序的图标，而不是带小箭头的快捷方式图标
    let source = if ext == "lnk" {
        recent::resolve_lnk(&path).unwrap_or_else(|| path.clone())
    } else {
        path.clone()
    };
    let value =
        sys::icon_png(&source).map(|png| format!("data:image/png;base64,{}", STANDARD.encode(png)));
    if let Ok(mut c) = cache.0.lock() {
        c.insert(key, value.clone());
    }
    value
}

const CHROME_WORDS: &[&str] = &[
    "word", "excel", "powerpoint", "wps", "notepad", "记事本", "写字板", "visual studio code",
    "visual studio", "pycharm", "intellij idea", "webstorm", "sublime text", "typora", "obsidian",
    "acrobat", "reader", "photoshop", "illustrator", "figma", "blender", "autoCAD", "chrome",
    "edge", "firefox", "explorer", "文件资源管理器",
];

fn split_title(title: &str) -> Vec<String> {
    let mut parts = vec![title.trim().to_string()];
    for sep in [" - ", " – ", " — ", " | ", " · ", " :: "] {
        let mut next: Vec<String> = Vec::new();
        for p in parts {
            for seg in p.split(sep) {
                let seg = seg.trim().to_string();
                if !seg.is_empty() {
                    next.push(seg);
                }
            }
        }
        parts = next;
    }
    parts
}

fn looks_like_document(seg: &str, exe: &str) -> bool {
    if seg.len() < 3 {
        return false;
    }
    let lower = seg.to_lowercase();
    if lower == exe.to_lowercase() {
        return false;
    }
    if CHROME_WORDS.iter().any(|w| lower == *w) {
        return false;
    }
    true
}

fn resolve_candidates(state: &Db, title: &str, exe: &str) -> Vec<Candidate> {
    let mut out: Vec<Candidate> = Vec::new();
    let conn = match state.0.lock() {
        Ok(c) => c,
        Err(_) => return out,
    };

    let mut push = |path: String, confidence: &str, reason: &str| {
        let path = path.replace('/', "\\");
        if out.iter().any(|c| c.path.eq_ignore_ascii_case(&path)) {
            return;
        }
        let name = Path::new(&path)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        out.push(Candidate {
            path,
            name,
            confidence: confidence.to_string(),
            reason: reason.to_string(),
        });
    };

    for seg in split_title(title) {
        if seg.contains(":\\") && Path::new(&seg).is_file() {
            push(seg.clone(), "high", "窗口标题中的完整路径");
            continue;
        }
        if !looks_like_document(&seg, exe) {
            continue;
        }
        let lower = seg.to_lowercase();
        let exact: Option<String> = conn
            .query_row(
                "SELECT path FROM files WHERE name_lower = ?1 ORDER BY last_opened DESC LIMIT 1",
                rusqlite::params![lower],
                |r| r.get(0),
            )
            .ok();
        if let Some(p) = exact {
            push(p, "high", "文件名精确匹配");
            continue;
        }
        let like = format!("%{}%", lower);
        let fuzzy: Option<String> = conn
            .query_row(
                "SELECT path FROM files WHERE name_lower LIKE ?1 ORDER BY last_opened DESC LIMIT 1",
                rusqlite::params![like],
                |r| r.get(0),
            )
            .ok();
        if let Some(p) = fuzzy {
            push(p, "medium", "文件名相似匹配");
            continue;
        }
        if let Some(p) = recent::resolve_by_name(&seg) {
            push(p, "high", "系统最近记录命中");
        }
    }
    out
}

#[tauri::command]
pub fn detect_foreground(app: AppHandle, state: State<'_, Db>) -> ForegroundInfo {
    let cached = {
        let store = app.state::<LastForeground>();
        let guard = store.0.lock().ok();
        guard.and_then(|g| g.as_ref().map(|f| (f.title.clone(), f.exe_name.clone())))
    };
    let (title, exe_name) = cached.unwrap_or_else(|| {
        let fg = sys::foreground();
        (fg.title, fg.exe_name)
    });
    let candidates = resolve_candidates(&state, &title, &exe_name);
    ForegroundInfo {
        title,
        exe_name,
        candidates,
    }
}

#[tauri::command]
pub fn add_paths(state: State<'_, Db>, paths: Vec<String>) -> i64 {
    let conn = match state.0.lock() {
        Ok(c) => c,
        Err(_) => return 0,
    };
    let mut n = 0;
    for p in paths {
        if Path::new(&p).is_file() {
            let source = if p.to_lowercase().ends_with(".lnk") {
                "app"
            } else {
                "manual"
            };
            db::touch(&conn, &p, source, db::now_secs(), false);
            n += 1;
        }
    }
    n
}

#[tauri::command]
pub fn cleanup_missing(state: State<'_, Db>) -> i64 {
    match state.0.lock() {
        Ok(c) => db::cleanup_missing(&c),
        Err(_) => 0,
    }
}

#[tauri::command]
pub fn verify_files(state: State<'_, Db>) -> i64 {
    match state.0.lock() {
        Ok(c) => db::verify_all(&c),
        Err(_) => 0,
    }
}

#[tauri::command]
pub fn stats(state: State<'_, Db>) -> Stats {
    let conn = match state.0.lock() {
        Ok(c) => c,
        Err(_) => {
            return Stats {
                total: 0,
                pinned: 0,
                missing: 0,
                top_files: vec![],
            }
        }
    };
    let total = db::count(&conn, "");
    let pinned = db::count(&conn, "WHERE pinned = 1");
    let missing = db::count(&conn, "WHERE missing = 1");
    let top_files = conn
        .prepare("SELECT id, path, name, ext, size, mtime, open_count, last_opened, pinned, pin_order, group_name, missing, source, pinyin FROM files WHERE open_count > 0 ORDER BY open_count DESC LIMIT 5")
        .and_then(|mut stmt| {
            stmt.query_map([], |r| {
                Ok(FileEntry {
                    id: r.get(0)?,
                    path: r.get(1)?,
                    name: r.get(2)?,
                    ext: r.get(3)?,
                    size: r.get(4)?,
                    mtime: r.get(5)?,
                    open_count: r.get(6)?,
                    last_opened: r.get(7)?,
                    pinned: r.get::<_, i64>(8)? == 1,
                    pin_order: r.get(9)?,
                    group_name: r.get(10)?,
                    missing: r.get::<_, i64>(11)? == 1,
                    source: r.get(12)?,
                    score: 0.0,
                    pinyin: r.get::<_, String>(13).unwrap_or_default(),
                })
            })
            .map(|it| it.filter_map(|x| x.ok()).collect::<Vec<_>>())
        })
        .unwrap_or_default();
    Stats {
        total,
        pinned,
        missing,
        top_files,
    }
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> AppSettings {
    load_settings(&app)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let previous = load_settings(&app);
    {
        let db = app.state::<Db>();
        let conn = db.0.lock().map_err(|_| "数据库被占用".to_string())?;
        let json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
        db::set_setting(&conn, "settings", &json);
    }
    if previous.hotkey != settings.hotkey {
        register_hotkey(&app, &settings.hotkey)?;
    }

    use tauri_plugin_autostart::ManagerExt;
    let autolaunch = app.autolaunch();
    let enabled = autolaunch.is_enabled().unwrap_or(false);
    if settings.autostart && !enabled {
        let _ = autolaunch.enable();
    } else if !settings.autostart && enabled {
        let _ = autolaunch.disable();
    }
    Ok(())
}

#[tauri::command]
pub async fn refresh_recent(app: AppHandle) -> Result<i64, String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || sync_system_recent(&handle))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_blur_guard(app: AppHandle, suppress: bool) {
    if let Some(flags) = app.try_state::<UiFlags>() {
        if let Ok(mut g) = flags.suppress_blur.lock() {
            *g = suppress;
        }
    }
}

#[derive(serde::Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub current: String,
    pub notes: String,
}

fn build_updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    app.updater()
        .map_err(|e| format!("更新器初始化失败：{e}"))
}

const ADVANCED_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";

/// Windows「在开始菜单、跳转列表和文件资源管理器中显示最近打开的项目」
fn recent_tracking_enabled() -> bool {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(ADVANCED_KEY, KEY_READ)
        .and_then(|k| k.get_value::<u32, _>("Start_TrackDocs"))
        .map(|v| v == 1)
        // 读不到时按系统默认（开启）处理，避免误报
        .unwrap_or(true)
}

#[tauri::command]
pub fn recent_tracking() -> bool {
    recent_tracking_enabled()
}

#[tauri::command]
pub fn enable_recent_tracking(app: AppHandle) -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(ADVANCED_KEY, KEY_SET_VALUE)
        .map_err(|e| format!("无法打开注册表：{e}"))?;
    key.set_value("Start_TrackDocs", &1u32)
        .map_err(|e| format!("写入失败：{e}"))?;

    // 立刻同步一次，并通知界面刷新
    let handle = app.clone();
    std::thread::spawn(move || {
        commands_sync(&handle);
    });
    Ok(())
}

fn commands_sync(app: &AppHandle) {
    sync_system_recent(app);
    let _ = app.emit("data-changed", ());
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = build_updater(&app)?;
    let found = updater
        .check()
        .await
        .map_err(|e| format!("检查更新失败：{e}"))?;
    Ok(found.map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone().unwrap_or_default(),
    }))
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = build_updater(&app)?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("检查更新失败：{e}"))?
        .ok_or_else(|| "当前已经是最新版本".to_string())?;

    let handle = app.clone();
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            move |chunk: usize, total: Option<u64>| {
                downloaded += chunk as u64;
                let _ = handle.emit(
                    "update-progress",
                    serde_json::json!({ "downloaded": downloaded, "total": total }),
                );
            },
            || {},
        )
        .await
        .map_err(|e| format!("下载或安装更新失败：{e}"))?;

    app.restart()
}

#[tauri::command]
pub fn hide_window(app: AppHandle) {
    hide_main(&app);
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn pin_foreground_result(app: AppHandle, path: String) -> bool {
    let state = app.state::<Db>();
    let pinned = match state.0.lock() {
        Ok(c) => db::toggle_pin(&c, &path),
        Err(_) => false,
    };
    let _ = app.emit("pins-changed", ());
    pinned
}
