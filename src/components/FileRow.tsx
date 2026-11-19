import type { FileEntry } from "../types";
import { dirOf, relTime } from "../utils";
import { useIcon } from "../useIcon";

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

export default function FileRow({
  item,
  active,
  query,
  onEnter,
  onHover,
  onPin,
  onMail,
  onReveal,
}: {
  item: FileEntry;
  active: boolean;
  query: string;
  onEnter: () => void;
  onHover: () => void;
  onPin: () => void;
  onMail: () => void;
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
          className="icon-btn mail"
          title="写邮件并附上此文件 (Ctrl+E)"
          onClick={(e) => {
            e.stopPropagation();
            onMail();
          }}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
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
