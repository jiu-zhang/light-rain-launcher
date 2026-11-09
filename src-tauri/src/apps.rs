#![cfg(windows)]

use std::path::{Path, PathBuf};

use crate::db::initials;
use crate::models::FileEntry;
use crate::recent;

#[derive(Clone, Debug)]
pub struct AppEntry {
    pub name: String,
    /// 启动用（.lnk，保留快捷方式里配置的参数）
    pub path: String,
    pub pinyin: String,
}

impl AppEntry {
    pub fn to_entry(&self) -> FileEntry {
        FileEntry {
            id: 0,
            path: self.path.clone(),
            name: self.name.clone(),
            ext: "exe".into(),
            size: 0,
            mtime: 0,
            open_count: 0,
            last_opened: 0,
            pinned: false,
            pin_order: 0,
            group_name: None,
            missing: false,
            source: "app".into(),
            score: 0.0,
            pinyin: self.pinyin.clone(),
        }
    }
}

const SKIP_WORDS: &[&str] = &[
    "卸载",
    "uninstall",
    "帮助",
    "readme",
    "read me",
    "网站",
    "官网",
    "文档",
    "changelog",
    "更新日志",
    "release notes",
    "license",
    "许可",
];

fn start_menu_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(p) = std::env::var("ProgramData") {
        dirs.push(
            PathBuf::from(p)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }
    if let Ok(p) = std::env::var("APPDATA") {
        dirs.push(
            PathBuf::from(p)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }
    dirs.into_iter().filter(|d| d.is_dir()).collect()
}

fn collect_lnk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(ft) if ft.is_dir() => {
                if depth > 0 {
                    collect_lnk(&path, depth - 1, out);
                }
            }
            Ok(ft) if ft.is_file() => {
                if path.extension().map(|e| e.eq_ignore_ascii_case("lnk")) == Some(true) {
                    out.push(path);
                }
            }
            _ => {}
        }
    }
}

/// 扫描开始菜单里的所有应用快捷方式
pub fn scan() -> Vec<AppEntry> {
    let mut links: Vec<PathBuf> = Vec::new();
    for dir in start_menu_dirs() {
        collect_lnk(&dir, 4, &mut links);
    }
    if links.is_empty() {
        return vec![];
    }

    let targets = recent::resolve_many(links.clone());
    let mut out: Vec<AppEntry> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (i, lnk) in links.iter().enumerate() {
        let target = targets
            .get(i)
            .cloned()
            .flatten()
            .unwrap_or_default();

        let name = match lnk.file_stem() {
            Some(s) => s.to_string_lossy().to_string(),
            None => continue,
        };
        if name.is_empty() {
            continue;
        }
        let lower = name.to_lowercase();
        if SKIP_WORDS.iter().any(|w| lower.contains(w)) {
            continue;
        }
        // 只保留能定位到 exe 的项
        if !target.is_empty() && !target.to_lowercase().ends_with(".exe") {
            continue;
        }
        let key = if target.is_empty() {
            lnk.to_string_lossy().to_lowercase()
        } else {
            target.to_lowercase()
        };
        if !seen.insert(key) {
            continue;
        }

        out.push(AppEntry {
            pinyin: initials(&name),
            name,
            path: lnk.to_string_lossy().to_string(),
        });
    }

    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}
