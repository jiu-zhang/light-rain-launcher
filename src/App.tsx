import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import * as api from "./api";
import type { AppSettings, FileEntry, ForegroundInfo, ThemeMode } from "./types";
import { dirOf, relTime } from "./utils";
import { useIcon } from "./useIcon";
import SettingsPanel from "./Settings";
import PinDialog from "./PinDialog";

type Tab = "all" | "pinned" | "recent";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "pinned", label: "置顶" },
  { key: "recent", label: "最近" },
];

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M20 14.5A8.2 8.2 0 019.6 4a8.4 8.4 0 1010.4 10.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Row({
  item,
  active,
  query,
  onEnter,
  onHover,
  onPin,
  onReveal,
}: {
  item: FileEntry;
  active: boolean;
  query: string;
  onEnter: () => void;
  onHover: () => void;
  onPin: () => void;
  onReveal: () => void;
}) {
  const icon = useIcon(item.path);
  const isApp = item.source === "app";
  return (
    <div
      className={
        "row" +
        (active ? " active" : "") +
        (item.missing ? " missing" : "") +
        (isApp ? " is-app" : "")
      }
      onMouseMove={onHover}
      onClick={onEnter}
    >
      <div className={"row-icon" + (isApp ? " app" : "")}>
        {icon ? (
          <img src={icon} alt="" />
        ) : (
          <span className="ext">{(item.ext || "?").slice(0, 4).toUpperCase()}</span>
        )}
      </div>
      <div className="row-main">
        <div className="row-name">
          {item.pinned && (
            <svg className="pin-mark" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
              <path
                d="M9 4h6l-1 5 4 4H6l4-4-1-5z"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
          )}
          <Highlight text={item.name} query={query} />
          {isApp && <span className="tag app">程序</span>}
          {item.missing && <span className="tag danger">路径失效</span>}
          {item.source === "recent" && !item.pinned && <span className="tag soft">系统</span>}
        </div>
        <div className="row-path">{dirOf(item.path)}</div>
      </div>
      <div className="row-meta">
        {item.open_count > 0 && <span className="meta-pill">打开 {item.open_count} 次</span>}
        <span className="meta-time">{relTime(item.last_opened)}</span>
      </div>
      <div className="row-actions">
        <button
          className={"icon-btn pin" + (item.pinned ? " on" : "")}
          title={item.pinned ? "取消置顶 (Ctrl+P)" : "置顶 (Ctrl+P)"}
          onClick={(e) => {
            e.stopPropagation();
            onPin();
          }}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path
              d="M9 4h6l-1 5 4 4H6l4-4-1-5zM12 13v7"
              fill={item.pinned ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          className="icon-btn"
          title="打开所在文件夹 (Ctrl+Enter)"
          onClick={(e) => {
            e.stopPropagation();
            onReveal();
          }}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path
              d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<"launcher" | "settings">("launcher");
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [pinned, setPinned] = useState<FileEntry[]>([]);
  const [recent, setRecent] = useState<FileEntry[]>([]);
  const [results, setResults] = useState<FileEntry[] | null>(null);
  const [sel, setSel] = useState(0);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pinInfo, setPinInfo] = useState<ForegroundInfo | null>(null);
  const [dragging, setDragging] = useState(false);
  const [trackingOff, setTrackingOff] = useState(false);
  const [tipDismissed, setTipDismissed] = useState(false);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  }, []);

  // ---------- 主题 ----------
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const mode: ThemeMode = settings?.theme ?? "system";
  const resolved = mode === "system" ? (systemDark ? "dark" : "light") : mode;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  // ---------- 设置 ----------
  const persist = useCallback(
    async (patch: Partial<AppSettings>) => {
      if (!settings) return;
      const next = { ...settings, ...patch };
      setSettings(next);
      try {
        await api.saveSettings(next);
      } catch (err) {
        showToast(String(err));
      }
    },
    [settings, showToast]
  );

  const toggleTheme = () => persist({ theme: resolved === "dark" ? "light" : "dark" });

  const reload = useCallback(async () => {
    const [p, r] = await Promise.all([api.listPinned(), api.listRecent(settings?.recent_limit ?? 60)]);
    setPinned(p);
    setRecent(r.filter((x) => !x.pinned));
  }, [settings?.recent_limit]);

  const checkTracking = useCallback(async () => {
    try {
      setTrackingOff(!(await api.recentTracking()));
    } catch {
      setTrackingOff(false);
    }
  }, []);

  const enableTracking = useCallback(async () => {
    try {
      await api.enableRecentTracking();
      setTrackingOff(false);
      showToast("已开启系统最近记录，之后别处打开的文件会自动出现");
      window.setTimeout(reload, 1200);
    } catch (err) {
      showToast(String(err));
    }
  }, [reload, showToast]);

  useEffect(() => {
    (async () => {
      const s = await api.getSettings();
      setSettings(s);
      const [p, r] = await Promise.all([api.listPinned(), api.listRecent(s.recent_limit)]);
      setPinned(p);
      setRecent(r);
      checkTracking();
      inputRef.current?.focus();
    })();
  }, [checkTracking]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(async () => {
      const r = await api.searchFiles(q, 60);
      if (alive) {
        setResults(r);
        setSel(0);
      }
    }, 70);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const items = useMemo(() => {
    if (query.trim()) return results ?? [];
    if (tab === "pinned") return pinned;
    if (tab === "recent") return recent;
    return [...pinned, ...recent];
  }, [query, results, tab, pinned, recent]);

  const pinCount = !query.trim() && tab === "all" ? pinned.length : 0;

  useEffect(() => {
    if (sel >= items.length) setSel(Math.max(0, items.length - 1));
  }, [items.length, sel]);

  useEffect(() => {
    const active = listRef.current?.querySelector(".row.active");
    if (active && "scrollIntoView" in active) {
      (active as HTMLElement).scrollIntoView({ block: "nearest" });
    }
  }, [sel, items]);

  const current = items[sel];

  const actOpen = useCallback(async (item?: FileEntry) => {
    if (!item) return;
    try {
      await api.openFile(item.path);
    } catch (err) {
      showToast(String(err));
    }
  }, [showToast]);

  const actReveal = useCallback(async (item?: FileEntry) => {
    if (!item) return;
    try {
      await api.revealFile(item.path);
    } catch (err) {
      showToast(String(err));
    }
  }, [showToast]);

  const actPin = useCallback(async (item?: FileEntry) => {
    if (!item) return;
    const pinnedNow = await api.togglePin(item.path);
    showToast(pinnedNow ? "已置顶：" + item.name : "已取消置顶：" + item.name);
    await reload();
  }, [reload, showToast]);


  const addFiles = useCallback(async () => {
    await api.setBlurGuard(true);
    try {
      const picked = await openDialog({ multiple: true, title: "选择要固定到 LightRain 的文件" });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      if (paths.length === 0) return;
      await api.addPaths(paths);
      for (const p of paths) await api.togglePin(p);
      showToast("已固定 " + paths.length + " 个文件");
      await reload();
    } finally {
      await api.setBlurGuard(false);
      inputRef.current?.focus();
    }
  }, [reload, showToast]);

  const syncSystem = useCallback(async () => {
    showToast("正在同步系统最近记录…");
    const n = await api.refreshRecent();
    await reload();
    showToast("已同步 " + n + " 条系统最近记录");
  }, [reload, showToast]);

  // 全局事件
  useEffect(() => {
    const unlisteners: Promise<() => void>[] = [
      listen("window-shown", () => {
        setView("launcher");
        setQuery("");
        setSel(0);
        reload();
        checkTracking();
        window.setTimeout(() => inputRef.current?.focus(), 30);
      }),
      listen("data-changed", () => {
        reload();
      }),
      listen("pins-changed", () => {
        reload();
      }),
      listen("pin-current-request", async () => {
        const info = await api.detectForeground();
        setPinInfo(info);
      }),
    ];
    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, [reload]);

  // 拖拽文件进窗口 => 直接固定
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setDragging(true);
        } else if (payload.type === "leave") {
          setDragging(false);
        } else if (payload.type === "drop") {
          setDragging(false);
          const paths = payload.paths ?? [];
          if (paths.length === 0) return;
          (async () => {
            await api.addPaths(paths);
            for (const p of paths) await api.togglePin(p);
            showToast("已固定 " + paths.length + " 个文件");
            await reload();
          })();
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [reload, showToast]);

  // 键盘操作
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view === "settings") return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, Math.max(0, items.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(0, s - 1));
      } else if (e.key === "PageDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 8, Math.max(0, items.length - 1)));
      } else if (e.key === "PageUp") {
        e.preventDefault();
        setSel((s) => Math.max(0, s - 8));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (e.ctrlKey) actReveal(items[sel]);
        else actOpen(items[sel]);
      } else if (e.key.toLowerCase() === "p" && e.ctrlKey) {
        e.preventDefault();
        actPin(items[sel]);
      } else if (e.key.toLowerCase() === "d" && e.ctrlKey) {
        e.preventDefault();
        const target = items[sel];
        if (target) {
          void api.removeFile(target.path).then(() => {
            showToast("已从列表移除：" + target.name);
            reload();
          });
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (query) {
          setQuery("");
          setSel(0);
        } else {
          api.hideWindow();
        }
      } else if (e.ctrlKey && ["1", "2", "3"].includes(e.key)) {
        e.preventDefault();
        setQuery("");
        setTab(e.key === "1" ? "all" : e.key === "2" ? "pinned" : "recent");
        setSel(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, sel, query, view, actOpen, actReveal, actPin]);

  if (view === "settings" && settings) {
    return (
      <div className="shell">
        <SettingsPanel
          settings={settings}
          onChange={async (patch) => {
            await persist(patch);
            await reload();
          }}
          onClose={() => {
            setView("launcher");
            inputRef.current?.focus();
          }}
          onToast={showToast}
        />
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="search" data-tauri-drag-region>
        <svg className="search-icon" viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          spellCheck={false}
          placeholder="搜索文件名、路径或拼音首字母…"
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
        />
        {query && (
          <button className="icon-btn" title="清空 (Esc)" onClick={() => setQuery("")}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <button
          className="icon-btn"
          title={resolved === "dark" ? "切换到浅色" : "切换到深色"}
          onClick={toggleTheme}
        >
          {resolved === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
        <button className="icon-btn" title="设置" onClick={() => setView("settings")}>
          <svg
            viewBox="0 0 24 24"
            width="17"
            height="17"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      </header>

      <nav className="tabs">
        <div className="tab-group">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={"tab" + (tab === t.key && !query ? " active" : "")}
              onClick={() => {
                setTab(t.key);
                setQuery("");
                setSel(0);
              }}
            >
              {t.label}
              <span className="count">
                {t.key === "all"
                  ? pinned.length + recent.length
                  : t.key === "pinned"
                  ? pinned.length
                  : recent.length}
              </span>
            </button>
          ))}
        </div>
        <div className="spacer" />
        <button className="icon-btn" title="添加文件" onClick={addFiles}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </nav>

      {trackingOff && !tipDismissed && settings?.sync_system_recent && (
        <div className="tip">
          <div className="tip-text">
            Windows 目前没有记录你打开过的文件，这里收不到在别处打开的文件
          </div>
          <button className="ghost" onClick={enableTracking}>
            一键开启
          </button>
          <button className="icon-btn" title="不再提示" onClick={() => setTipDismissed(true)}>
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      <main className="list" ref={listRef}>
        {items.length === 0 && (
          <div className="empty">
            {query ? (
              <p>没有找到 “{query}”</p>
            ) : (
              <>
                <div className="empty-icon">
                  <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
                    <path
                      d="M4 7a2 2 0 012-2h3.6l2 2H20a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V7z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <p>这里还没有文件</p>
                <p className="sub">把文件拖进来，或者从电脑里挑几个常用的固定住</p>
                <div className="empty-actions">
                  <button className="primary" onClick={addFiles}>
                    添加文件
                  </button>
                  <button className="ghost" onClick={syncSystem}>
                    导入系统最近记录
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {items.map((item, i) => (
          <Fragment key={item.path + i}>
            {i === 0 && pinCount > 0 && <div className="group-label">置顶</div>}
            {i === pinCount && pinCount > 0 && <div className="group-label">最近使用</div>}
            <Row
              item={item}
              active={i === sel}
              query={query}
              onEnter={() => actOpen(item)}
              onHover={() => setSel(i)}
              onPin={() => actPin(item)}
              onReveal={() => actReveal(item)}
            />
          </Fragment>
        ))}
      </main>

      <footer className="hints">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> 选择
        </span>
        <span>
          <kbd>Enter</kbd> 打开
        </span>
        <span>
          <kbd>Ctrl</kbd>+<kbd>P</kbd> 置顶
        </span>
        <span>
          <kbd>Esc</kbd> 关闭
        </span>
        <div className="spacer" />
        <span className="hint-soft">{items.length} 个文件</span>
      </footer>

      {dragging && <div className="drop-hint">松手即可固定到置顶</div>}
      {toast && <div className="toast">{toast}</div>}
      {pinInfo && (
        <PinDialog
          info={pinInfo}
          onClose={() => setPinInfo(null)}
          onDone={(msg) => {
            setPinInfo(null);
            showToast(msg);
            reload();
          }}
        />
      )}
      {current === undefined && null}
    </div>
  );
}
