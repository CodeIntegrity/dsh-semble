# dsh-semble

[![npm](https://img.shields.io/npm/v/dsh-semble.svg)](https://www.npmjs.com/package/dsh-semble)

[English](README.md) | 简体中文

`dsh-semble` 把 [Semble](https://github.com/MinishLab/semble) ——一个专为 agent 打造的代码检索引擎
——接进 DSH 会话，以两个原生 MCP 工具的形式出现：`search` 与 `find_related`。`grep` 要求你手里已经
有一个字符串；它要的是一句行为描述——「请求失败时重试策略在哪生效」「哪个模块决定了打分权重」。
而这种时刻，agent 通常正好开始猜文件名。而且它只返回命中的片段而不是整个文件，单次检索的 token
开销远低于「先 grep 再整读文件」的路径——按上游 benchmark，比 grep+read 平均省约 99% 的 token，
检索质量与代码专用的 transformer 检索模型持平。

**怎么实现的。** Semble 先用 tree-sitter 把每个文件切成代码感知的分块，检索时叠加两套互补信号：
静态 Model2Vec 嵌入（代码专用模型 `potion-code-16M-v2`）负责语义相似度，BM25 负责标识符与 API 名
的词法命中；两份结果用 Reciprocal Rank Fusion（RRF）融合，再按代码感知的规则重排——定义了查询符号
的分块排在只提到它的前面，查询词在分块内以标识符词干出现（`parse config` → `parseConfig` /
`config_parser`）会被加分，同一文件多个分块命中会提升整个文件，而测试文件、示例与兼容垫片被降权，
让正式的实现先冒出来。嵌入模型是静态的，查询时没有 transformer 前向计算，所以给普通仓库建索引
不到一秒、每次查询只需毫秒，全程 CPU，不需要 API key、GPU 或外部服务。索引首次使用时写入磁盘缓存，
之后随文件改动增量刷新；`https://` 仓库按需 clone 进同一份缓存。

**开始前须知。** 本插件运行时依赖 PATH 上的 `uvx`；首次启动需要联网——它会从 PyPI 安装
`semble[mcp]`，再从 huggingface.co 下载 `potion-code-16M-v2` 模型，之后索引与查询都在本地完成。
无法访问 huggingface.co 的内网环境，请先把 `HF_ENDPOINT` 指向可用的镜像站。

## 你会得到什么

| 工具 | 交给它 | 拿回来 |
| --- | --- | --- |
| `mcp__semble__search` | 一句话描述代码做什么、或者它在哪儿 | 按相关度排序的 `file:line` 命中 + 片段 |
| `mcp__semble__find_related` | 一个你已经知道的位置 | 它的邻居：其他实现、调用方、测试 |

另外还注册了一个 slash command：`/semble savings` 和 `/semble file-types`，用来跑 MCP 没有暴露的
两个 CLI 报表，见[命令](#命令)。

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

钉住版本写 `dsh-semble@2.1.0`。`desktop` profile 只支持从设置页安装——CLI 会拒绝，
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
| `toolCallTimeoutMs` | `300000` | 首次调用要建索引并下载模型；想更快失败就调小 |
| `cwd` | 继承 | 保持不设；每次调用的 `repo` 用绝对路径 |
| `command` | `uvx` | 如果只装了 `.cmd` 包装，改指向 `uvx.exe` |

改设置会重启 MCP 连接；磁盘上的索引缓存不受影响。

## 调优

Semble 从**运行它的进程**的环境变量读配置。MCP server 的变量写在 `semble-mcp` 行的 `env` 里。
`/semble` 是另起进程、继承宿主环境，所以要让报表和检索看到同一份配置时，两处都要设——真正会出问题的
只有 `SEMBLE_CACHE_LOCATION`。

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `SEMBLE_INDEX_WORKERS` | `4` | 首次建索引时切块用的工作进程数；`0` 表示在主进程里做。多核机器可调大，不想让后台检索吃满 CPU 就调小 |
| `SEMBLE_MCP_IDLE_TIMEOUT` | `0`（永不过期） | 空闲索引在内存缓存里保留多少秒；配合 10 个索引的上限，设 `1800` 可以释放已经不看的仓库 |
| `SEMBLE_MODEL_NAME` | `minishlab/potion-code-16M-v2` | 换一个 Model2Vec 嵌入模型：本地路径或 Hugging Face 仓库 |
| `SEMBLE_MAX_FILE_BYTES` | `1000000` | 超过这个大小的文件跳过；生成代码也想进索引就调大 |
| `SEMBLE_CLONE_TIMEOUT` | `60` | clone `https://` 仓库的超时秒数 |
| `HF_ENDPOINT` | `https://huggingface.co` | 一次性模型下载走的镜像 |

### 排除文件

索引器认 `.gitignore`，另外认仓库根目录的 `.sembleignore`，用来排除「git 要留、但检索不该看」的文件：
生成的客户端、fixtures、vendored 目录。语法同 gitignore，支持取反：

```gitignore
# .sembleignore
packages/client/generated/
test/fixtures/
*.min.js
!*.proto          # 把被 .gitignore 排除的文件强行拉回索引
```

只对某一个仓库成立的规则就留在那个仓库的 `.sembleignore` 里，别塞进插件设置。

### 检索多个仓库

`repo` 接受数组，所以一次调用就能把服务端和它依赖的公共库放在一起比：

```json
{ "query": "重试策略在哪儿生效", "repo": ["D:\\work\\service", "D:\\work\\shared"] }
```

git 地址同理，首次会 clone 进缓存。每个仓库各有一份索引；传数组时，每个仓库各付一次首次建索引的成本。

## 命令

MCP 只暴露 `search` 与 `find_related`；Semble 的两个报表子命令只存在于 CLI。bundle 为它们注册了
`/semble`：

| 命令 | 输出 |
| --- | --- |
| `/semble savings` | 用片段代替整文件省下的 token，按时间区间和调用类型分列 |
| `/semble file-types` | Semble 会索引的扩展名，按内容类型分组的 JSON |

两者都在宿主进程里跑：不进模型、不弹审批，输出就是 CLI 原文（已关闭颜色）。用的是同一份
`uvx --from "semble[mcp]" semble` 安装，所以 MCP server 能用的地方它就能用。

`savings` 读的是 MCP server 写的缓存，因此只统计同一个 `SEMBLE_CACHE_LOCATION` 下的检索。要看全量汇总
或做维护，回终端：

```sh
uvx --from "semble[mcp]" semble savings        # 同一份报表，在 shell 里看
uvx --from "semble[mcp]" semble clear          # 清缓存
uvx --from "semble[mcp]" semble clear index    # 强制重建索引
```

`/semble` 故意不做检索捷径——那是 MCP 工具的事；也故意不带破坏性子命令，因为 slash command 没法弹确认。
只敲 `/semble` 会显示用法。

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

`/semble-code-search` 注入的是**说明**：真正的检索仍然走 MCP 工具。可执行的命令是 `/semble`
（见[命令](#命令)），它在宿主里跑 CLI 报表，不花模型 token。

正文不进系统提示词。只想保留工具、不要 skill，删掉 `lib/index.js` 里的 `ctx.skills.register(...)`
代码块即可；`/semble` 是单独注册的，不受影响。

## bundle 装配

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
dsh plugin --profile web add dsh-semble@2.1.0
```

源码安装则换 ref 重跑，例如
`dsh plugin --profile web add github:CodeIntegrity/dsh-semble#v2.1.0`。

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
| 首次检索报 `toolCallTimeoutMs` 超时 | 建索引 + 下载模型超过了上限 | 调大 `toolCallTimeoutMs`，或先用 CLI 检索热身 |
| 大改之后检索结果偏旧 | 磁盘索引复用了「自认为没变」的文件 | `uvx --from "semble[mcp]" semble clear index` 后再检索 |
| `/semble` 答「Could not start the Semble CLI」 | 宿主 PATH 上没有 `uvx` | 装 uv，重启 DSH |
| `savings` 统计的调用次数偏少 | 报表读的是 MCP 行 `env` 里的缓存位置，`/semble` 不会继承 | 在宿主环境里也设一次 `SEMBLE_CACHE_LOCATION` |
| 安装时报 `ERR_PNPM_GIT_RESOLVE_FAILED` | 到 github.com 没有网络通路 | 改用 tarball 链接或镜像 |

## 开发

```sh
git clone https://github.com/CodeIntegrity/dsh-semble
dsh plugin --profile web add link:$(pwd)   # 之后改代码、重启 DSH
```

没有构建步骤：`lib/` 是纯 ESM，`cordis.patch.yml` 直接读取。唯一运行时依赖是 `uv`。

`npm test` 用 Node 自带的 test runner 跑测试。涉及子进程的用例用 Node 可执行文件代替 `uvx`，
所以不会下载 Semble，也不会碰你的缓存。

## 发布

发版由 tag 驱动，见 `.github/workflows/publish.yml`：

```sh
npm version minor          # 改 package.json 并打 vX.Y.Z tag
git push origin main --follow-tags
```

工作流会先跑测试，tag 与 `package.json` 不一致时直接失败，版本已在 registry 上则跳过发布，最后带 npm
provenance 发布。需要配一个仓库 secret：

| Secret | 内容 |
| --- | --- |
| `NPM_TOKEN` | npm 细粒度访问令牌，对 `dsh-semble` 有读写权限，并为自动化开启 2FA bypass |

provenance 要求仓库公开；私有仓库请在发布步骤去掉 `--provenance`。手动触发（`workflow_dispatch`）
默认发布当前 `package.json` 版本；勾上 *dry_run* 只跑 `npm pack --dry-run`。

## 许可

MIT
