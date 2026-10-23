# dsh-semble

[![npm](https://img.shields.io/npm/v/dsh-semble.svg)](https://www.npmjs.com/package/dsh-semble)

> 给 DeepSeek Harness 的语义代码检索。
>
> 你只需要问「这东西在哪」，不必先想起它叫什么——agent 自己找到文件、读它、再改。

[English](README.md) | 简体中文

`dsh-semble` 把 [Semble](https://github.com/MinishLab/semble) 的代码索引接进每个 DSH 会话，
以两个原生 MCP 工具的形式出现。`grep` 要求你手里已经有一个字符串；它要的是一句行为描述——
「请求失败时重试策略在哪生效」「哪个模块决定了打分权重」。而这种时刻，agent 通常正好开始猜文件名。

除此之外没有要学的东西：装好之后两个工具就摆在 `read`、`grep` 旁边，由 agent 决定什么时候值得查一次索引。

## 你会得到什么

| 工具 | 交给它 | 拿回来 |
| --- | --- | --- |
| `mcp__semble__search` | 一句话描述代码做什么、或者它在哪儿 | 按相关度排序的 `file:line` 命中 + 片段 |
| `mcp__semble__find_related` | 一个你已经知道的位置 | 它的邻居：其他实现、调用方、测试 |

一次典型对话：

> **你：** DSH 判断「插件已加载」是在哪儿决定的？
>
> **agent：** 调 `search`，拿到插件清单模块的一条命中，用 `read` 打开，找到 `isEntryLoaded`
> 把 loader 条目名和包名做比对，然后**基于源码**回答，而不是基于猜测。

## 工具怎么用

- `repo` —— **必填**。仓库绝对路径，或 `https://` git 地址；传数组可同时检索多个仓库。
- `top_k` —— 默认 5，首轮没命中时提到 10–20。
- `max_snippet_lines` —— 默认 10，`0` 只返回位置。
- `content` —— `code`（默认）、`docs`、`config`、`all`。

某个仓库的首次查询要建索引（慢，一次性），之后复用。命中按相似度排序，所以分数接近 `0.0x`
通常意味着「这儿没有相关内容」，而不是「这是最佳答案」。

## 安装

### 桌面端

**设置 → 插件 → 安装**，粘贴：

```
dsh-semble
```

钉住版本写 `dsh-semble@2.0.0`。`desktop` profile 只支持从设置页安装——CLI 会拒绝，
因为这个 profile 的 `node_modules` 与 lockfile 由 Electron 应用独占。

### 命令行

```sh
dsh plugin --profile web add dsh-semble
```

该子命令在 profile 目录里跑 `pnpm add`，随后 reconcile `dsh.profile.bundles`，所以下次启动即挂载。
没有构建步骤，pnpm 不需要 `allowBuilds` 例外。

### 从源码安装

要跟 `main`、装某个 fork 或装还没发版的提交，走仓库安装：

```sh
dsh plugin --profile web add github:CodeIntegrity/dsh-semble
```

支持 `github:owner/repo`、`git+https://…`、`https://github.com/owner/repo` 和 `.tgz` 链接；
这些需要 PATH 上有 `git`。

### 本地目录

```sh
dsh plugin --profile web add link:/绝对路径/dsh-semble   # macOS / Linux
dsh plugin --profile web add link:D:\path\to\dsh-semble  # Windows
```

之后 profile 指向你的工作副本，改完 `cordis.patch.yml` 下次启动即生效，无需重装。

### 前置条件

PATH 上要有 [uv](https://docs.astral.sh/uv/)——`uvx` 负责从 PyPI 拉起 Semble：

```powershell
winget install astral-sh.uv                      # Windows
```

```sh
brew install uv                                  # macOS
curl -LsSf https://astral.sh/uv/install.sh | sh  # macOS / Linux
```

首次启动会下载包与嵌入模型（约 1–2 分钟，一次性，之后离线可用）。装完重启一次 DSH；在那之前设置页那行
可能显示「待重启」。

## 设置

在 **设置 → 插件** 里编辑 `semble-mcp` 行：

| 字段 | 默认值 | 什么时候改 |
| --- | --- | --- |
| `args` | `--from 'semble[mcp]' semble` | 追加 `--content all` 让文档和配置也进索引 |
| `args`（版本） | 浮动 | 改成 `semble[mcp]==X.Y.Z` 钉版本 |
| `env` | 空 | 受限网络加 `HF_ENDPOINT`；搬索引加 `SEMBLE_CACHE_LOCATION` |
| `cwd` | 继承 | 保持不设；每次调用的 `repo` 用绝对路径 |
| `command` | `uvx` | 如果只装了 `.cmd` 包装，改指向 `uvx.exe` |

改设置会重启 MCP 连接；磁盘上的索引缓存不受影响。

## 平台差异

bundle 不含任何 OS 专属路径、也不含区域专属 endpoint，一份安装三平台通用。真正不同的只有你敲进去的东西：

| 关注点 | Windows | macOS / Linux |
| --- | --- | --- |
| 可执行文件 | `uvx.exe`，经 PATH 解析 | `uvx` |
| 仓库路径 | `D:\work\repo` | `/home/me/repo` |
| profile 目录 | `C:\Users\<你>\.dsh` | `~/.dsh` |
| 命中路径分隔符 | 保留 `\` | POSIX `/` |

## 内置 skill

安装同时注册一个路由 skill：`semble-code-search`。工具本身不会说明「什么时候值得用」，而先摸
`grep` 的模型永远不会发现索引的存在。

DSH 的 skill 惰性加载：

| 时机 | 进入会话的内容 | 成本 |
| --- | --- | --- |
| 首次请求前 | 一条目录条目（名称 + 截断描述） | 每会话几百字节 |
| 模型调 `skill` | 完整 `skills/semble/SKILL.md` 正文 | 约 2 KB，只在实际用到时 |
| 你输入 `/semble-code-search` | 同一份正文，注入当步 | 手动 |

正文不进系统提示词。只想保留工具、不要 skill，删掉 `lib/index.js` 里的 `ctx.skills.register(...)`
调用即可。

## 工作原理

bundle 插入两行 loader：

1. `semble-mcp-anchor` —— 以本包名加载的空插件。DSH 判断「已加载」是拿 loader 条目名和已安装包名做匹配，
   而 MCP 客户端那行是以 `@deepseek-ai/dsh-mcp-client` 加载的；没有这个锚点，明明工具能用，设置页却显示
   未加载 / 待重启。
2. `semble-mcp` —— 官方 `@deepseek-ai/dsh-mcp-client` 行，配置为通过 stdio 启动
   `uvx --from "semble[mcp]" semble`。

Semble 本体**不做 vendored 内嵌**。插件只声明如何从 PyPI 拉起它，且用浮动版本号，所以上游的 bugfix
与新工具在下次 server 启动时生效；只有 CLI 表面发生破坏性变更时才需要改这里。

## 更新

用更新的版本重跑安装，或在设置页点「更新」：

```sh
dsh plugin --profile web add dsh-semble@2.0.0
```

源码安装则换 ref 重跑，例如
`dsh plugin --profile web add github:CodeIntegrity/dsh-semble#v2.0.0`。

## 卸载

**设置 → 插件 → 卸载**，或：

```sh
dsh plugin --profile web remove dsh-semble
```

装过 1.x 源码版的话，先按旧名卸载：`dsh plugin --profile web remove @local/semble-mcp`。
2.0.0 起改了包名，而锚点行只认包名为 `dsh-semble` 的安装。

已缓存的索引与 HuggingFace 模型留在磁盘上，重装可复用。

## 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 装完显示「待重启」 | 宿主在安装前已经加载了层列表 | 重启 DSH 一次 |
| 工具能用但显示「未加载」 | `cordis.patch.yml` 缺了锚点行 | 重装本版本或更新版本 |
| `mcp__semble__*` 一直不出现 | 缺 `uvx`，或首次下载失败 | 手动跑 `uvx --from "semble[mcp]" semble --version` 看报错 |
| 首次检索卡几分钟 | 模型一次性下载 | 等待，或设 `HF_ENDPOINT` |
| 安装时报 `ERR_PNPM_GIT_RESOLVE_FAILED` | 到 github.com 没有网络通路 | 改用 tarball 链接或镜像 |

## 开发

```sh
git clone https://github.com/CodeIntegrity/dsh-semble
dsh plugin --profile web add link:$(pwd)   # 之后改代码、重启 DSH
```

没有构建步骤：`lib/index.js` 是纯 ESM，`cordis.patch.yml` 直接读取。唯一运行时依赖是 `uv`。

## 许可

MIT
