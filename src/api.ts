import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, FileEntry, ForegroundInfo, Stats, UpdateInfo } from "./types";

export const listPinned = () => invoke<FileEntry[]>("list_pinned");
export const listRecent = (limit = 80) => invoke<FileEntry[]>("list_recent", { limit });
export const listAll = (limit = 120) => invoke<FileEntry[]>("list_all", { limit });
export const searchFiles = (query: string, limit = 60) =>
  invoke<FileEntry[]>("search_files", { query, limit });
export const togglePin = (path: string) => invoke<boolean>("toggle_pin", { path });
export const reorderPins = (paths: string[]) => invoke<void>("reorder_pins", { paths });
export const setGroup = (path: string, group: string | null) =>
  invoke<void>("set_group", { path, group });
export const removeFile = (path: string) => invoke<void>("remove_file", { path });
export const openFile = (path: string) => invoke<void>("open_file", { path });
export const revealFile = (path: string) => invoke<void>("reveal_file", { path });
export const getIcon = (path: string) => invoke<string | null>("get_icon", { path });
export const detectForeground = () => invoke<ForegroundInfo>("detect_foreground");
export const addPaths = (paths: string[]) => invoke<number>("add_paths", { paths });
export const cleanupMissing = () => invoke<number>("cleanup_missing");
export const verifyFiles = () => invoke<number>("verify_files");
export const getStats = () => invoke<Stats>("stats");
export const getSettings = () => invoke<AppSettings>("get_settings");
export const saveSettings = (settings: AppSettings) => invoke<void>("save_settings", { settings });
export const refreshRecent = () => invoke<number>("refresh_recent");
export const setBlurGuard = (suppress: boolean) => invoke<void>("set_blur_guard", { suppress });
export const hideWindow = () => invoke<void>("hide_window");
export const quitApp = () => invoke<void>("quit_app");
export const pinForegroundResult = (path: string) =>
  invoke<boolean>("pin_foreground_result", { path });
export const appVersion = () => invoke<string>("app_version");
export const checkUpdate = () => invoke<UpdateInfo | null>("check_update");
export const installUpdate = () => invoke<void>("install_update");
