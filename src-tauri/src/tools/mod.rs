//! 工具注册表：所有工具在编译期注册，前端只认统一的 list/search/run 协议。
//!
//! 新增一个工具只需要三步：
//! 1. 在 TOOLS 里加一条元信息；
//! 2. 在自己的模块里实现搜索命中与 tool_run 的分支；
//! 3. 前端在 src/tools/registry.ts 里注册面板（可选）。

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::config;

pub mod mail;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolMeta {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    /// 在搜索框里输入的触发前缀
    pub trigger: &'static str,
}

pub const TOOLS: &[ToolMeta] = &[
    ToolMeta {
        id: "actions",
        name: "快捷操作",
        description: "打开设置、同步最近记录、刷新应用索引、退出",
        trigger: ">",
    },
    ToolMeta {
        id: "mail",
        name: "邮件",
        description: "通过 SMTP 发送邮件，可附带文件",
        trigger: ">",
    },
];

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ToolAction {
    /// 直接执行，不需要额外面板
    Run,
    /// 打开一个前端注册的工具面板
    #[allow(dead_code)] // 预留给后续工具（邮箱、翻译等）
    OpenPanel { panel: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolHit {
    pub tool_id: &'static str,
    pub hit_id: &'static str,
    pub title: &'static str,
    pub subtitle: &'static str,
    pub icon: &'static str,
    pub action: ToolAction,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolError {
    pub code: String,
    pub message: String,
}

impl ToolError {
    fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

struct ActionDef {
    id: &'static str,
    title: &'static str,
    subtitle: &'static str,
    icon: &'static str,
    keywords: &'static [&'static str],
}

const ACTIONS: &[ActionDef] = &[
    ActionDef {
        id: "settings",
        title: "打开设置",
        subtitle: "外观、快捷键、更新与统计",
        icon: "settings",
        keywords: &["settings", "shezhi", "sz", "config"],
    },
    ActionDef {
        id: "refresh",
        title: "同步系统最近文件",
        subtitle: "立即从 Windows 最近使用导入",
        icon: "refresh",
        keywords: &["refresh", "sync", "tongbu", "tb"],
    },
    ActionDef {
        id: "rescan",
        title: "重新扫描已安装程序",
        subtitle: "刷新开始菜单里的应用索引",
        icon: "apps",
        keywords: &["apps", "scan", "saomiao", "sm"],
    },
    ActionDef {
        id: "quit",
        title: "退出 LightRain",
        subtitle: "关闭托盘常驻进程",
        icon: "quit",
        keywords: &["quit", "exit", "tuichu", "tc"],
    },
];

fn rank_text(text: &str, query: &str) -> Option<u8> {
    let text = text.to_lowercase();
    if text == query {
        Some(0)
    } else if text.starts_with(query) {
        Some(1)
    } else if text.contains(query) {
        Some(2)
    } else {
        None
    }
}

fn rank_action(action: &ActionDef, query: &str) -> Option<u8> {
    if query.is_empty() {
        return Some(0);
    }
    if let Some(rank) = rank_text(action.title, query) {
        return Some(rank);
    }
    for keyword in action.keywords {
        if let Some(rank) = rank_text(keyword, query) {
            return Some(rank + 3);
        }
    }
    None
}

#[tauri::command]
pub fn tool_list() -> Vec<ToolMeta> {
    TOOLS.to_vec()
}

#[tauri::command]
pub fn tool_search(query: String) -> Vec<ToolHit> {
    let q = query.trim().to_lowercase();

    let mut hits: Vec<ToolHit> = Vec::new();
    if let Some(hit) = mail::search_hit(&q) {
        hits.push(hit);
    }

    let mut actions: Vec<(u8, &ActionDef)> = ACTIONS
        .iter()
        .filter_map(|action| rank_action(action, &q).map(|rank| (rank, action)))
        .collect();
    actions.sort_by_key(|(rank, _)| *rank);
    hits.extend(actions.into_iter().map(|(_, action)| ToolHit {
        tool_id: "actions",
        hit_id: action.id,
        title: action.title,
        subtitle: action.subtitle,
        icon: action.icon,
        action: ToolAction::Run,
    }));
    hits
}

#[tauri::command]
pub async fn tool_run(
    app: AppHandle,
    tool_id: String,
    hit_id: String,
) -> Result<Value, ToolError> {
    match (tool_id.as_str(), hit_id.as_str()) {
        ("actions", "settings") => {
            let _ = app.emit("open-settings", ());
            Ok(json!({ "ok": true }))
        }
        ("actions", "refresh") => {
            let handle = app.clone();
            let count = tauri::async_runtime::spawn_blocking(move || {
                crate::commands::sync_system_recent(&handle)
            })
            .await
            .map_err(|e| ToolError::new("internal", &e.to_string()))?;
            let _ = app.emit("data-changed", ());
            Ok(json!({ "ok": true, "count": count }))
        }
        ("actions", "rescan") => {
            let handle = app.clone();
            let count = tauri::async_runtime::spawn_blocking(move || {
                crate::commands::sync_apps(&handle)
            })
            .await
            .map_err(|e| ToolError::new("internal", &e.to_string()))?;
            let _ = app.emit("data-changed", ());
            Ok(json!({ "ok": true, "count": count }))
        }
        ("actions", "quit") => {
            app.exit(0);
            Ok(json!({ "ok": true }))
        }
        _ => Err(ToolError::new("unknown_hit", "这个操作还没有实现")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mail_tool_is_searchable() {
        let hits = tool_search("mail".into());
        assert!(hits.iter().any(|hit| hit.tool_id == "mail"));
    }

    #[test]
    fn actions_still_searchable() {
        let hits = tool_search("设置".into());
        assert!(hits.iter().any(|hit| hit.hit_id == "settings"));
    }
}

#[tauri::command]
pub fn tool_config_get(app: AppHandle, tool_id: String) -> Value {
    if !config::valid_tool_id(&tool_id) {
        return json!({});
    }
    config::get_json(&app, &config::tool_key(&tool_id)).unwrap_or_else(|| json!({}))
}

#[tauri::command]
pub fn tool_config_set(app: AppHandle, tool_id: String, value: Value) -> Result<(), String> {
    if !config::valid_tool_id(&tool_id) {
        return Err("工具 id 不合法".into());
    }
    config::set_json(&app, &config::tool_key(&tool_id), &value)
}
