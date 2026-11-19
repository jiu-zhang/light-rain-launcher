use serde::{de::DeserializeOwned, Serialize};
use tauri::{AppHandle, Manager};

use crate::db::{self, Db};
use crate::models::AppSettings;

/// 应用级设置。旧的 settings 表键会在迁移时复制到这里。
pub const APP_SETTINGS: &str = "app.settings";

pub fn tool_key(tool_id: &str) -> String {
    format!("tool.{tool_id}.settings")
}

pub fn valid_tool_id(tool_id: &str) -> bool {
    !tool_id.is_empty()
        && tool_id.len() <= 40
        && tool_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn get_json<T: DeserializeOwned>(app: &AppHandle, key: &str) -> Option<T> {
    let db = app.try_state::<Db>()?;
    let conn = db.0.lock().ok()?;
    db::get_config(&conn, key)
        .and_then(|raw| serde_json::from_str(&raw).ok())
}

pub fn set_json<T: Serialize>(app: &AppHandle, key: &str, value: &T) -> Result<(), String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().map_err(|_| "数据库被占用".to_string())?;
    let json = serde_json::to_string(value).map_err(|e| e.to_string())?;
    db::set_config(&conn, key, &json);
    Ok(())
}

pub fn get_app_settings(app: &AppHandle) -> AppSettings {
    get_json(app, APP_SETTINGS).unwrap_or_default()
}
