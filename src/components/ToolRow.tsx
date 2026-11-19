import type { ToolHit } from "../types";

const GLYPHS: Record<string, string> = {
  settings: "⚙",
  refresh: "⟳",
  apps: "▦",
  mail: "✉",
  quit: "⏻",
};

export default function ToolRow({
  hit,
  active,
  onEnter,
  onHover,
}: {
  hit: ToolHit;
  active: boolean;
  onEnter: () => void;
  onHover: () => void;
}) {
  return (
    <div
      className={"row tool" + (active ? " active" : "")}
      onMouseMove={onHover}
      onClick={onEnter}
    >
      <div className="row-icon tool">
        <span className="tool-glyph">{GLYPHS[hit.icon] ?? "›"}</span>
      </div>
      <div className="row-main">
        <div className="row-name">{hit.title}</div>
        <div className="row-path">{hit.subtitle}</div>
      </div>
      <div className="row-meta">
        <span className="meta-pill">操作</span>
      </div>
      <div className="row-actions">
        <button
          className="icon-btn"
          title="执行 (Enter)"
          onClick={(e) => {
            e.stopPropagation();
            onEnter();
          }}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path
              d="M5 12h13M13 6l6 6-6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
