//! SMTP 密码/授权码使用 Windows DPAPI 加密，按当前用户绑定。
//! 明文只在 Rust 内存里短暂存在，不会通过 IPC 回传前端。

use std::ffi::c_void;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
};

const SECRET_FILE: &str = "mail.bin";

fn secret_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("secrets");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建密钥目录：{e}"))?;
    Ok(dir.join(SECRET_FILE))
}

pub fn has(app: &AppHandle) -> bool {
    secret_path(app)
        .ok()
        .and_then(|path| std::fs::metadata(path).ok())
        .map(|meta| meta.len() > 0)
        .unwrap_or(false)
}

pub fn save(app: &AppHandle, password: &str) -> Result<(), String> {
    if password.is_empty() {
        return Err("密码不能为空".into());
    }
    let encrypted = protect(password)?;
    let path = secret_path(app)?;
    std::fs::write(&path, encrypted).map_err(|e| format!("保存密码失败：{e}"))
}

pub fn load(app: &AppHandle) -> Result<Option<String>, String> {
    let path = match secret_path(app) {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    let blob = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("读取密码失败：{e}")),
    };
    if blob.is_empty() {
        return Ok(None);
    }
    unprotect(&blob).map(Some)
}

pub fn clear(app: &AppHandle) -> Result<(), String> {
    let path = secret_path(app)?;
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("清除密码失败：{e}")),
    }
}

fn protect(plain: &str) -> Result<Vec<u8>, String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: plain.len() as u32,
        pbData: plain.as_bytes().as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptProtectData(
            &input,
            PCWSTR::null(),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|e| format!("加密密码失败：{e}"))?;
    }

    Ok(take_blob(&mut output))
}

fn unprotect(blob: &[u8]) -> Result<String, String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: blob.len() as u32,
        pbData: blob.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|e| format!("解密密码失败（可能换了 Windows 账户）：{e}"))?;
    }

    let bytes = take_blob(&mut output);
    String::from_utf8(bytes).map_err(|_| "密码内容损坏".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dpapi_roundtrip() {
        let plain = "test-password-123";
        let blob = protect(plain).unwrap();
        assert_ne!(blob, plain.as_bytes());
        assert_eq!(unprotect(&blob).unwrap(), plain);
    }
}

fn take_blob(blob: &mut CRYPT_INTEGER_BLOB) -> Vec<u8> {
    if blob.pbData.is_null() || blob.cbData == 0 {
        return Vec::new();
    }
    let bytes = unsafe { std::slice::from_raw_parts(blob.pbData, blob.cbData as usize).to_vec() };
    unsafe {
        let _ = LocalFree(HLOCAL(blob.pbData as *mut c_void));
    }
    blob.pbData = std::ptr::null_mut();
    blob.cbData = 0;
    bytes
}
