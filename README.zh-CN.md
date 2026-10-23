# dsh-semble

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，把
[Semble](https://github.com/MinishLab/semble)（agent 代码检索）以原生 MCP 工具的形式接入每个
DSH 会话。

[English](README.md) | 简体中文

## 它做什么

安装两行 loader 条目：一行是挂在插件自己包名下的空壳锚点（anchor），另一行是 MCP 连接行
（`@deepseek-ai/dsh-mcp-client`），配置为通过 stdio 启动官方的 Semble MCP server。
锚点存在的原因：DSH 判定「已加载」用的是「loader 条目名 == 已安装包名」，没有它时插件在设置弹窗里
会显示「未加载 / 待重启」，而工具其实已经在工作。锚点不注册任何工具、服务或事件。

```
uvx --from "semble[mcp]" semble
```

agent 由此获得两个工具：

- `mcp__semble__search` — 对仓库路径或 git URL 做语义 + 词法混合代码检索。
- `mcp__semble__find_related` — 给定已知文件/行号，找出相似的代码块。

Semble 本身**不做 vendored 内嵌**：插件只声明如何从 PyPI 启动它，因此上游几乎所有的更新
（bugfix、新增工具）都会自动生效。

## 前置要求

- [uv](https://docs.astral.sh/uv/) 在 PATH 上（`uvx` 负责引导 Semble）。
- 首次启动会从 PyPI 下载包、从 HuggingFace 下载嵌入模型（约 1-2 分钟，一次性；之后离线可用）。
- 在 huggingface.co 不可达的网络环境下，bundle 会为 server 进程设置
  `HF_ENDPOINT=https://hf-mirror.com`；如有需要可在设置中调整。

## 配置

在 DSH 插件设置页编辑 `semble-mcp` 行：

- **内容类型**：在 `args` 末尾追加 `--content all`（或 `docs` / `config`）改变索引范围。
- **固定版本**：把 `--from "semble[mcp]"` 改成 `--from "semble[mcp]==X.Y.Z"` 以提升稳定性。
- **环境变量**：bundle 默认设置了 `HF_ENDPOINT=https://hf-mirror.com`（见前置要求）。
  可按需增加 `env` 条目，例如 `SEMBLE_MODEL_NAME`（自定义模型路径）、`SEMBLE_MAX_FILE_BYTES`、
  `SEMBLE_INDEX_WORKERS`、`SEMBLE_CACHE_LOCATION`。

配置变更会重启连接；磁盘索引缓存不受影响。

## 安装

插件是纯 bundle：安装它 = 把包加进某个 DSH profile，DSH 随后加载 `cordis.patch.yml` 并挂载 MCP
连接。按你的环境选一种方式。

### 桌面端（设置 → 插件 → 安装）

在安装框里粘贴仓库 spec：

```
github:CodeIntegrity/dsh-semble
```

想钉住某个发布版本、不跟 `main`：

```
github:CodeIntegrity/dsh-semble#v1.0.0
```

`desktop` profile 只支持从设置页安装——CLI 会拒绝，因为这个 profile 的 `node_modules` 与
lockfile 由 Electron 应用独占管理。

### 命令行（非桌面 profile：`web`、`tui` …）

```
dsh plugin --profile web add github:CodeIntegrity/dsh-semble
```

该子命令会把参数转发给 profile 目录里的 `pnpm add`，随后 reconcile `dsh.profile.bundles`，
所以下次启动就会挂载。支持 `github:owner/repo`、`git+https://…`、`https://github.com/owner/repo`
以及 `.tgz` 链接。

### 本地目录（开发用）

让 profile 指向当前目录而不是 git ref：

```
dsh plugin --profile web add link:/绝对路径/dsh-semble
```

或在打开本工作区的 DSH 会话里执行：

```
plugin_manager action=install_bundle target=D:\Workspace\dsh-semble
```

`link:` 形式让 profile 始终指向你的工作副本，改完 `cordis.patch.yml` 下次启动即生效，无需重装。

### git 安装的前置条件

- PATH 上有 `git`，且能访问仓库所在主机。
- 没有构建步骤：本包没有 `prepare` 脚本，pnpm 不需要 `allowBuilds` 白名单。
- `uv` 仍是**运行时**依赖（见前置要求）——安装插件不会顺带装它。

首次安装后重启 DSH。重启前设置弹窗可能显示「待重启」：该标记只存在于宿主内存，下次启动即清空。

## 更新

用更新的 ref 重跑一次安装（或在设置页点「更新」）：

```
dsh plugin --profile web add github:CodeIntegrity/dsh-semble#v1.1.0
```

`link:` 安装则 `git pull` 后重启 DSH。Semble 自身的更新是另一条路径，且自动跟随——见更新策略。

## 卸载

设置 → 插件 → 卸载，或：

```
dsh plugin --profile web remove @local/semble-mcp
```

卸载会同时移除依赖与 `dsh.profile.bundles` 条目；已缓存的 Semble 索引与 HuggingFace 模型留在磁盘上，
重装可复用。

## 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 装完显示「待重启」 | 宿主在安装前已经加载了层列表 | 重启 DSH 一次 |
| 工具能用但显示「未加载」 | `cordis.patch.yml` 缺了锚点行（见「它做什么」） | 重装本版本或更新版本 |
| `mcp__semble__*` 一直不出现 | 缺 `uvx`，或首次 PyPI/模型下载失败 | 手动跑 `uvx --from "semble[mcp]" semble --version` 看报错 |
| 首次检索卡几分钟 | 嵌入模型一次性下载 | 等待，或把 `HF_ENDPOINT` 指向可达镜像 |
| 安装时报 `ERR_PNPM_GIT_RESOLVE_FAILED` | 到 github.com 没有网络通路 | 改用 tarball 链接或 npm 镜像 |

## 内置 skill

安装本 bundle 会同时注册一个路由 skill：`semble-code-search`。它的存在理由是：工具本身不会说明「什么时候值得用它」——模型先摸 `grep` 的话，根本不会发现索引能替它做什么。

DSH 的 skill 是惰性加载的，成本结构如下：

| 时机 | 进入会话的内容 | 体量 |
| --- | --- | --- |
| 首次请求前 | 一条目录条目：名称 + 截断后的描述 | 每会话几百字节 |
| 模型调 `skill` 工具时 | 完整 `skills/semble/SKILL.md` 正文 | 约 2 KB，且只在实际用到时 |
| 用户输入 `/semble-code-search` | 同一份正文，注入当步 | 手动触发 |

正文**不会**进系统提示词。这是刻意设计：常驻在 system prompt 里的正文，每个会话都要重复付全量 token，不管这次用没用到工具。

只想保留工具、不要 skill，删掉 `lib/index.js` 里的 `ctx.skills.register(...)` 调用即可。正文文件在 `skills/semble/SKILL.md`，也可以手工放到 `~/.dsh/skills/semble/SKILL.md` 交给文件系统 provider。

## 更新策略

默认 spec 为浮动版本（`semble[mcp]`），发版自动跟随上游仓库。
只有上游 CLI 表面发生破坏性变更（参数/env 改名）时，才需要回来编辑这里的 `cordis.patch.yml`。
