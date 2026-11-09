import * as api from "./api";
import type { ForegroundInfo } from "./types";

export default function PinDialog({
  info,
  onClose,
  onDone,
}: {
  info: ForegroundInfo;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const pin = async (path: string, name: string) => {
    await api.pinForegroundResult(path);
    onDone("已置顶：" + name);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>固定当前正在编辑的文件</h3>
        <p className="dialog-sub">
          前台窗口：{info.exe_name || "未知"} · {info.title || "无标题"}
        </p>

        {info.candidates.length === 0 ? (
          <p className="empty-inline">
            没能从窗口标题中识别出文件。可以先用快捷键呼出面板，搜索文件名后按 Ctrl+P 置顶。
          </p>
        ) : (
          <ul className="cand-list">
            {info.candidates.map((c) => (
              <li key={c.path}>
                <div className="cand-main">
                  <span className="cand-name">{c.name}</span>
                  <span className="cand-path">{c.path}</span>
                </div>
                <span className={"tag " + (c.confidence === "high" ? "ok" : "soft")}>{c.reason}</span>
                <button className="primary" onClick={() => pin(c.path, c.name)}>
                  置顶
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="dialog-foot">
          <button className="ghost" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
