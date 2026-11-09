use crate::models::FileEntry;
use rusqlite::{params, Connection};
use pinyin::ToPinyin;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Db(pub Mutex<Connection>);

pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  path        TEXT NOT NULL,
  path_key    TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  name_lower  TEXT NOT NULL,
  ext         TEXT NOT NULL DEFAULT '',
  pinyin      TEXT NOT NULL DEFAULT '',
  size        INTEGER NOT NULL DEFAULT 0,
  mtime       INTEGER NOT NULL DEFAULT 0,
  open_count  INTEGER NOT NULL DEFAULT 0,
  last_opened INTEGER NOT NULL DEFAULT 0,
  pinned      INTEGER NOT NULL DEFAULT 0,
  pin_order   INTEGER NOT NULL DEFAULT 0,
  group_name  TEXT,
  source      TEXT NOT NULL DEFAULT 'app',
  missing     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_files_pinned ON files(pinned, pin_order);
CREATE INDEX IF NOT EXISTS idx_files_last ON files(last_opened DESC);
CREATE INDEX IF NOT EXISTS idx_files_name ON files(name_lower);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"#;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");
    conn.execute_batch(SCHEMA)?;
    // 早期版本把「手动置顶的文件」也标成 app，这里纠正一下来源标记
    let _ = conn.execute(
        "UPDATE files SET source = 'manual' WHERE source = 'app' AND path_key NOT LIKE '%.lnk'",
        [],
    );
    // 旧数据里快捷方式的显示名带着 .lnk，这里去掉
    let _ = conn.execute(
        "UPDATE files
            SET name = substr(name, 1, length(name) - 4),
                name_lower = lower(substr(name, 1, length(name) - 4))
          WHERE name LIKE '%.lnk'",
        [],
    );
    Ok(conn)
}

/// 取汉字拼音首字母，非汉字原样保留，最后的小写字母串用于搜索
pub fn initials(name: &str) -> String {
    let chars: Vec<char> = name.chars().collect();
    let mut out = String::new();
    for (i, py) in name.to_pinyin().enumerate() {
        match py {
            Some(p) => {
                if let Some(c) = p.plain().chars().next() {
                    out.push(c);
                }
            }
            None => {
                if let Some(c) = chars.get(i) {
                    out.push(*c);
                }
            }
        }
    }
    out.to_lowercase()
}

fn path_key(p: &str) -> String {
    p.replace('/', "\\").to_lowercase()
}

fn file_name_of(p: &Path) -> String {
    // 快捷方式保留不带 .lnk 的显示名，和开始菜单里看到的一致
    if p.extension().map(|e| e.eq_ignore_ascii_case("lnk")) == Some(true) {
        if let Some(stem) = p.file_stem() {
            return stem.to_string_lossy().to_string();
        }
    }
    p.file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| p.to_string_lossy().to_string())
}

fn ext_of(p: &Path) -> String {
    p.extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn meta_of(p: &Path) -> (i64, i64, bool) {
    match std::fs::metadata(p) {
        Ok(m) => {
            let mtime = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            (m.len() as i64, mtime, false)
        }
        Err(_) => (0, 0, true),
    }
}

pub fn touch(conn: &Connection, raw_path: &str, source: &str, opened_at: i64, credit: bool) {
    let p = PathBuf::from(raw_path);
    if raw_path.trim().is_empty() || !p.is_absolute() {
        return;
    }
    let name = file_name_of(&p);
    let ext = ext_of(&p);
    let (size, mtime, missing) = meta_of(&p);
    let py = initials(&name);
    let _ = conn.execute(
        r#"INSERT INTO files (path, path_key, name, name_lower, ext, pinyin, size, mtime,
                              open_count, last_opened, pinned, pin_order, source, missing, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, 0, ?11, ?12, ?13)
           ON CONFLICT(path_key) DO UPDATE SET
             name = excluded.name,
             name_lower = excluded.name_lower,
             ext = excluded.ext,
             pinyin = excluded.pinyin,
             size = excluded.size,
             mtime = excluded.mtime,
             missing = excluded.missing,
             last_opened = MAX(files.last_opened, excluded.last_opened),
             open_count = files.open_count + ?9"#,
        params![
            raw_path,
            path_key(raw_path),
            name,
            name.to_lowercase(),
            ext,
            py,
            size,
            mtime,
            if credit { 1 } else { 0 },
            opened_at,
            source,
            missing as i32,
            now_secs()
        ],
    );
}

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<FileEntry> {
    let pinned: i64 = row.get(8)?;
    let open_count: i64 = row.get(6)?;
    let last_opened: i64 = row.get(7)?;
    let score = frecency(open_count, last_opened, pinned == 1);
    Ok(FileEntry {
        id: row.get(0)?,
        path: row.get(1)?,
        name: row.get(2)?,
        ext: row.get(3)?,
        size: row.get(4)?,
        mtime: row.get(5)?,
        open_count,
        last_opened,
        pinned: pinned == 1,
        pin_order: row.get(9)?,
        group_name: row.get(10)?,
        missing: row.get::<_, i64>(11)? == 1,
        source: row.get(12)?,
        score,
        pinyin: row.get(13).unwrap_or_default(),
    })
}

const COLS: &str = "id, path, name, ext, size, mtime, open_count, last_opened, pinned, pin_order, group_name, missing, source, pinyin";

