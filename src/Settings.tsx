import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import * as api from "./api";
import type { AppSettings, Stats, ThemeMode, UpdateInfo } from "./types";
import { eventToShortcut, humanSize, relTime } from "./utils";

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={"switch" + (on ? " on" : "")}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
    >
      <span className="knob" />
    </button>
  );
}

const THEMES: { key: ThemeMode; label: string }[] = [
  { key: "system", label: "跟随系统" },
  { key: "light", label: "浅色" },
  { key: "dark", label: "深色" },
];

export default function SettingsPanel({
  settings,
  onChange,
  onClose,
  onToast,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => Promise<void>;
  onClose: () => void;
  onToast: (msg: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [limit, setLimit] = useState(String(settings.recent_limit));
  const [version, setVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateError, setUpdateError] = useState("");
  const [progress, setProgress] = useState<number | null>(null);

  const refreshStats = async () => setStats(await api.getStats());

  useEffect(() => {
    refreshStats();
    api.appVersion().then(setVersion);
  }, []);

  useEffect(() => {
    const un = listen<{ downloaded: number; total: number | null }>("update-progress", (e) => {
      const { downloaded, total } = e.payload;
      if (total && total > 0) setProgress(Math.min(100, Math.round((downloaded / total) * 100)));
      else setProgress(null);
    });
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  const checkNow = async () => {
    setChecking(true);
    setUpdateError("");
    setUpdateInfo(null);
    try {
      const found = await api.checkUpdate();
      if (found) setUpdateInfo(found);
      else onToast("已经是最新版本");
    } catch (err) {
      setUpdateError(String(err));
    } finally {
      setChecking(false);
    }
  };

  const installNow = async () => {
    setUpdateError("");
    setProgress(0);
    try {
      await api.installUpdate();
    } catch (err) {
      setUpdateError(String(err));
      setProgress(null);
    }
  };

  useEffect(() => {
    setLimit(String(settings.recent_limit));
  }, [settings.recent_limit]);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
      const combo = eventToShortcut(e);
      if (combo) {
        setRecording(false);
        onChange({ hotkey: combo }).then(() => onToast("已设置为 " + combo));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onChange, onToast]);

  const commitLimit = () => {
    const n = Math.min(300, Math.max(20, Number(limit) || 60));
    setLimit(String(n));
    if (n !== settings.recent_limit) onChange({ recent_limit: n });
  };

  const syncNow = async () => {
    onToast("正在同步系统最近记录…");
    const n = await api.refreshRecent();
    onToast(n > 0 ? "已同步 " + n + " 条记录" : "系统里暂时没有最近记录");
    refreshStats();
  };

  const cleanup = async () => {
    const n = await api.cleanupMissing();
    onToast(n > 0 ? "已清理 " + n + " 条失效记录" : "没有失效记录");
    refreshStats();
  };

  const verify = async () => {
    const n = await api.verifyFiles();
    onToast(n > 0 ? "发现 " + n + " 个路径失效" : "所有路径都有效");
    refreshStats();
  };

  return (
    <div className="settings">
      <header className="settings-head">
        <button className="icon-btn" onClick={onClose} title="返回">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M15 5l-7 7 7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <h2>设置</h2>
        <div className="spacer" />
        <button className="ghost" onClick={() => api.quitApp()}>
          退出程序
        </button>
      </header>

      <div className="settings-body">
        <section>
          <h3>外观</h3>
          <div className="segmented">
            {THEMES.map((t) => (
              <button
                key={t.key}
                className={"segment" + (settings.theme === t.key ? " active" : "")}
                onClick={() => onChange({ theme: t.key })}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>呼出快捷键</h3>
          <div className="field">
            <div
              className={"hotkey-box" + (recording ? " recording" : "")}
              tabIndex={0}
              onClick={() => setRecording(true)}
              onKeyDown={() => setRecording(true)}
            >
              {recording ? "请按下新的组合键…（Esc 取消）" : settings.hotkey}
            </div>
            <button className="ghost" onClick={() => onChange({ hotkey: "Alt+Space" })}>
              恢复默认
            </button>
          </div>
          <p className="hint">
            推荐 <kbd>Alt</kbd>+<kbd>Space</kbd>。单独的 <kbd>Ctrl</kbd>+<kbd>Space</kbd>
            会和中文输入法切换冲突。
          </p>
        </section>

        <section>
          <h3>行为</h3>
          <div className="field">
            <label>点到别处时自动隐藏</label>
            <Switch on={settings.hide_on_blur} onChange={(v) => onChange({ hide_on_blur: v })} />
          </div>
          <div className="field">
            <label>开机自动启动</label>
            <Switch on={settings.autostart} onChange={(v) => onChange({ autostart: v })} />
          </div>
          <div className="field">
            <label>启动时导入 Windows 最近使用</label>
            <Switch
              on={settings.sync_system_recent}
              onChange={(v) => onChange({ sync_system_recent: v })}
            />
          </div>
          <div className="field">
            <label>最近列表显示条数</label>
            <input
              className="num"
              type="number"
              min={20}
              max={300}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              onBlur={commitLimit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitLimit();
              }}
            />
          </div>
        </section>

        <section>
          <h3>维护</h3>
          <div className="field">
            <label>从系统同步最近打开的文件</label>
            <button className="ghost" onClick={syncNow}>
              立即同步
            </button>
          </div>
          <div className="field">
            <label>检查记录中的文件是否还存在</label>
            <button className="ghost" onClick={verify}>
              校验路径
            </button>
          </div>
          <div className="field">
            <label>清理已失效的记录</label>
            <button className="ghost" onClick={cleanup}>
              清理
            </button>
          </div>
        </section>

        <section>
          <h3>更新</h3>
          <div className="field">
            <label>当前版本</label>
            <span className="value-mono">{version ? "v" + version : "—"}</span>
          </div>
          <div className="field">
            <label>检查是否有新版本</label>
            <button className="ghost" onClick={checkNow} disabled={checking}>
              {checking ? "检查中…" : "检查更新"}
            </button>
          </div>
          {updateError && <p className="hint error">{updateError}</p>}
          {updateInfo && (
            <div className="update-box">
              <div className="update-title">发现新版本 v{updateInfo.version}</div>
              <div className="update-sub">当前版本 v{updateInfo.current}</div>
              {updateInfo.notes && <pre className="update-notes">{updateInfo.notes}</pre>}
              <button className="primary" onClick={installNow}>
                立即更新并重启
              </button>
            </div>
          )}
          {progress !== null && (
            <>
              <div className="progress">
                <div
                  className={"progress-bar" + (progress === 0 ? " pending" : "")}
                  style={{ width: progress > 0 ? progress + "%" : "35%" }}
                />
              </div>
              <p className="hint">{progress > 0 ? "正在下载… " + progress + "%" : "正在下载…"}</p>
            </>
          )}
        </section>

        <section>
          <h3>概览</h3>
          <div className="stats-row">
            <div className="stat">
              <span className="stat-num">{stats?.total ?? 0}</span>
              <span className="stat-label">总记录</span>
            </div>
            <div className="stat">
              <span className="stat-num">{stats?.pinned ?? 0}</span>
              <span className="stat-label">已置顶</span>
            </div>
            <div className="stat">
              <span className="stat-num">{stats?.missing ?? 0}</span>
              <span className="stat-label">失效</span>
            </div>
          </div>
          {stats && stats.top_files.length > 0 && (
            <ul className="top-list">
              {stats.top_files.map((f) => (
                <li key={f.path}>
                  <span className="top-name">{f.name}</span>
                  <span className="top-meta">
                    {f.open_count} 次 · {relTime(f.last_opened)} · {humanSize(f.size)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">LightRain v0.1.0 · 数据保存在本机 SQLite</p>
        </section>
      </div>
    </div>
  );
}
