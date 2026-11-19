# LightRain

> 一个用 Tauri 2 + React 写的「最近文件 / 置顶文件」快速启动器。
> 全局快捷键呼出，搜一下就能打开今天改过的那个 Excel。

## 功能

### 文件来源
- **自动读取 Windows「最近使用」**：解析 `%APPDATA%\Microsoft\Windows\Recent` 下的快捷方式，装好即能看到历史记录，覆盖所有程序打开过的文件。
- **自身使用记录**：从面板里打开的文件会累加打开次数，参与排序。
- **手动添加 / 拖拽导入**：从资源管理器把文件拖进窗口即可固定。

### 排序
- **frecency 排序**：最近 1 天 / 7 天 / 30 天 / 90 天分层加权，再叠加打开次数，比单纯按时间更贴近真实习惯。
- 置顶项永远排在最前，可手动调整顺序（数据层已支持 `reorder_pins`）。

### 搜索
- **程序搜索**：扫描开始菜单（含子目录）里的快捷方式，输入 `chrome`、`excel`、`git bash` 直接打开；结果与文件混排，同匹配质量下程序排在文件前面
- 文件名、完整路径模糊匹配（skim 算法）
- **拼音首字母**：输入 `gzhbg` 可命中「工作汇报.docx」
- 匹配等级：精确 > 前缀 > 包含 > 拼音 > 模糊 > 路径模糊

### 快捷操作
| 快捷键 | 作用 |
| --- | --- |
| `Alt+Space` | 全局呼出 / 隐藏（可在设置里改） |
| `↑` `↓` / `PgUp` `PgDn` | 选择 |
| `Enter` | 用默认程序打开 |
| `Ctrl+Enter` | 在资源管理器中定位 |
| `Ctrl+P` | 置顶 / 取消置顶 |
| `Ctrl+D` | 从列表移除 |
| `Ctrl+E` | 用当前文件写邮件（行内也有邮件按钮） |
| `Ctrl+Shift+E` | 以文件名为主题快速写邮件 |
| `Ctrl+1/2/3` | 切换「全部 / 置顶 / 最近」 |
| `Ctrl+,` | 打开设置 |
| `Ctrl+/` | 快捷键说明 |
| `>` | 工具模式（`>邮件`、`>设置` 等） |
| `Esc` | 清空搜索，再按一次隐藏窗口 |

> 默认快捷键是 `Alt+Space` 而不是 `Ctrl+Space` —— 后者是中文输入法的切换键，会冲突。

### 其他
- **一键固定当前正在编辑的文件**：托盘菜单 →「固定当前正在编辑的文件」，按前台窗口标题反查文件路径，给出候选让你确认。
- 窗口失焦自动隐藏、托盘常驻、开机自启、单实例；设置页会临时取消置顶，方便对照其他窗口。
- 系统原生文件图标（SHGetFileInfo 提取）。
- 失效路径自动标记，支持一键校验 / 清理。

## 技术栈

- **Tauri 2**（Rust）+ 托盘、全局快捷键、单实例、自启动、文件对话框插件
- **前端**：React 18 + TypeScript + Vite
- **数据**：SQLite（rusqlite，bundled，无需额外安装）
- **Windows 集成**：`windows` crate —— `IShellLinkW` 解析快捷方式、`SHGetFileInfoW` 取图标、
  `GetForegroundWindow` + `QueryFullProcessImageNameW` 识别前台程序、`ShellExecuteW` 打开文件

## 目录结构

```
light-rain-launcher/
├── src/                     前端
│   ├── App.tsx              主面板：搜索、键盘导航、分组列表、工具模式
│   ├── Settings.tsx         设置页（基础 / 邮箱 / 数据 / 关于）
│   ├── MailSettings.tsx     设置里的邮箱配置（服务商预设、默认收件人）
│   ├── MailPanel.tsx        邮件撰写面板
│   ├── ShortcutHelp.tsx     快捷键说明弹窗
│   ├── PinDialog.tsx        固定当前文件的候选弹窗
│   ├── components/          FileRow / ToolRow / 图标
│   ├── api.ts / types.ts    invoke 封装与类型
│   └── styles.css           全部样式
├── src-tauri/
│   ├── src/lib.rs           窗口、托盘、热键、事件
│   ├── src/commands.rs      Tauri 命令层
│   ├── src/config.rs        统一配置读写（app.settings / tool.<id>.settings）
│   ├── src/tools/mod.rs     工具注册表：list / search / run / config
│   ├── src/tools/mail/      邮件工具：配置、DPAPI、SMTP
│   ├── src/db.rs            SQLite、迁移与 frecency
│   ├── src/recent.rs        系统「最近使用」读取
│   ├── src/sys.rs           Win32 调用（打开 / 定位 / 图标 / 前台窗口）
│   └── src/search.rs        搜索与排序
└── scripts/make-icon.cjs    生成应用图标（纯 Node，无依赖）
```

## 开发

```bash
npm install
npm run tauri dev      # 开发（Vite 热更新 + Rust 编译）
npm run tauri build    # 打包 NSIS 安装包
```

## 数据位置

`%APPDATA%\com.lightrain.launcher\light-rain.db`

