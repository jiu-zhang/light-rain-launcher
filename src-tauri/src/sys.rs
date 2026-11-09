#![cfg(windows)]

use std::path::Path;
use std::process::Command;

use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
    DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Shell::{ShellExecuteW, SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, GetForegroundWindow, GetIconInfo, GetWindowTextW, GetWindowThreadProcessId,
    ICONINFO, SW_SHOWNORMAL,
};

pub fn open_path(path: &str) -> Result<(), String> {
    if !Path::new(path).exists() {
        return Err("文件不存在".into());
    }
    unsafe {
        let op = HSTRING::from("open");
        let file = HSTRING::from(path);
        let h = ShellExecuteW(
            None,
            &op,
            &file,
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
        if h.0 as isize > 32 {
            Ok(())
        } else {
            Err(format!("系统拒绝打开该文件 (code {})", h.0 as isize))
        }
    }
}

pub fn reveal_path(path: &str) -> Result<(), String> {
    if !Path::new(path).exists() {
        return Err("文件不存在".into());
    }
    Command::new("explorer.exe")
        .arg(format!("/select,{}", path))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 用 SHGetFileInfoW 取 32x32 图标并转成 PNG
pub fn icon_png(path: &str) -> Option<Vec<u8>> {
    unsafe {
        let mut info = SHFILEINFOW::default();
        let wide = HSTRING::from(path);
        let ok = SHGetFileInfoW(
            &wide,
            FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        );
        if ok == 0 || info.hIcon.is_invalid() {
            return None;
        }
        let png = icon_to_png(info.hIcon);
        let _ = DestroyIcon(info.hIcon);
        png
    }
}

unsafe fn icon_to_png(hicon: windows::Win32::UI::WindowsAndMessaging::HICON) -> Option<Vec<u8>> {
    let mut ii = ICONINFO::default();
    GetIconInfo(hicon, &mut ii).ok()?;
    let hbm = ii.hbmColor;
    let mut out: Option<Vec<u8>> = None;

    if !hbm.is_invalid() {
        let mut bmp = BITMAP::default();
        let got = GetObjectW(
            HGDIOBJ(hbm.0),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bmp as *mut _ as *mut std::ffi::c_void),
        );
        if got != 0 && bmp.bmWidth > 0 && bmp.bmHeight > 0 {
            let w = bmp.bmWidth as u32;
            let h = bmp.bmHeight as u32;
            let mut bi = BITMAPINFO::default();
            bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            bi.bmiHeader.biWidth = w as i32;
            bi.bmiHeader.biHeight = -(h as i32);
            bi.bmiHeader.biPlanes = 1;
            bi.bmiHeader.biBitCount = 32;
            bi.bmiHeader.biCompression = 0;

            let mut buf = vec![0u8; (w * h * 4) as usize];
            let hdc = GetDC(None);
            let lines = GetDIBits(
                hdc,
                hbm,
                0,
                h,
                Some(buf.as_mut_ptr() as *mut std::ffi::c_void),
                &mut bi,
                DIB_RGB_COLORS,
            );
            let _ = ReleaseDC(None, hdc);

            if lines != 0 {
                let mut has_alpha = false;
                for px in buf.chunks_exact_mut(4) {
                    if px[3] != 0 {
                        has_alpha = true;
                    }
                    px.swap(0, 2);
                }
                if !has_alpha {
                    for px in buf.chunks_exact_mut(4) {
                        px[3] = 255;
                    }
                }
                if let Some(img) = image::RgbaImage::from_raw(w, h, buf) {
                    let mut cursor = std::io::Cursor::new(Vec::new());
                    if img.write_to(&mut cursor, image::ImageFormat::Png).is_ok() {
                        out = Some(cursor.into_inner());
                    }
                }
            }
        }
    }

    if !ii.hbmMask.is_invalid() {
        let _ = DeleteObject(HGDIOBJ(ii.hbmMask.0));
    }
    if !ii.hbmColor.is_invalid() {
        let _ = DeleteObject(HGDIOBJ(ii.hbmColor.0));
    }
    out
}

pub struct Foreground {
    pub title: String,
    pub exe_name: String,
}

pub fn foreground() -> Foreground {
    unsafe {
        let hwnd = GetForegroundWindow();
        let mut buf = [0u16; 1024];
        let len = GetWindowTextW(hwnd, &mut buf).max(0) as usize;
        let title = String::from_utf16_lossy(&buf[..len.min(buf.len())]);

        let mut pid = 0u32;
        let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid));

        let mut exe_name = String::new();
        if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            let mut pbuf = [0u16; 1024];
            let mut size = pbuf.len() as u32;
            if QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_FORMAT(0),
                windows::core::PWSTR(pbuf.as_mut_ptr()),
                &mut size,
            )
            .is_ok()
            {
                let full = String::from_utf16_lossy(&pbuf[..size as usize]);
                exe_name = Path::new(&full)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
            }
            let _ = CloseHandle(handle);
        }

        Foreground { title, exe_name }
    }
}
