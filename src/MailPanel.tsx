import { useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import * as api from "./api";
import type { MailConfig } from "./types";
import { errorText } from "./utils";

const EMPTY_CONFIG: MailConfig = {
  host: "",
  port: 465,
  security: "tls",
  username: "",
  fromName: "",
  defaultTo: [],
  recentTo: [],
};

function splitList(value: string): string[] {
  return value
    .split(/[,\n;]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 保留简单排版的 HTML 外壳，正文用内联样式，兼容常见邮箱客户端 */
function wrapHtml(inner: string): string {
  return (
    '<div style="font-family:-apple-system,Segoe UI,system-ui,sans-serif;' +
    'font-size:14px;line-height:1.65;color:#222222">' +
    inner +
    "</div>"
  );
}

const TOOLS: { command: string; label: string; title: string; className?: string }[] = [
  { command: "bold", label: "B", title: "加粗 (Ctrl+B)", className: "rte-bold" },
  { command: "italic", label: "I", title: "斜体 (Ctrl+I)", className: "rte-italic" },
  { command: "underline", label: "U", title: "下划线 (Ctrl+U)", className: "rte-underline" },
  { command: "insertUnorderedList", label: "•", title: "无序列表" },
  { command: "insertOrderedList", label: "1.", title: "有序列表" },
];

export default function MailPanel({
  initialAttachments,
  initialSubject,
  dragging,
  onClose,
  onOpenSettings,
  onToast,
}: {
  initialAttachments?: string[];
  initialSubject?: string;
  dragging?: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onToast: (msg: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState<MailConfig>(EMPTY_CONFIG);
  const [hasSecret, setHasSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState(initialSubject ?? "");
  const [attachments, setAttachments] = useState<string[]>([]);

  const subjectRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const [saved, secret] = await Promise.all([api.mailConfigGet(), api.mailSecretStatus()]);
        setConfig(saved);
        setHasSecret(secret);
        if (saved.defaultTo.length > 0) setTo(saved.defaultTo.join(", "));
      } catch (err) {
        setError(errorText(err));
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.setTimeout(() => {
      if (initialSubject) editorRef.current?.focus();
      else if (splitList(to).length > 0) subjectRef.current?.focus();
      else toRef.current?.focus();
    }, 20);
    // 只在首次载入后聚焦
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(() => {
    if (initialAttachments && initialAttachments.length > 0) {
      setAttachments((prev) => [...new Set([...prev, ...initialAttachments])]);
    }
  }, [initialAttachments]);

  const configured = Boolean(config.host.trim() && config.username.trim());

  const recipients = useMemo(() => splitList(to), [to]);

  const recent = useMemo(
    () =>
      config.recentTo.filter(
        (email) =>
          !config.defaultTo.some((item) => item.toLowerCase() === email.toLowerCase())
      ),
    [config.recentTo, config.defaultTo]
  );

  const isActive = (email: string) =>
    recipients.some((item) => item.toLowerCase() === email.toLowerCase());

  const sameAsDefaults =
    config.defaultTo.length === recipients.length &&
    config.defaultTo.every((email) => isActive(email));

  const saveRecipients = async () => {
    const list = splitList(to);
    if (list.length === 0) return;
    try {
      const next = { ...config, defaultTo: list };
      await api.mailConfigSet(next);
      setConfig(next);
      onToast("已保存为默认收件人");
    } catch (err) {
      setError(errorText(err));
    }
  };

  const toggleRecipient = (email: string) => {
    setTo((prev) => {
      const list = splitList(prev);
      const exists = list.some((item) => item.toLowerCase() === email.toLowerCase());
      const next = exists
        ? list.filter((item) => item.toLowerCase() !== email.toLowerCase())
        : [...list, email];
      return next.join(", ");
    });
  };

  const format = (command: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(command);
  };

  const addAttachments = async () => {
    await api.holdBlur();
    try {
      const picked = await openDialog({ multiple: true, title: "选择邮件附件" });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      if (paths.length > 0) {
        setAttachments((prev) => [...new Set([...prev, ...paths])]);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      await api.releaseBlur();
    }
  };

  const send = async () => {
    if (busy) return;
    const list = splitList(to);
    if (list.length === 0) {
      setError("请至少填写一个收件人");
      toRef.current?.focus();
      return;
    }
    if (!configured) {
      setError("还没有配置发件邮箱，请先在设置里填写账号");
      return;
    }
    if (!hasSecret) {
      setError("还没有填写密码或授权码，请先在设置里补充");
      return;
    }

    const editor = editorRef.current;
    const htmlBody = editor?.innerHTML.trim() ?? "";
    const plainBody = editor?.innerText.trim() ?? "";
    const hasBody = htmlBody !== "" && htmlBody !== "<br>";

    setBusy(true);
    setError("");
    try {
      await api.mailSend(config, {
        to: list,
        cc: splitList(cc),
        bcc: splitList(bcc),
        subject,
        body: plainBody,
        html: hasBody ? wrapHtml(htmlBody) : "",
        attachments,
      });
      onToast("邮件已发送");
      setSubject("");
      setAttachments([]);
      if (editor) editor.innerHTML = "";

      // 记住最近用过的收件人，方便下次一键添加
      const used: string[] = [];
      for (const email of [...list, ...splitList(cc)]) {
        if (!used.some((item) => item.toLowerCase() === email.toLowerCase())) used.push(email);
      }
      const recentTo = [...used, ...config.recentTo].reduce<string[]>((acc, email) => {
        if (!acc.some((item) => item.toLowerCase() === email.toLowerCase())) acc.push(email);
        return acc;
      }, []).slice(0, 8);
      const nextConfig = { ...config, recentTo };
      setConfig(nextConfig);
      api.mailConfigSet(nextConfig).catch(() => {
        // 记录失败不影响这次发送
      });

      subjectRef.current?.focus();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void send();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
        <h2>写邮件</h2>
        <div className="spacer" />
        <button className="ghost" onClick={onOpenSettings}>
          {configured ? config.username : "配置邮箱"}
        </button>
      </header>

      <div className="settings-body">
        {loaded && (!configured || !hasSecret) && (
          <div className="mail-notice">
            <span>{configured ? "还差一个密码 / 授权码" : "还没有配置发件邮箱"}</span>
            <button className="ghost" onClick={onOpenSettings}>
              去设置
            </button>
          </div>
        )}

        <section>
          <div className="mail-grid">
            <label className="mail-field wide">
              <span className="mail-label">
                收件人
                <span className="mail-label-actions">
                  {configured && recipients.length > 0 && !sameAsDefaults && (
                    <button type="button" className="link-btn" onClick={saveRecipients}>
                      存为默认
                    </button>
                  )}
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setShowCc((prev) => !prev)}
                  >
                    {showCc ? "隐藏抄送" : "抄送 / 密送"}
                  </button>
                </span>
              </span>
              <input
                ref={toRef}
                className="text-input"
                value={to}
                spellCheck={false}
                placeholder="a@example.com，多个用逗号分隔"
                onChange={(e) => setTo(e.target.value)}
              />
            </label>

            {config.defaultTo.length > 0 && (
              <div className="quick-to">
                <span className="quick-label">常用</span>
                {config.defaultTo.map((email) => (
                  <button
                    key={email}
                    type="button"
                    className={"quick-chip" + (isActive(email) ? " active" : "")}
                    title={isActive(email) ? "点击取消" : "点击加入收件人"}
                    onClick={() => toggleRecipient(email)}
                  >
                    {email}
                  </button>
                ))}
              </div>
            )}

            {recent.length > 0 && (
              <div className="quick-to">
                <span className="quick-label">最近</span>
                {recent.map((email) => (
                  <button
                    key={email}
                    type="button"
                    className={"quick-chip" + (isActive(email) ? " active" : "")}
                    title={isActive(email) ? "点击取消" : "点击加入收件人"}
                    onClick={() => toggleRecipient(email)}
                  >
                    {email}
                  </button>
                ))}
              </div>
            )}

            {showCc && (
              <>
                <label className="mail-field">
                  <span>抄送</span>
                  <input
                    className="text-input"
                    value={cc}
                    spellCheck={false}
                    onChange={(e) => setCc(e.target.value)}
                  />
                </label>
                <label className="mail-field">
                  <span>密送</span>
                  <input
                    className="text-input"
                    value={bcc}
                    spellCheck={false}
                    onChange={(e) => setBcc(e.target.value)}
                  />
                </label>
              </>
            )}

            <label className="mail-field wide">
              <span>主题</span>
              <input
                ref={subjectRef}
                className="text-input"
                value={subject}
                spellCheck={false}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>

            <div className="mail-field wide">
              <span>正文</span>
              <div className="rte">
                <div className="rte-toolbar">
                  {TOOLS.map((tool) => (
                    <button
                      key={tool.command}
                      type="button"
                      className={"rte-btn" + (tool.className ? " " + tool.className : "")}
                      title={tool.title}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => format(tool.command)}
                    >
                      {tool.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="rte-btn rte-clear"
                    title="清除格式"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => format("removeFormat")}
                  >
                    清除
                  </button>
                </div>
                <div
                  ref={editorRef}
                  className="rte-editor"
                  contentEditable
                  role="textbox"
                  aria-multiline="true"
                  data-placeholder="写点什么…可以加粗、做列表"
                  onPaste={(e) => {
                    e.preventDefault();
                    const text = e.clipboardData.getData("text/plain");
                    if (!text) return;
                    const html = text.split(/\r?\n/).map(escapeHtml).join("<br>");
                    document.execCommand("insertHTML", false, html);
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="attachment-list">
            {attachments.map((path) => (
              <span className="attachment-chip" key={path} title={path}>
                {path.split(/[\\/]/).pop() || path}
                <button
                  className="icon-btn"
                  title="移除附件"
                  onClick={() => setAttachments((prev) => prev.filter((p) => p !== path))}
                >
                  <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
                    <path
                      d="M6 6l12 12M18 6L6 18"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </span>
            ))}
            <button className="ghost" onClick={addAttachments} disabled={busy}>
              添加附件
            </button>
            <span className="hint attachment-hint">可拖拽文件到窗口，最多 10 个 / 20MB</span>
          </div>
        </section>

        {error && <p className="hint error">{error}</p>}

        <div className="mail-send">
          <button
            className="primary"
            onClick={send}
            disabled={!loaded || busy || !configured || !hasSecret}
          >
            {busy ? "发送中…" : "发送"}
          </button>
          <span className="hint">Ctrl+Enter 发送</span>
        </div>
      </div>

      {dragging && <div className="drop-hint">松手即可添加附件</div>}
    </div>
  );
}
