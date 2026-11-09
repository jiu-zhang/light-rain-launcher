use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use windows::core::{HSTRING, Interface};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED, STGM_READ,
};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

fn recent_dir() -> Option<PathBuf> {
    std::env::var("APPDATA")
        .ok()
        .map(|v| PathBuf::from(v).join("Microsoft").join("Windows").join("Recent"))
        .filter(|p| p.is_dir())
}

fn mtime_of(p: &Path) -> i64 {
    std::fs::metadata(p)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

unsafe fn resolve_one(lnk: &Path) -> Option<String> {
    let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
    let persist: IPersistFile = link.cast().ok()?;
    let wide = HSTRING::from(lnk.to_string_lossy().as_ref());
    persist.Load(&wide, STGM_READ).ok()?;
    let mut buf = [0u16; 1024];
    link.GetPath(&mut buf, std::ptr::null_mut(), 0).ok()?;
    let len = buf.iter().position(|&c| c == 0).unwrap_or(0);
    if len <= 3 {
        return None;
    }
    let s = String::from_utf16_lossy(&buf[..len]);
    // 排除 UWP / shell: 之类无法直接打开的目标
    if s.starts_with("::{") || s.starts_with("shell:") || s.starts_with("Microsoft.") {
        return None;
    }
    Some(s)
}

fn collect_links(limit: usize) -> Vec<(PathBuf, i64)> {
    let dir = match recent_dir() {
        Some(d) => d,
        None => return vec![],
    };
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    let mut links: Vec<(PathBuf, i64)> = entries
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if p.extension().map(|x| x.eq_ignore_ascii_case("lnk")) != Some(true) {
                return None;
            }
            // 跳过 "今日提示.lnk" 之类的系统项
            let name = p.file_name()?.to_string_lossy().to_string();
            if name.starts_with('.') {
                return None;
            }
            Some((p.clone(), mtime_of(&p)))
        })
        .collect();
    links.sort_by(|a, b| b.1.cmp(&a.1));
    links.truncate(limit);
    links
}

/// 读取系统「最近使用」列表，返回 (目标绝对路径, 最后使用时间)
pub fn system_recent(limit: usize) -> Vec<(String, i64)> {
    let links = collect_links(limit * 3);
    if links.is_empty() {
        return vec![];
    }
    std::thread::spawn(move || unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let mut out: Vec<(String, i64)> = Vec::new();
        for (p, mt) in links {
            if let Some(target) = resolve_one(&p) {
                if Path::new(&target).is_file() {
                    out.push((target, mt));
                }
            }
        }
        CoUninitialize();
        out
    })
    .join()
    .unwrap_or_default()
}

/// 在 Recent 目录里按文件名找一个链接并解析目标
pub fn resolve_by_name(name: &str) -> Option<String> {
    let dir = recent_dir()?;
    let candidate = dir.join(format!("{name}.lnk"));
    if !candidate.is_file() {
        return None;
    }
    std::thread::spawn(move || unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let r = resolve_one(&candidate);
        CoUninitialize();
        r
    })
    .join()
    .ok()
    .flatten()
}

/// 冷启动兜底：扫描常用目录里最近修改的文件，避免第一次打开空空如也
pub fn scan_common_dirs(limit: usize) -> Vec<(String, i64)> {
    let profile = match std::env::var("USERPROFILE") {
        Ok(v) => PathBuf::from(v),
        Err(_) => return vec![],
    };
    let roots = ["Desktop", "Downloads", "Documents"];
    let mut out: Vec<(String, i64)> = Vec::new();
    let mut visited = 0usize;

    for root in roots {
        let dir = profile.join(root);
        if !dir.is_dir() {
            continue;
        }
        collect(&dir, 2, &mut out, &mut visited, limit * 6);
        if visited > 4000 {
            break;
        }
    }

    out.sort_by(|a, b| b.1.cmp(&a.1));
    out.truncate(limit);
    out
}

fn collect(dir: &Path, depth: usize, out: &mut Vec<(String, i64)>, visited: &mut usize, cap: usize) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if *visited > cap {
            return;
        }
        *visited += 1;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name.starts_with("~$") {
            continue;
        }
        match entry.file_type() {
            Ok(ft) if ft.is_dir() => {
                if depth > 0 {
                    collect(&path, depth - 1, out, visited, cap);
                }
            }
            Ok(ft) if ft.is_file() => {
                let mt = mtime_of(&path);
                if mt > 0 {
                    out.push((path.to_string_lossy().to_string(), mt));
                }
            }
            _ => {}
        }
    }
}


/// 解析一批快捷方式，返回与输入等长的目标路径列表
pub fn resolve_many(paths: Vec<PathBuf>) -> Vec<Option<String>> {
    let count = paths.len();
    if count == 0 {
        return vec![];
    }
    std::thread::spawn(move || unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let mut out = Vec::with_capacity(paths.len());
        for p in &paths {
            out.push(resolve_one(p));
        }
        CoUninitialize();
        out
    })
    .join()
    .unwrap_or_else(|_| vec![None; count])
}

/// 解析单个快捷方式
pub fn resolve_lnk(path: &str) -> Option<String> {
    let p = PathBuf::from(path);
    std::thread::spawn(move || unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let r = resolve_one(&p);
        CoUninitialize();
        r
    })
    .join()
    .ok()
    .flatten()
}

