export interface FileEntry {
  id: number;
  path: string;
  name: string;
  ext: string;
  size: number;
  mtime: number;
  open_count: number;
  last_opened: number;
  pinned: boolean;
  pin_order: number;
  group_name: string | null;
  missing: boolean;
  source: string;
  score: number;
}

export interface Candidate {
  path: string;
  name: string;
  confidence: string;
  reason: string;
}

export interface ForegroundInfo {
  title: string;
  exe_name: string;
  candidates: Candidate[];
}

export type ThemeMode = "system" | "light" | "dark";

export interface UpdateInfo {
  version: string;
  current: string;
  notes: string;
}

export interface AppSettings {
  theme: ThemeMode;
  hotkey: string;
  hide_on_blur: boolean;
  autostart: boolean;
  recent_limit: number;
  sync_system_recent: boolean;
}

export interface Stats {
  total: number;
  pinned: number;
  missing: number;
  top_files: FileEntry[];
}
