use std::path::Path;
use std::time::Duration;

use lettre::message::header::ContentType;
use lettre::message::{Attachment, Mailbox, Message, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::Tls;
use lettre::{SmtpTransport, Transport};

use crate::tools::ToolError;

use super::config::{MailConfig, MailSecurity};
use super::MailDraft;

const MAX_ATTACHMENTS: usize = 10;
const MAX_ATTACHMENT_BYTES: u64 = 20 * 1024 * 1024;

pub fn test(config: &MailConfig, password: &str) -> Result<(), ToolError> {
    config
        .validate()
        .map_err(|e| ToolError::new("config", &e))?;
    let mailer = transport(config, password)?;
    mailer
        .test_connection()
        .map(|_| ())
        .map_err(map_error)
}

pub fn send(config: &MailConfig, password: &str, draft: &MailDraft) -> Result<(), ToolError> {
    config
        .validate()
        .map_err(|e| ToolError::new("config", &e))?;
    let message = build_message(config, draft)?;
    let mailer = transport(config, password)?;
    mailer.send(&message).map(|_| ()).map_err(map_error)
}

fn transport(config: &MailConfig, password: &str) -> Result<SmtpTransport, ToolError> {
    let host = config.host.trim();
    let builder = match config.security {
        MailSecurity::Tls => SmtpTransport::relay(host).map_err(map_error)?,
        MailSecurity::StartTls => SmtpTransport::starttls_relay(host).map_err(map_error)?,
        MailSecurity::None => SmtpTransport::builder_dangerous(host).tls(Tls::None),
    };

    Ok(builder
        .port(config.port)
        .credentials(Credentials::new(
            config.username.trim().to_string(),
            password.to_string(),
        ))
        .timeout(Some(Duration::from_secs(20)))
        .build())
}

fn build_message(config: &MailConfig, draft: &MailDraft) -> Result<Message, ToolError> {
    if draft.to.is_empty() {
        return Err(ToolError::new("no_recipient", "请至少填写一个收件人"));
    }
    if draft.subject.contains('\r') || draft.subject.contains('\n') {
        return Err(ToolError::new("bad_subject", "主题不能包含换行符"));
    }

    let from = parse_mailbox(&sender(config))?;
    let mut builder = Message::builder()
        .from(from)
        .subject(draft.subject.clone());

    for addr in &draft.to {
        builder = builder.to(parse_mailbox(addr)?);
    }
    for addr in &draft.cc {
        builder = builder.cc(parse_mailbox(addr)?);
    }
    for addr in &draft.bcc {
        builder = builder.bcc(parse_mailbox(addr)?);
    }

    let body = if draft.html.trim().is_empty() {
        MultiPart::mixed().singlepart(SinglePart::plain(draft.body.clone()))
    } else {
        MultiPart::mixed().multipart(MultiPart::alternative_plain_html(
            draft.body.clone(),
            draft.html.clone(),
        ))
    };

    let mut multipart = body;
    for part in attachment_parts(draft)? {
        multipart = multipart.singlepart(part);
    }

    builder
        .multipart(multipart)
        .map_err(|e| ToolError::new("message", &format!("构造邮件失败：{e}")))
}

fn sender(config: &MailConfig) -> String {
    let name = config.from_name.trim();
    if name.is_empty() {
        config.username.trim().to_string()
    } else {
        format!("{name} <{}>", config.username.trim())
    }
}

fn parse_mailbox(raw: &str) -> Result<Mailbox, ToolError> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err(ToolError::new("bad_address", "收件人地址不能为空"));
    }
    if raw.contains('\r') || raw.contains('\n') {
        return Err(ToolError::new("bad_address", "地址不能包含换行符"));
    }
    raw.parse::<Mailbox>()
        .map_err(|_| ToolError::new("bad_address", &format!("地址无效：{raw}")))
}