设置项以 JSON 存在同库的 `config` 表里（键为 `app.settings`，工具配置为 `tool.<id>.settings`），
删掉这个文件即恢复出厂状态。旧版的 `settings` 表会在启动时自动迁移。

## 扩展工具

工具在编译期注册，不加载动态插件：

1. 在 `src-tauri/src/tools/mod.rs` 的 `TOOLS` 里加元信息（id、名称、触发前缀）；
2. 在 `tool_search` 里产出 `ToolHit`，在 `tool_run` 里加执行分支；
3. 需要界面时，前端新增面板组件，并用 `ToolAction::OpenPanel { panel }` 打开。

约定：

- `tool_search` 只能读内存，不许做 IO；耗时操作一律 `async` + `spawn_blocking`，不要持有 `Db` 锁；
- 工具配置走 `tool_config_get / tool_config_set`，结构体加 `#[serde(default)]`，避免新增字段时重置旧配置；
- 密码、令牌不要放进工具配置，后续接 Windows DPAPI 单独存，前端只拿 `has_password`。

输入 `>` 进入工具模式，例如 `>设置`、`>同步`。

### 邮件工具

- 账号在「设置 → 邮箱」里配置：选服务商（QQ / 163 / 126 / Gmail / Outlook）后只需填账号和授权码；输入本地部分会自动补全常用邮箱后缀；服务器、端口、加密方式收在「高级设置」里；
- 同处可保存多个默认收件人，写邮件时自动填入，也可以点常用地址快速增删；发送成功后会记住最近收件人；
- 输入 `>邮件`（或 `>mail`）打开撰写面板；在文件行按 `Ctrl+E`，把当前文件作为附件打开面板；
- 撰写面板只负责收件人、主题、正文和附件，`Ctrl+Enter` 发送；抄送 / 密送默认收起；
- 正文是简单富文本：加粗、斜体、下划线、列表，粘贴按纯文本处理；同时发送 HTML 与纯文本两份；
- 文件可以直接拖进写信窗口作为附件；写信面板和设置页打开时不会因为点到别处而自动隐藏；
- 密码用 Windows DPAPI 按当前用户加密保存，前端只能看到「已保存」，不会拿到明文；
- 支持 465（SSL/TLS）、587（STARTTLS）和本机调试用的不加密模式；
- 附件最多 10 个、总大小 20MB；发送失败会翻译成中文原因（授权码错误、TLS 端口不匹配、超时等）。

服务商预设：

| 邮箱 | 服务器 | 端口 | 加密 |
| --- | --- | --- | --- |
| QQ 邮箱 | `smtp.qq.com` | 465 | SSL/TLS |
| 163 邮箱 | `smtp.163.com` | 465 | SSL/TLS |
| 126 邮箱 | `smtp.126.com` | 465 | SSL/TLS |
| Gmail | `smtp.gmail.com` | 465 | SSL/TLS |
| Outlook | `smtp.office365.com` | 587 | STARTTLS |

QQ / 163 需要在邮箱设置里生成「授权码」，不是登录密码。

## 发布与自动更新

应用内置了 Tauri 官方更新器，安装包只用**你自己的私钥**签名，别人伪造的更新包装不上。

### 密钥（已生成，务必备份）

签名密钥对已经在本机生成：

- 私钥：`%USERPROFILE%\.tauri\lightrain-updater.key`（无密码，**不要提交到仓库，丢了就再也签不了更新**）
- 公钥：已写进 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`

### 一次性配置

1. GitHub 仓库 → Settings → Secrets and variables → Actions，新增：
   - `TAURI_SIGNING_PRIVATE_KEY`：私钥文件的**完整内容**
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：私钥没有密码就**不要创建**这个 secret
2. 把 `src-tauri/tauri.conf.json` 里 `plugins.updater.endpoints` 的 `OWNER/REPO` 改成本仓库
   （也可以不改，直接在应用「设置 → 更新 → 更新清单地址」里填，运行时会覆盖配置）

### 发版

三处版本号要一致：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`。

```bash
# 1. 改完三个版本号后
git commit -am "chore: release v0.2.0"
git tag v0.2.0
git push origin v0.2.0
```

推送 tag 后 `.github/workflows/release.yml` 会：打包 → 用私钥签名 → 生成 `latest.json` → 创建 draft release。
到 Releases 里检查无误后点「发布」，老客户端点「检查更新」就能收到。

本地自测打包：

```bash
set TAURI_SIGNING_PRIVATE_KEY=%USERPROFILE%\.tauri\lightrain-updater.key
npm run tauri build
```

产物在 `src-tauri/target/release/bundle/nsis/`，会多出 `.nsis.zip` 和 `.sig`。
把 `latest.json` 和这两个文件放到任意 HTTPS 地址，在设置里填该地址即可测试整条链路。

## 已知限制

- 仅支持 Windows（大量 Win32 调用）。
- 「最近打开」依赖 Windows 自身的最近使用记录，某些程序（如部分 UWP 应用、绿色软件）不会写入。
- 程序索引只覆盖开始菜单快捷方式，Microsoft Store（UWP）应用暂未纳入。
- 暂不支持全盘文件搜索（搜索范围是本程序记录过的文件 + 开始菜单程序）。
- 前台文件识别靠窗口标题推断，标题里不含文件名的程序无法识别，会给出提示让你手动搜索。
