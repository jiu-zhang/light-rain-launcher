import { useEffect, useState } from "react";

import * as api from "./api";
import type { MailConfig, MailSecurity } from "./types";
import { errorText } from "./utils";

const PRESETS = [
  { key: "qq", label: "QQ 邮箱", host: "smtp.qq.com", port: 465, security: "tls" as MailSecurity },
  { key: "163", label: "163 邮箱", host: "smtp.163.com", port: 465, security: "tls" as MailSecurity },
  { key: "126", label: "126 邮箱", host: "smtp.126.com", port: 465, security: "tls" as MailSecurity },
  { key: "gmail", label: "Gmail", host: "smtp.gmail.com", port: 465, security: "tls" as MailSecurity },
  {
    key: "outlook",
    label: "Outlook",
    host: "smtp.office365.com",
    port: 587,
    security: "startTls" as MailSecurity,
  },
  { key: "custom", label: "自定义", host: "", port: 465, security: "tls" as MailSecurity },
] as const;

type PresetKey = (typeof PRESETS)[number]["key"];

const DOMAINS = [
  "qq.com",
  "163.com",
  "126.com",
  "gmail.com",
  "outlook.com",
  "foxmail.com",
  "sina.com",
];

/** 邮箱账号输入：输入本地部分后补全常用后缀，可上下键选择 */
function EmailInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const at = value.indexOf("@");
  const local = (at >= 0 ? value.slice(0, at) : value).trim();
  const typedDomain = at >= 0 ? value.slice(at + 1).trim().toLowerCase() : "";
  const options = local
    ? DOMAINS.filter(
        (domain) => domain.startsWith(typedDomain) && domain !== typedDomain
      ).map((domain) => `${local}@${domain}`)
    : [];
  const visible = open && options.length > 0;

  const pick = (email: string) => {
    onChange(email);
    setOpen(false);
    setActive(0);
  };

  return (
    <div className="email-input">
      <input
        className="text-input"
        value={value}
        spellCheck={false}
        autoComplete="off"
        placeholder="you@qq.com"
        aria-autocomplete="list"
        aria-expanded={visible}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!visible) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((prev) => (prev + 1) % options.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((prev) => (prev - 1 + options.length) % options.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(options[Math.min(active, options.length - 1)]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {visible && (
        <div className="email-suggest" role="listbox">
          {options.map((email, index) => (
            <button
              key={email}
              type="button"
              role="option"
              aria-selected={index === active}
              className={"email-suggest-item" + (index === active ? " active" : "")}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(email);
              }}
              onMouseEnter={() => setActive(index)}
            >
              {email}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const EMPTY: MailConfig = {
  host: "",
  port: 465,
  security: "tls",
  username: "",
  fromName: "",
  defaultTo: [],
  recentTo: [],
};

function presentKey(host: string): PresetKey {
  const target = host.trim().toLowerCase();
  const found = PRESETS.find((preset) => preset.key !== "custom" && preset.host === target);
  return found ? found.key : "custom";
}

export default function MailSettings({ onToast }: { onToast: (msg: string) => void }) {
  const [config, setConfig] = useState<MailConfig>(EMPTY);
  const [password, setPassword] = useState("");
  const [hasSecret, setHasSecret] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [presetChoice, setPresetChoice] = useState<PresetKey | null>(null);
  const [draftRecipient, setDraftRecipient] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [saved, secret] = await Promise.all([api.mailConfigGet(), api.mailSecretStatus()]);
        setConfig(saved);
        setHasSecret(secret);
        setAdvanced(presentKey(saved.host) === "custom");
      } catch (err) {
        setError(errorText(err));
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const patch = <K extends keyof MailConfig>(key: K, value: MailConfig[K]) =>
    setConfig((prev) => ({ ...prev, [key]: value }));

  const preset = presetChoice ?? presentKey(config.host);

  const choosePreset = (key: PresetKey) => {
    setPresetChoice(key);
    const target = PRESETS.find((item) => item.key === key);
    if (!target) return;
    if (key === "custom") {
      setAdvanced(true);
      return;
    }
    setConfig((prev) => ({ ...prev, host: target.host, port: target.port, security: target.security }));
  };

  const addRecipient = (raw: string) => {
    const email = raw.trim().replace(/[,;\s]+$/, "").trim();
    if (!email) return;
    setConfig((prev) =>
      prev.defaultTo.some((item) => item.toLowerCase() === email.toLowerCase())
        ? prev
        : { ...prev, defaultTo: [...prev.defaultTo, email] }
    );
    setDraftRecipient("");
  };

  const removeRecipient = (email: string) =>
    setConfig((prev) => ({ ...prev, defaultTo: prev.defaultTo.filter((item) => item !== email) }));

  const merged = (): MailConfig => {
    const draft = draftRecipient.trim();
    if (!draft) return config;
    if (config.defaultTo.some((item) => item.toLowerCase() === draft.toLowerCase())) return config;
    return { ...config, defaultTo: [...config.defaultTo, draft] };
  };

  const save = async () => {
    if (busy) return;
    setBusy("save");
    setError("");
    try {
      const next = merged();
      setConfig(next);
      setDraftRecipient("");
      await api.mailConfigSet(next);
      if (password.trim()) {
        await api.mailSecretSet(password);
        setPassword("");
        setHasSecret(true);
      }
      onToast("邮箱设置已保存");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    if (busy) return;
    setBusy("test");
    setError("");
    try {
      await api.mailTest(merged(), password.trim() || undefined);
      onToast("连接成功，账号可用");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const clearSecret = async () => {
    setError("");
    try {
      await api.mailSecretClear();
      setHasSecret(false);
      setPassword("");
      onToast("已清除保存的密码");
    } catch (err) {
      setError(errorText(err));
    }
  };

  if (!loaded) {
    return (
      <section id="mail">
        <p className="hint">正在读取…</p>
      </section>
    );
  }

  return (
    <section id="mail">
      <div className="mail-grid">
        <label className="mail-field">
          <span>服务商</span>
          <select
            className="select-input"
            value={preset}
            onChange={(e) => choosePreset(e.target.value as PresetKey)}
          >
            {PRESETS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mail-field">
          <span>邮箱账号</span>
          <EmailInput
            value={config.username}
            onChange={(value) => patch("username", value)}
          />
        </label>
        <label className="mail-field wide">
          <span>密码 / 授权码</span>
          <input
            className="text-input"
            type="password"
            value={password}
            placeholder={hasSecret ? "已保存，留空则不修改" : "QQ / 163 请填写授权码"}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      </div>

      <p className="hint">密码用 Windows DPAPI 加密保存在本机，不会回传到界面。</p>

      <div className="mail-field wide recipient-block">
        <span>默认收件人</span>
        <div className="recipient-chips">
          {config.defaultTo.map((email) => (
            <span className="attachment-chip" key={email} title={email}>
              {email}
              <button
                className="icon-btn"
                title="移除"
                onClick={() => removeRecipient(email)}
                type="button"
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
          <input
            className="text-input recipient-input"
            value={draftRecipient}
            spellCheck={false}
            placeholder="输入邮箱后回车添加"
            onChange={(e) => {
              const value = e.target.value;
              if (/[,;]$/.test(value)) addRecipient(value.slice(0, -1));
              else setDraftRecipient(value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addRecipient(draftRecipient);
              } else if (e.key === "Backspace" && !draftRecipient && config.defaultTo.length > 0) {
                removeRecipient(config.defaultTo[config.defaultTo.length - 1]);
              }
            }}
            onBlur={() => addRecipient(draftRecipient)}
          />
        </div>
        <p className="hint">写邮件时自动填入，可在面板里一键取消。</p>
      </div>

      <details
        className="mail-advanced"
        open={advanced}
        onToggle={(e) => setAdvanced((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>高级设置</summary>
        <div className="mail-grid">
          <label className="mail-field">
            <span>SMTP 服务器</span>
            <input
              className="text-input"
              value={config.host}
              spellCheck={false}
              placeholder="smtp.qq.com"
              onChange={(e) => {
                setPresetChoice(null);
                patch("host", e.target.value);
              }}
            />
          </label>
          <label className="mail-field">
            <span>端口</span>
            <input
              className="num"
              type="number"
              min={1}
              max={65535}
              value={config.port || ""}
              onChange={(e) => patch("port", Number(e.target.value) || 0)}
            />
          </label>
          <label className="mail-field">
            <span>加密方式</span>
            <select
              className="select-input"
              value={config.security}
              onChange={(e) => patch("security", e.target.value as MailSecurity)}
            >
              <option value="tls">SSL / TLS</option>
              <option value="startTls">STARTTLS</option>
              <option value="none">不加密</option>
            </select>
          </label>
          <label className="mail-field">
            <span>发件人名称</span>
            <input
              className="text-input"
              value={config.fromName}
              spellCheck={false}
              placeholder="可选"
              onChange={(e) => patch("fromName", e.target.value)}
            />
          </label>
        </div>
      </details>

      <div className="mail-actions">
        <button className="ghost" onClick={save} disabled={busy !== null}>
          {busy === "save" ? "保存中…" : "保存"}
        </button>
        <button className="ghost" onClick={test} disabled={busy !== null}>
          {busy === "test" ? "连接中…" : "测试连接"}
        </button>
        {hasSecret && (
          <button className="ghost danger-text" onClick={clearSecret} disabled={busy !== null}>
            清除密码
          </button>
        )}
      </div>

      {error && <p className="hint error">{error}</p>}
    </section>
  );
}
