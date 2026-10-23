# dsh-semble

> Semantic code search for DeepSeek Harness.
>
> Ask **where** something lives instead of recalling **what** it is called, and the agent finds the
> file, reads it, then edits.

English | [简体中文](README.zh-CN.md)

`dsh-semble` brings [Semble](https://github.com/MinishLab/semble)'s code index into every DSH
session as two native MCP tools. `grep` needs a string you already know; this needs a description of
behaviour — "where is the retry policy applied when a request fails", "which module decides the
scoring weights". That is usually the moment an agent starts guessing file names.

Nothing to learn beyond that: after installation the tools sit next to `read` and `grep`, and the
agent decides when the index is worth a call.

## What you get

| Tool | Hand it | Back comes |
| --- | --- | --- |
| `mcp__semble__search` | a sentence describing the code or where it lives | ranked `file:line` hits with snippets |
| `mcp__semble__find_related` | one location you already know | its neighbours: other implementations, callers, tests |

A typical exchange:

> **You:** Where does DSH decide that a plugin is "loaded"?
>
> **Agent:** calls `search`, gets a hit in the plugin inventory, opens it with `read`, finds
> `isEntryLoaded` comparing loader entry names against the package name, and answers from the source
> rather than from a guess.

## Using the tools

- `repo` — **required**. Absolute path of the repository, or an `https://` git URL. A list searches
  several repositories at once.
- `top_k` — default 5. Raise to 10–20 when the first pass misses.
- `max_snippet_lines` — default 10; `0` returns locations only.
- `content` — `code` (default), `docs`, `config`, or `all`.

The first query against a repository builds its index (slow, one-time); later queries reuse it.
Hits are ranked by similarity, so a score near `0.0x` usually means "nothing relevant here" rather
than "the best answer".

## Install

### Desktop app

**Settings → Plugins → Install**, and paste:

```
github:CodeIntegrity/dsh-semble
```

Pin a release instead of tracking `main` with `#v1.1.2`. The settings page is the only supported
route for the `desktop` profile — the CLI refuses it because the Electron app owns that profile's
`node_modules` and lockfile.

### CLI

```sh
dsh plugin --profile web add github:CodeIntegrity/dsh-semble
```

The subcommand runs `pnpm add` inside the profile and reconciles `dsh.profile.bundles`, so the bundle
mounts on the next start. `github:owner/repo`, `git+https://…`, `https://github.com/owner/repo` and
`.tgz` URLs are accepted. Requires `git` on PATH; there is no build step, so pnpm needs no
`allowBuilds` exemption.

### Local checkout

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-semble   # macOS / Linux
dsh plugin --profile web add link:D:\path\to\dsh-semble          # Windows
```

The profile then points at your working copy, so edits to `cordis.patch.yml` apply on the next start
without reinstalling.

### Prerequisites

[uv](https://docs.astral.sh/uv/) must be on PATH — `uvx` launches Semble from PyPI:

```powershell
winget install astral-sh.uv                      # Windows
```

```sh
brew install uv                                  # macOS
curl -LsSf https://astral.sh/uv/install.sh | sh  # macOS / Linux
```

First start downloads the package and the embedding model (~1–2 min, one-time, offline afterwards).
Restart DSH once after installing; until then the settings row may read 待重启.

## Settings

Edit the `semble-mcp` row in **Settings → Plugins**:

| Field | Default | Why change it |
| --- | --- | --- |
| `args` | `--from 'semble[mcp]' semble` | append `--content all` to index docs and config too |
| `args` (version) | floating | `semble[mcp]==X.Y.Z` pins a release |
| `env` | empty | `HF_ENDPOINT` on restricted networks, `SEMBLE_CACHE_LOCATION` to move the index |
| `cwd` | inherited | keep unset; per-call `repo` values should be absolute paths |
| `command` | `uvx` | point it at `uvx.exe` if only a `.cmd` shim is installed |

Changing settings restarts the MCP connection; disk index caches survive.

## Platform notes

The bundle ships no OS-specific path and no region-specific endpoint, so one installation serves all
three platforms. What differs is only what you type:

| Concern | Windows | macOS / Linux |
| --- | --- | --- |
| Executable | `uvx.exe`, resolved through PATH | `uvx` |
| Repository paths | `D:\work\repo` | `/home/me/repo` |
| Profile home | `C:\Users\<you>\.dsh` | `~/.dsh` |
| Retrieved paths | keep `\` separators | POSIX `/` |

## Bundled skill

Installation also registers one routing skill, `semble-code-search`. The tools do not advertise
*when* they are worth calling, and a model that reaches for `grep` first never learns that the index
existed.

DSH loads skills lazily:

| When | Enters the session | Cost |
| --- | --- | --- |
| Before the first request | one catalog entry (name + capped description) | a few hundred bytes per session |
| Model calls `skill` | the full `skills/semble/SKILL.md` body | ~2 KB, only when used |
| You type `/semble-code-search` | same body, injected into that step | manual |

The body never enters the system prompt. To keep the tools and drop the skill, delete the
`ctx.skills.register(...)` call in `lib/index.js`.

## How it works

The bundle inserts two loader rows:

1. `semble-mcp-anchor` — a no-op plugin loaded under this package's own name. DSH decides "loaded"
   by matching loader entry names against the installed package name, and the MCP client row loads
   under `@deepseek-ai/dsh-mcp-client`; without the anchor the settings row reads 未加载 / 待重启
   while the tools work fine.
2. `semble-mcp` — the official `@deepseek-ai/dsh-mcp-client` row, configured to start
   `uvx --from "semble[mcp]" semble` over stdio.

Semble itself is **not vendored**. The plugin declares how to launch it from PyPI with a floating
spec, so upstream bugfixes and new tools arrive on the next server start; only a breaking change to
the CLI surface would need an edit here.

## Update

Re-run the install with a newer ref, or press 更新 in settings:

```sh
dsh plugin --profile web add github:CodeIntegrity/dsh-semble#v1.1.2
```

## Uninstall

**Settings → Plugins → 卸载**, or:

```sh
dsh plugin --profile web remove @local/semble-mcp
```

The cached index and the HuggingFace model stay on disk and are reused after a reinstall.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Row reads 待重启 after install | the host loaded its layer list before the install | restart DSH once |
| Tools work, row reads 未加载 | `cordis.patch.yml` lost the anchor row | reinstall this version or newer |
| `mcp__semble__*` never appears | `uvx` missing, or the first download failed | run `uvx --from "semble[mcp]" semble --version` and read the error |
| First search takes minutes | one-time model download | wait, or set `HF_ENDPOINT` |
| `ERR_PNPM_GIT_RESOLVE_FAILED` | no network route to github.com | use a tarball URL or a mirror |

## Development

```sh
git clone https://github.com/CodeIntegrity/dsh-semble
dsh plugin --profile web add link:$(pwd)   # then edit and restart DSH
```

No build step: `lib/index.js` is plain ESM and `cordis.patch.yml` is read directly. The only runtime
dependency is `uv`.

## License

MIT
