import { useEffect } from "react";

type Row = { keys: string[]; desc: string };
type Group = { title: string; rows: Row[] };

export default function ShortcutHelp({
  hotkey,
  onClose,
}: {
  hotkey: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || (e.ctrlKey && e.key === "/")) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const groups: Group[] = [
    {
      title: "呼出与搜索",
      rows: [
        { keys: hotkey.split("+"), desc: "显示 / 隐藏窗口" },
        { keys: ["↑", "↓"], desc: "选择文件" },
        { keys: ["Enter"], desc: "打开文件 / 执行操作" },
        { keys: ["Ctrl", "Enter"], desc: "打开所在文件夹" },
        { keys: ["Esc"], desc: "清空搜索 / 隐藏窗口" },
      ],
    },
    {
      title: "文件",
      rows: [
        {
          keys: ["Ctrl", "P"],
          desc: "置顶 / 取消置顶",
        },
        { keys: ["Ctrl", "D"], desc: "从列表移除" },
        { keys: ["Ctrl", "E"], desc: "用当前文件写邮件" },
        { keys: ["Ctrl", "Shift", "E"], desc: "以文件名为主题写邮件" },
      ],
    },
    {
      title: "界面",
      rows: [
        { keys: ["Ctrl", "1 / 2 / 3"], desc: "全部 / 置顶 / 最近" },
        { keys: [">"], desc: "进入工具模式" },
        { keys: ["Ctrl", ","], desc: "打开设置" },
        { keys: ["Ctrl", "/"], desc: "快捷键说明" },
      ],
    },
    {
      title: "写邮件",
      rows: [
        { keys: ["Ctrl", "Enter"], desc: "发送" },
        { keys: ["Ctrl", "B"], desc: "加粗" },
        { keys: ["Ctrl", "I"], desc: "斜体" },
        { keys: ["Ctrl", "U"], desc: "下划线" },
      ],
    },
  ];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog shortcut-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>快捷键</h3>
        <p className="dialog-sub">在搜索框输入时，字母键优先用于输入文字。</p>

        <div className="shortcut-groups">
          {groups.map((group) => (
            <div className="shortcut-group" key={group.title}>
              <h4>{group.title}</h4>
              {group.rows.map((row) => (
                <div className="shortcut-row" key={row.desc}>
                  <span className="shortcut-keys">
                    {row.keys.map((key) => (
                      <kbd key={key}>{key}</kbd>
                    ))}
                  </span>
                  <span className="shortcut-desc">{row.desc}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="dialog-foot">
          <span className="hint">Esc 或 Ctrl+/ 关闭</span>
          <div className="spacer" />
          <button className="ghost" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
