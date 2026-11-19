//! 邮件工具：配置、DPAPI 密钥、SMTP 发送。
//!
//! 密码永远不会回传前端；前端只知道「是否已保存」。

pub mod config;
mod secret;
mod smtp;

pub use config::MailConfig;

use serde::Deserialize;
use tauri::AppHandle;

use crate::config as app_config;
use crate::tools::{ToolAction, ToolError, ToolHit};

const TOOL_ID: &str = "mail";
const SETTINGS_KEY: &str = "mail";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailDraft {
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    /// 纯文本正文，用于不支持 HTML 的客户端
    pub body: String,
    /// 可选的 HTML 正文，会作为 multipart/alternative 发送
    #[serde(default)]
    pub html: String,
    pub attachments: Vec<String>,
}

/// 在工具搜索里产出一条「写邮件」入口
pub fn search_hit(query: &str) -> Option<ToolHit> {
    const KEYWORDS: &[&str] = &["mail", "email", "youjian", "yj", "邮件", "发邮件", "写信"];

    let q = query.trim().to_lowercase();
    let matched = q.is_empty()
        || "写邮件".contains(&q)
        || KEYWORDS
            .iter()
            .any(|keyword| keyword.contains(&q) || q.contains(keyword));
    if !matched {
        return None;
    }

    Some(ToolHit {
        tool_id: TOOL_ID,
        hit_id: "compose",
        title: "写邮件",
        subtitle: "通过 SMTP 发送邮件，可附带当前文件",
        icon: "mail",
        action: ToolAction::OpenPanel {
            panel: TOOL_ID.into(),
        },
    })
}

#[tauri::command]
pub fn mail_config_get(app: AppHandle) -> MailConfig {
    app_config::get_json(&app, &app_config::tool_key(SETTINGS_KEY)).unwrap_or_default()
}

#[tauri::command]
pub fn mail_config_set(app: AppHandle, config: MailConfig) -> Result<(), String> {
    config.validate()?;
    app_config::set_json(&app, &app_config::tool_key(SETTINGS_KEY), &config)
}

#[tauri::command]
pub fn mail_secret_status(app: AppHandle) -> bool {
    secret::has(&app)
}

#[tauri::command]
pub fn mail_secret_set(app: AppHandle, password: String) -> Result<(), String> {
    secret::save(&app, &password)
}

#[tauri::command]
pub fn mail_secret_clear(app: AppHandle) -> Result<(), String> {
    secret::clear(&app)
}

#[tauri::command]
pub async fn mail_test(
    app: AppHandle,
    config: MailConfig,
    password: Option<String>,
) -> Result<(), String> {
    let password = resolve_password(&app, password).map_err(|e| e.message)?;
    tauri::async_runtime::spawn_blocking(move || smtp::test(&config, &password))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn mail_send(
    app: AppHandle,
    config: MailConfig,
    password: Option<String>,
    draft: MailDraft,
) -> Result<(), ToolError> {
    let password = resolve_password(&app, password)?;
    tauri::async_runtime::spawn_blocking(move || smtp::send(&config, &password, &draft))
        .await
        .map_err(|e| ToolError::new("internal", &e.to_string()))?
}

fn resolve_password(app: &AppHandle, provided: Option<String>) -> Result<String, ToolError> {
    if let Some(password) = provided {
        if !password.trim().is_empty() {
            return Ok(password);
        }
    }
    secret::load(app)
        .map_err(|e| ToolError::new("secret", &e))?
        .filter(|password| !password.is_empty())
        .ok_or_else(|| ToolError::new("no_password", "请先填写邮箱密码或授权码"))
}
