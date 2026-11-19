use serde::{Deserialize, Deserializer, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MailSecurity {
    /// 直接建立 TLS 连接（通常 465）
    #[default]
    Tls,
    /// 先明文连接，再升级为 TLS（通常 587）
    StartTls,
    /// 不加密，仅用于本机调试
    None,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct MailConfig {
    pub host: String,
    pub port: u16,
    pub security: MailSecurity,
    pub username: String,
    pub from_name: String,
    /// 常用收件人，写信时会自动填入
    #[serde(deserialize_with = "deserialize_recipients")]
    pub default_to: Vec<String>,
    /// 最近用过的收件人，发送成功后自动记下
    #[serde(default)]
    pub recent_to: Vec<String>,
}

impl Default for MailConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 465,
            security: MailSecurity::Tls,
            username: String::new(),
            from_name: String::new(),
            default_to: Vec::new(),
            recent_to: Vec::new(),
        }
    }
}

impl MailConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.host.trim().is_empty() {
            return Err("请填写 SMTP 服务器地址".into());
        }
        if self.port == 0 {
            return Err("端口不能为 0".into());
        }
        if self.username.trim().is_empty() {
            return Err("请填写邮箱账号".into());
        }
        for (label, value) in [
            ("SMTP 服务器", &self.host),
            ("邮箱账号", &self.username),
            ("发件人名称", &self.from_name),
        ] {
            if value.contains('\r') || value.contains('\n') {
                return Err(format!("{label}不能包含换行符"));
            }
        }
        for recipient in &self.default_to {
            if recipient.contains('\r') || recipient.contains('\n') {
                return Err("默认收件人不能包含换行符".into());
            }
            if !recipient.contains('@') {
                return Err(format!("默认收件人「{recipient}」不是有效邮箱"));
            }
        }
        Ok(())
    }
}

/// 兼容旧版本保存的单个字符串（逗号分隔），新版本存数组。
fn deserialize_recipients<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Raw {
        One(String),
        Many(Vec<String>),
    }

    let items = match Option::<Raw>::deserialize(deserializer)? {
        None => Vec::new(),
        Some(Raw::One(text)) => text
            .split([',', ';', '\n'])
            .map(str::to_string)
            .collect::<Vec<_>>(),
        Some(Raw::Many(list)) => list,
    };

    Ok(items
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_config_keeps_defaults() {
        let config: MailConfig =
            serde_json::from_str(r#"{"host":"smtp.qq.com"}"#).unwrap();
        assert_eq!(config.host, "smtp.qq.com");
        assert_eq!(config.port, 465);
        assert_eq!(config.security, MailSecurity::Tls);
        assert!(config.default_to.is_empty());
    }

    #[test]
    fn accepts_legacy_string_recipients() {
        let config: MailConfig =
            serde_json::from_str(r#"{"defaultTo":"a@x.com, b@x.com"}"#).unwrap();
        assert_eq!(config.default_to, vec!["a@x.com", "b@x.com"]);
    }

    #[test]
    fn accepts_recipient_list() {
        let config: MailConfig =
            serde_json::from_str(r#"{"defaultTo":["a@x.com","b@x.com"]}"#).unwrap();
        assert_eq!(config.default_to, vec!["a@x.com", "b@x.com"]);
    }

    #[test]
    fn rejects_missing_host() {
        assert!(MailConfig::default().validate().is_err());
    }

    #[test]
    fn rejects_invalid_recipient() {
        let config = MailConfig {
            host: "smtp.qq.com".into(),
            username: "me@qq.com".into(),
            default_to: vec!["not-an-email".into()],
            ..MailConfig::default()
        };
        assert!(config.validate().is_err());
    }
}