fn attachment_parts(draft: &MailDraft) -> Result<Vec<SinglePart>, ToolError> {
    if draft.attachments.len() > MAX_ATTACHMENTS {
        return Err(ToolError::new(
            "too_many_attachments",
            &format!("最多添加 {MAX_ATTACHMENTS} 个附件"),
        ));
    }

    let mut total = 0u64;
    let mut parts = Vec::with_capacity(draft.attachments.len());
    for path in &draft.attachments {
        let file = Path::new(path);
        if !file.is_file() {
            return Err(ToolError::new(
                "bad_attachment",
                &format!("附件不存在：{path}"),
            ));
        }
        let size = std::fs::metadata(file)
            .map_err(|e| ToolError::new("bad_attachment", &format!("读取附件失败：{e}")))?
            .len();
        total += size;
        if total > MAX_ATTACHMENT_BYTES {
            return Err(ToolError::new(
                "attachment_too_large",
                "附件总大小超过 20MB",
            ));
        }

        let name = file
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "attachment".into());
        let data = std::fs::read(file)
            .map_err(|e| ToolError::new("bad_attachment", &format!("读取附件失败：{e}")))?;
        parts.push(Attachment::new(name).body(data, content_type(file)));
    }
    Ok(parts)
}

fn content_type(path: &Path) -> ContentType {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_lowercase();
    let mime = match ext.as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "txt" => "text/plain",
        "csv" => "text/csv",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    };
    ContentType::parse(mime).unwrap_or(ContentType::TEXT_PLAIN)
}

fn map_error(err: impl std::fmt::Display) -> ToolError {
    let raw = err.to_string();
    let lower = raw.to_lowercase();

    let (code, message) = if lower.contains("535")
        || lower.contains("5.7.8")
        || lower.contains("authentication")
        || lower.contains("invalid credentials")
    {
        (
            "auth",
            "账号或授权码错误。QQ/163 邮箱需要填写「授权码」，不是登录密码。".to_string(),
        )
    } else if lower.contains("tls")
        || lower.contains("certificate")
        || lower.contains("handshake")
        || lower.contains("ssl")
    {
        (
            "tls",
            "TLS 握手失败：检查端口和加密方式（465 用 SSL/TLS，587 用 STARTTLS）。".to_string(),
        )
    } else if lower.contains("timed out") || lower.contains("timeout") {
        (
            "timeout",
            "连接超时：检查 SMTP 地址、端口和网络/代理。".to_string(),
        )
    } else if lower.contains("dns")
        || lower.contains("failed to lookup")
        || lower.contains("name or service")
    {
        ("dns", "无法解析 SMTP 服务器地址。".to_string())
    } else if lower.contains("connection refused")
        || lower.contains("connection reset")
        || lower.contains("failed to connect")
        || lower.contains("connect")
    {
        (
            "connect",
            "连不上 SMTP 服务器，检查地址和端口。".to_string(),
        )
    } else {
        ("smtp", format!("发送失败：{raw}"))
    };

    ToolError::new(code, &message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> MailConfig {
        MailConfig {
            host: "smtp.example.com".into(),
            port: 465,
            security: MailSecurity::Tls,
            username: "me@example.com".into(),
            from_name: "Me".into(),
            default_to: Vec::new(),
            recent_to: Vec::new(),
        }
    }

    fn draft() -> MailDraft {
        MailDraft {
            to: vec!["you@example.com".into()],
            cc: vec![],
            bcc: vec![],
            subject: "Hello".into(),
            body: "Body".into(),
            html: String::new(),
            attachments: vec![],
        }
    }

    #[test]
    fn builds_a_plain_message() {
        assert!(build_message(&config(), &draft()).is_ok());
    }

    #[test]
    fn builds_html_alternative() {
        let mut message = draft();
        message.html = "<div><b>Body</b></div>".into();
        let built = build_message(&config(), &message).unwrap();
        let raw = String::from_utf8(built.formatted()).unwrap();
        assert!(raw.to_lowercase().contains("text/html"));
        assert!(raw.to_lowercase().contains("text/plain"));
    }

    #[test]
    fn rejects_header_injection() {
        let mut message = draft();
        message.subject = "Hello\r\nBcc: hidden@example.com".into();
        assert!(build_message(&config(), &message).is_err());
    }

    #[test]
    fn rejects_too_many_attachments() {
        let mut message = draft();
        message.attachments = (0..11)
            .map(|index| format!("C:/tmp/{index}.txt"))
            .collect();
        assert!(build_message(&config(), &message).is_err());
    }
}
