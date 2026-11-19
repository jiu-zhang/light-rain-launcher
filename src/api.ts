import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  FileEntry,
  ForegroundInfo,
  MailConfig,
  MailDraft,
  Stats,
  ToolHit,
  ToolMeta,
  UpdateInfo,
} from "./types";

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
let blurHolds = 0;

/** 按住失焦隐藏（可嵌套调用），用于面板、对话框打开期间 */
export async function holdBlur(): Promise<void> {
  blurHolds += 1;
  await invoke<void>("set_blur_guard", { suppress: true });
}

export async function releaseBlur(): Promise<void> {
  blurHolds = Math.max(0, blurHolds - 1);
  if (blurHolds === 0) await invoke<void>("set_blur_guard", { suppress: false });
}
export const hideWindow = () => invoke<void>("hide_window");
export const quitApp = () => invoke<void>("quit_app");
export const pinForegroundResult = (path: string) =>
  invoke<boolean>("pin_foreground_result", { path });
export const appVersion = () => invoke<string>("app_version");
export const recentTracking = () => invoke<boolean>("recent_tracking");
export const enableRecentTracking = () => invoke<void>("enable_recent_tracking");
export const checkUpdate = () => invoke<UpdateInfo | null>("check_update");
export const installUpdate = () => invoke<void>("install_update");

export const toolList = () => invoke<ToolMeta[]>("tool_list");
export const toolSearch = (query: string) => invoke<ToolHit[]>("tool_search", { query });
export const toolRun = (toolId: string, hitId: string) =>
  invoke<Record<string, unknown>>("tool_run", { toolId, hitId });
export const getToolConfig = (toolId: string) =>
  invoke<Record<string, unknown>>("tool_config_get", { toolId });
export const setToolConfig = (toolId: string, value: Record<string, unknown>) =>
  invoke<void>("tool_config_set", { toolId, value });

export const mailConfigGet = () => invoke<MailConfig>("mail_config_get");
export const mailConfigSet = (config: MailConfig) => invoke<void>("mail_config_set", { config });
export const mailSecretStatus = () => invoke<boolean>("mail_secret_status");
export const mailSecretSet = (password: string) => invoke<void>("mail_secret_set", { password });
export const mailSecretClear = () => invoke<void>("mail_secret_clear");
export const mailTest = (config: MailConfig, password?: string) =>
  invoke<void>("mail_test", { config, password: password || null });
export const mailSend = (config: MailConfig, draft: MailDraft, password?: string) =>
  invoke<void>("mail_send", { config, password: password || null, draft });