pub fn frecency(open_count: i64, last_opened: i64, pinned: bool) -> f64 {
    let now = now_secs();
    let age = (now - last_opened).max(0);
    let recency = if age < 86_400 {
        120.0
    } else if age < 7 * 86_400 {
        80.0
    } else if age < 30 * 86_400 {
        50.0
    } else if age < 90 * 86_400 {
        25.0
    } else {
        8.0
    };
    let freq = (open_count.min(15) as f64) * 7.0;
    let pin_bonus = if pinned { 1000.0 } else { 0.0 };
    recency + freq + pin_bonus
}

pub fn list_pinned(conn: &Connection) -> Vec<FileEntry> {
    let sql = format!("SELECT {COLS} FROM files WHERE pinned = 1 ORDER BY pin_order ASC, id ASC");
    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let rows = stmt.query_map([], row_to_entry);
    match rows {
        Ok(it) => it.filter_map(|r| r.ok()).collect(),
        Err(_) => vec![],
    }
}

pub fn list_recent(conn: &Connection, limit: i64) -> Vec<FileEntry> {
    let sql = format!(
        "SELECT {COLS} FROM files WHERE pinned = 0 ORDER BY last_opened DESC, id DESC LIMIT ?1"
    );
    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let rows = stmt.query_map(params![limit], row_to_entry);
    match rows {
        Ok(it) => it.filter_map(|r| r.ok()).collect(),
        Err(_) => vec![],
    }
}

pub fn list_scored(conn: &Connection, limit: i64) -> Vec<FileEntry> {
    let sql = format!("SELECT {COLS} FROM files ORDER BY last_opened DESC, id DESC LIMIT ?1");
    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let rows = stmt.query_map(params![limit * 6], row_to_entry);
    let mut out: Vec<FileEntry> = match rows {
        Ok(it) => it.filter_map(|r| r.ok()).collect(),
        Err(_) => vec![],
    };
    out.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    out.truncate(limit as usize);
    out
}

pub fn toggle_pin(conn: &Connection, path: &str) -> bool {
    let key = path_key(path);
    let current: Option<i64> = conn
        .query_row("SELECT pinned FROM files WHERE path_key = ?1", params![key], |r| r.get(0))
        .ok();
    match current {
        Some(v) => {
            let next = if v == 1 { 0 } else { 1 };
            let order: i64 = conn
                .query_row("SELECT COALESCE(MAX(pin_order), 0) + 1 FROM files", [], |r| r.get(0))
                .unwrap_or(1);
            let _ = conn.execute(
                "UPDATE files SET pinned = ?1, pin_order = ?2 WHERE path_key = ?3",
                params![next, if next == 1 { order } else { 0 }, key],
            );
            next == 1
        }
        None => {
            let source = if path.to_lowercase().ends_with(".lnk") {
                "app"
            } else {
                "manual"
            };
            touch(conn, path, source, now_secs(), false);
            let _ = conn.execute("UPDATE files SET pinned = 1 WHERE path_key = ?1", params![key]);
            true
        }
    }
}

pub fn reorder_pins(conn: &Connection, paths: &[String]) {
    for (i, p) in paths.iter().enumerate() {
        let _ = conn.execute(
            "UPDATE files SET pin_order = ?1 WHERE path_key = ?2",
            params![(i as i64) + 1, path_key(p)],
        );
    }
}

pub fn set_group(conn: &Connection, path: &str, group: Option<&str>) {
    let _ = conn.execute(
        "UPDATE files SET group_name = ?1 WHERE path_key = ?2",
        params![group, path_key(path)],
    );
}

pub fn remove(conn: &Connection, path: &str) {
    let _ = conn.execute("DELETE FROM files WHERE path_key = ?1", params![path_key(path)]);
}

pub fn bump_open(conn: &Connection, path: &str) {
    let _ = conn.execute(
        "UPDATE files SET open_count = open_count + 1, last_opened = ?1 WHERE path_key = ?2",
        params![now_secs(), path_key(path)],
    );
}

pub fn cleanup_missing(conn: &Connection) -> i64 {
    let mut to_remove: Vec<String> = vec![];
    let mut stmt = match conn.prepare("SELECT path FROM files") {
        Ok(s) => s,
        Err(_) => return 0,
    };
    if let Ok(it) = stmt.query_map([], |r| r.get::<_, String>(0)) {
        for p in it.flatten() {
            if !Path::new(&p).exists() {
                to_remove.push(p);
            }
        }
    }
    for p in &to_remove {
        let _ = conn.execute("DELETE FROM files WHERE path_key = ?1", params![path_key(p)]);
    }
    to_remove.len() as i64
}

pub fn verify_all(conn: &Connection) -> i64 {
    let mut missing = 0;
    let mut stmt = match conn.prepare("SELECT path, missing FROM files") {
        Ok(s) => s,
        Err(_) => return 0,
    };
    let rows: Vec<(String, i64)> = match stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))) {
        Ok(it) => it.filter_map(|r| r.ok()).collect(),
        Err(_) => return 0,
    };
    for (p, old) in rows {
        let now_missing = if Path::new(&p).exists() { 0 } else { 1 };
        if now_missing == 1 {
            missing += 1;
        }
        if now_missing != old {
            let _ = conn.execute(
                "UPDATE files SET missing = ?1 WHERE path_key = ?2",
                params![now_missing, path_key(&p)],
            );
        }
    }
    missing
}

pub fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get(0))
        .ok()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) {
    let _ = conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    );
}

pub fn count(conn: &Connection, where_clause: &str) -> i64 {
    let sql = format!("SELECT COUNT(*) FROM files {where_clause}");
    conn.query_row(&sql, [], |r| r.get(0)).unwrap_or(0)
}
