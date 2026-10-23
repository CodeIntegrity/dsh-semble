# dsh-semble

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，把
[Semble](https://github.com/MinishLab/semble)（agent 代码检索）以原生 MCP 工具的形式接入每个
DSH 会话。

[English](README.md) | 简体中文

## 它做什么

安装一条 MCP 连接行（`@deepseek-ai/dsh-mcp-client`），配置为通过 stdio 启动官方的 Semble
MCP server：

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

在任意打开本工作区的 DSH 会话中执行：

```
plugin_manager action=install_bundle target=D:\Workspace\dsh-semble
```

## 更新策略

默认 spec 为浮动版本（`semble[mcp]`），发版自动跟随上游仓库。
只有上游 CLI 表面发生破坏性变更（参数/env 改名）时，才需要回来编辑这里的 `cordis.patch.yml`。
