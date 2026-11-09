export function relTime(sec: number): string {
  if (!sec) return "";
  const diff = Date.now() / 1000 - sec;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(sec * 1000).toLocaleDateString("zh-CN");
}

export function humanSize(n: number): string {
  if (n <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf("\\");
  return i > 0 ? path.slice(0, i) : path;
}

const KEY_ALIAS: Record<string, string> = {
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Escape: "Esc",
  Enter: "Enter",
  Tab: "Tab",
  "+": "Plus",
};

export function eventToShortcut(e: KeyboardEvent): string | null {
  const key = KEY_ALIAS[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");
  if (parts.length === 0) return null;
  parts.push(key);
  return parts.join("+");
}
