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

export type MailSecurity = "tls" | "startTls" | "none";

export interface MailConfig {
  host: string;
  port: number;
  security: MailSecurity;
  username: string;
  fromName: string;
  defaultTo: string[];
  recentTo: string[];
}

export interface MailDraft {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  html: string;
  attachments: string[];
}

export interface ToolMeta {
  id: string;
  name: string;
  description: string;
  trigger: string;
}

export type ToolAction = { type: "run" } | { type: "openPanel"; panel: string };

export interface ToolHit {
  toolId: string;
  hitId: string;
  title: string;
  subtitle: string;
  icon: string;
  action: ToolAction;
}

export interface Stats {
  total: number;
  pinned: number;
  missing: number;
  top_files: FileEntry[];
}
