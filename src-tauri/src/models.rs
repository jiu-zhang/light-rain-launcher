use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub ext: String,
    pub size: i64,
    pub mtime: i64,
    pub open_count: i64,
    pub last_opened: i64,
    pub pinned: bool,
    pub pin_order: i64,
    pub group_name: Option<String>,
    pub missing: bool,
    pub source: String,
    pub score: f64,
    #[serde(skip)]
    pub pinyin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Candidate {
    pub path: String,
    pub name: String,
    pub confidence: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForegroundInfo {
    pub title: String,
    pub exe_name: String,
    pub candidates: Vec<Candidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    pub theme: String,
    pub hotkey: String,
    pub hide_on_blur: bool,
    pub autostart: bool,
    pub recent_limit: i64,
    pub sync_system_recent: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            hotkey: "Alt+Space".into(),
            hide_on_blur: true,
            autostart: false,
            recent_limit: 60,
            sync_system_recent: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_settings_keep_defaults() {
        // 老版本没有 autostart / sync_system_recent 字段，不能因此把整个设置重置
        let s: AppSettings = serde_json::from_str(r#"{"hotkey":"Ctrl+Shift+Space"}"#).unwrap();
        assert_eq!(s.hotkey, "Ctrl+Shift+Space");
        assert_eq!(s.theme, "system");
        assert_eq!(s.recent_limit, 60);
        assert!(s.hide_on_blur);
    }

    #[test]
    fn unknown_settings_are_ignored() {
        let s: AppSettings =
            serde_json::from_str(r#"{"hotkey":"Alt+Space","future_field":true}"#).unwrap();
        assert_eq!(s.hotkey, "Alt+Space");
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stats {
    pub total: i64,
    pub pinned: i64,
    pub missing: i64,
    pub top_files: Vec<FileEntry>,
}
