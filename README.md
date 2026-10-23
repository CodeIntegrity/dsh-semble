# dsh-semble

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that exposes
[Semble](https://github.com/MinishLab/semble) (agent code search) to every DSH session as native
MCP tools.

## What it does

Installs one MCP connection row (`@deepseek-ai/dsh-mcp-client`) configured to start the official
Semble MCP server over stdio:

```
uvx --from "semble[mcp]" semble
```

The agent then gets two tools:

- `mcp__semble__search` — semantic + lexical code search over a repo path or git URL.
- `mcp__semble__find_related` — find chunks similar to a known file/line.

Semble itself is **not vendored**: the plugin only declares how to launch it from PyPI, so nearly
all upstream updates (bugfixes, new tools) flow through automatically.

## Requirements

- [uv](https://docs.astral.sh/uv/) on PATH (`uvx` is used to bootstrap Semble).
- First start downloads the package from PyPI and the embedding model from
  HuggingFace (~1-2 min, one-time; offline afterwards).

## Configuration

Edit the `semble-mcp` row in the DSH plugin settings page:

- **Content types**: append `--content all` (or `docs` / `config`) to `args` to change what gets indexed.
- **Pin a version**: change `--from "semble[mcp]"` to `--from "semble[mcp]==X.Y.Z"` for stability.
- **Environment**: add `env` entries such as `SEMBLE_MODEL_NAME` (custom model path), `SEMBLE_MAX_FILE_BYTES`,
  `SEMBLE_INDEX_WORKERS`, `SEMBLE_CACHE_LOCATION`.

Config changes restart the connection; disk index caches survive.

## Install

In any DSH session with this workspace:

```
plugin_manager action=install_bundle target=D:\Workspace\dsh-semble
```

## Update policy

Default spec is floating (`semble[mcp]`) so releases follow the upstream repository automatically.
Only breaking changes to the CLI surface (arg/env renames) require editing `cordis.patch.yml` here.
