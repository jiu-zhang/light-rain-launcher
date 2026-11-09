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

fn default_theme() -> String {
    "system".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default = "default_theme")]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stats {
    pub total: i64,
    pub pinned: i64,
    pub missing: i64,
    pub top_files: Vec<FileEntry>,
}
