import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import * as api from "./api";
import type { AppSettings, FileEntry, ForegroundInfo, ThemeMode, ToolHit } from "./types";
import FileRow from "./components/FileRow";
import ToolRow from "./components/ToolRow";
import { MoonIcon, SunIcon } from "./components/icons";
import SettingsPanel from "./Settings";
import MailPanel from "./MailPanel";
import PinDialog from "./PinDialog";
import ShortcutHelp from "./ShortcutHelp";
import { errorText } from "./utils";

type Tab = "all" | "pinned" | "recent";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "pinned", label: "置顶" },
  { key: "recent", label: "最近" },
];

export default function App() {
  const [view, setView] = useState<"launcher" | "settings">("launcher");
  const [settingsSection, setSettingsSection] = useState<string | null>(null);
  const [toolPanel, setToolPanel] = useState<string | null>(null);
  const [mailAttachments, setMailAttachments] = useState<string[]>([]);
  const [mailSubject, setMailSubject] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [pinned, setPinned] = useState<FileEntry[]>([]);
  const [recent, setRecent] = useState<FileEntry[]>([]);
  const [results, setResults] = useState<FileEntry[] | null>(null);
  const [toolHits, setToolHits] = useState<ToolHit[]>([]);
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

  // 输入 > 进入工具模式，避免和文件搜索抢结果
  const trimmedQuery = query.trimStart();
  const toolMode = trimmedQuery.startsWith(">");
  const toolQuery = toolMode ? trimmedQuery.slice(1).trim() : "";

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  }, []);

  // 设置页会查阅其他窗口，取消置顶；回到启动器再恢复
  useEffect(() => {
    getCurrentWebviewWindow()
      .setAlwaysOnTop(view !== "settings")
      .catch(() => {});
  }, [view]);

  // 设置页和工具面板里有未保存的输入，窗口不要因为点到别处就隐藏
  useEffect(() => {
    if (view !== "settings" && !toolPanel && !helpOpen) return;
    void api.holdBlur();
    return () => {
      void api.releaseBlur();
    };
  }, [view, toolPanel, helpOpen]);

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
    if (!q || toolMode) {
      setResults(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(async () => {
      try {
        const r = await api.searchFiles(q, 60);
        if (alive) {
          setResults(r);
          setSel(0);
        }
      } catch {
        if (alive) setResults([]);
      }
    }, 70);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query, toolMode]);

  useEffect(() => {
    if (!toolMode) {
      setToolHits([]);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(async () => {
      try {
        const hits = await api.toolSearch(toolQuery);
        if (alive) {
          setToolHits(hits);
          setSel(0);
        }
      } catch {
        if (alive) setToolHits([]);
      }
    }, 50);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [toolMode, toolQuery]);

  const items = useMemo(() => {
    if (query.trim()) return results ?? [];
    if (tab === "pinned") return pinned;
    if (tab === "recent") return recent;
    return [...pinned, ...recent];
  }, [query, results, tab, pinned, recent]);

  const pinCount = !toolMode && !query.trim() && tab === "all" ? pinned.length : 0;
  const listLength = toolMode ? toolHits.length : items.length;

  useEffect(() => {
    if (sel >= listLength) setSel(Math.max(0, listLength - 1));
  }, [listLength, sel]);

  useEffect(() => {
    const active = listRef.current?.querySelector(".row.active");
    if (active && "scrollIntoView" in active) {
      (active as HTMLElement).scrollIntoView({ block: "nearest" });
    }
  }, [sel, items, toolHits, toolMode]);

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

  const openMail = useCallback((paths: string[], subject = "") => {
    setMailAttachments(paths);
    setMailSubject(subject);
    setToolPanel("mail");
    setQuery("");
    setSel(0);
  }, []);

  const runTool = useCallback(async (hit?: ToolHit) => {
    if (!hit) return;
    if (hit.action.type === "openPanel") {
      if (hit.action.panel === "mail") {
        openMail([]);
      } else {
        showToast("这个工具面板还没有实现");
      }
      setQuery("");
      setSel(0);
      return;
    }
    try {
      const result = await api.toolRun(hit.toolId, hit.hitId);
      if (hit.hitId === "refresh" || hit.hitId === "rescan") {
        const count = Number(result.count ?? 0);
        showToast(hit.hitId === "refresh" ? `已同步 ${count} 条记录` : `已扫描到 ${count} 个程序`);
      }
      if (hit.hitId !== "quit") {
        setQuery("");
        setSel(0);
      }
    } catch (err) {
      showToast(errorText(err));
    }
  }, [openMail, showToast]);


  const addFiles = useCallback(async () => {
    await api.holdBlur();
    try {
      const picked = await openDialog({ multiple: true, title: "选择要固定到 LightRain 的文件" });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      if (paths.length === 0) return;
      await api.addPaths(paths);
      for (const p of paths) await api.togglePin(p);
      showToast("已固定 " + paths.length + " 个文件");
      await reload();
    } finally {
      await api.releaseBlur();
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
        setToolPanel(null);
        setHelpOpen(false);
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
      listen("open-settings", () => {
        setSettingsSection(null);
        setView("settings");
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
          if (toolPanel === "mail") {
            setMailAttachments((prev) => [...new Set([...prev, ...paths])]);
            showToast("已添加 " + paths.length + " 个附件");
            return;
          }
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
  }, [reload, showToast, toolPanel]);

  // 键盘操作
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view === "settings" || toolPanel || helpOpen) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, Math.max(0, listLength - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(0, s - 1));
      } else if (e.key === "PageDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 8, Math.max(0, listLength - 1)));
      } else if (e.key === "PageUp") {
        e.preventDefault();
        setSel((s) => Math.max(0, s - 8));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (toolMode) runTool(toolHits[sel]);
        else if (e.ctrlKey) actReveal(items[sel]);
        else actOpen(items[sel]);
      } else if (!toolMode && e.key.toLowerCase() === "p" && e.ctrlKey) {
        e.preventDefault();
        actPin(items[sel]);
      } else if (!toolMode && e.key.toLowerCase() === "d" && e.ctrlKey) {
        e.preventDefault();
        const target = items[sel];
        if (target) {
          void api.removeFile(target.path).then(() => {
            showToast("已从列表移除：" + target.name);
            reload();
          });
        }
      } else if (!toolMode && e.key.toLowerCase() === "e" && e.ctrlKey) {
        e.preventDefault();
        const target = items[sel];
        if (target) {
          const stem = target.name.replace(/\.[^.]+$/, "");
          const subject = e.shiftKey ? stem || target.name : "";
          openMail([target.path], subject);
        }
      } else if (e.ctrlKey && e.key === "/") {
        e.preventDefault();
        setHelpOpen(true);
      } else if (e.ctrlKey && e.key === ",") {
        e.preventDefault();
        setSettingsSection(null);
        setView("settings");
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
  }, [items, sel, query, view, toolPanel, helpOpen, toolMode, toolHits, listLength, runTool, openMail, actOpen, actReveal, actPin]);

  if (view === "settings" && settings) {
    return (
      <div className="shell">
        <SettingsPanel
          settings={settings}
          section={settingsSection}
          onChange={async (patch) => {
            await persist(patch);
            await reload();
          }}
          onClose={() => {
            setView("launcher");
            setSettingsSection(null);
            inputRef.current?.focus();
          }}
          onToast={showToast}
        />
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  if (toolPanel === "mail") {
    return (
      <div className="shell">
        <MailPanel
          initialAttachments={mailAttachments}
          initialSubject={mailSubject}
          dragging={dragging}
          onClose={() => {
            setToolPanel(null);
            setMailAttachments([]);
            setMailSubject("");
            window.setTimeout(() => inputRef.current?.focus(), 30);
          }}
          onOpenSettings={() => {
            setToolPanel(null);
            setMailAttachments([]);
            setMailSubject("");
            setSettingsSection("mail");
            setView("settings");
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
          placeholder="搜索文件 / 程序，输入 > 使用工具"
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
        <button
          className="icon-btn"
          title="设置"
          onClick={() => {
            setSettingsSection(null);
            setView("settings");
          }}
        >
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
        <button className="icon-btn" title="写邮件 (Ctrl+E)" onClick={() => openMail([])}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path
              d="M3 8l9 6 9-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button className="icon-btn" title="添加文件" onClick={addFiles}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </nav>

      {trackingOff && !tipDismissed && !toolMode && settings?.sync_system_recent && (
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
        {toolMode ? (
          toolHits.length === 0 ? (
            <div className="empty">
              <p>{toolQuery ? `没有匹配 “${toolQuery}” 的操作` : "没有可用的工具"}</p>
            </div>
          ) : (
            toolHits.map((hit, i) => (
              <ToolRow
                key={hit.toolId + ":" + hit.hitId}
                hit={hit}
                active={i === sel}
                onEnter={() => runTool(hit)}
                onHover={() => setSel(i)}
              />
            ))
          )
        ) : (
          <>
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
                <FileRow
                  item={item}
                  active={i === sel}
                  query={query}
                  onEnter={() => actOpen(item)}
                  onHover={() => setSel(i)}
                  onPin={() => actPin(item)}
                  onMail={() => openMail([item.path])}
                  onReveal={() => actReveal(item)}
                />
              </Fragment>
            ))}
          </>
        )}
      </main>

      <footer className="hints">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> 选择
        </span>
        <span>
          <kbd>Enter</kbd> 打开 / 执行
        </span>
        <span>
          <kbd>Ctrl</kbd>+<kbd>P</kbd> 置顶
        </span>
        <span>
          <kbd>Ctrl</kbd>+<kbd>E</kbd> 写邮件
        </span>
        <span>
          <kbd>Ctrl</kbd>+<kbd>/</kbd> 快捷键
        </span>
        <span>
          <kbd>Esc</kbd> 关闭
        </span>
        <div className="spacer" />
        <span className="hint-soft">
          {toolMode ? `${toolHits.length} 个操作` : `${items.length} 个文件`}
        </span>
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
      {helpOpen && settings && (
        <ShortcutHelp hotkey={settings.hotkey} onClose={() => setHelpOpen(false)} />
      )}
    </div>
  );
}
