# dsh-semble

[![npm](https://img.shields.io/npm/v/dsh-semble.svg)](https://www.npmjs.com/package/dsh-semble)

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

The bundle also registers one slash command, `/semble`, for the two reporting subcommands that MCP
does not expose: `/semble savings` and `/semble file-types`. See [Commands](#commands).

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
dsh-semble
```

Pin a version with `dsh-semble@2.1.0`. The settings page is the only supported route for the
`desktop` profile — the CLI refuses it because the Electron app owns that profile's `node_modules`
and lockfile.

### CLI

```sh
dsh plugin --profile web add dsh-semble
```

The subcommand runs `pnpm add` inside the profile and reconciles `dsh.profile.bundles`, so the bundle
mounts on the next start. There is no build step, so pnpm needs no `allowBuilds` exemption.

### From source

To track `main`, a fork, or an unreleased commit, install from the repository instead:

```sh
dsh plugin --profile web add github:CodeIntegrity/dsh-semble
```

`github:owner/repo`, `git+https://…`, `https://github.com/owner/repo` and `.tgz` URLs are accepted;
these need `git` on PATH.

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
| `toolCallTimeoutMs` | `300000` | the first call builds the index and downloads the model; lower it to fail faster |
| `cwd` | inherited | keep unset; per-call `repo` values should be absolute paths |
| `command` | `uvx` | point it at `uvx.exe` if only a `.cmd` shim is installed |

Changing settings restarts the MCP connection; disk index caches survive.

## Tuning

Semble reads its configuration from the environment of the process that runs it. For the MCP server,
put these in the `env` field of the `semble-mcp` row. `/semble` spawns a separate process and inherits
the host environment instead, so export a value in both places when a report must agree with search —
`SEMBLE_CACHE_LOCATION` is the one that matters.

| Variable | Default | Effect |
| --- | --- | --- |
| `SEMBLE_INDEX_WORKERS` | `4` | worker processes that chunk a repository during the first index; `0` chunks in-process. Raise it on a many-core machine, lower it to stop a background search from saturating the CPU |
| `SEMBLE_MCP_IDLE_TIMEOUT` | `0` (never) | seconds an idle repository index stays in the in-memory cache; with the 10-index cap, `1800` releases repositories you have moved on from |
| `SEMBLE_MODEL_NAME` | `minishlab/potion-code-16M-v2` | alternative Model2Vec embedding model, as a local path or a Hugging Face repository |
| `SEMBLE_MAX_FILE_BYTES` | `1000000` | files above this size are skipped; raise it for generated code worth indexing |
| `SEMBLE_CLONE_TIMEOUT` | `60` | seconds allowed for cloning an `https://` repository |
| `HF_ENDPOINT` | `https://huggingface.co` | mirror used for the one-time model download |

### Excluding files

The indexer honours `.gitignore`, plus a `.sembleignore` at the repository root for files git keeps but
search should skip: generated clients, fixtures, vendored trees. The syntax is gitignore's, negation
included:

```gitignore
# .sembleignore
packages/client/generated/
test/fixtures/
*.min.js
!*.proto          # force-include a file .gitignore excludes
```

A pattern that only ever needs one repository should stay in that repository's `.sembleignore`; keep
the plugin settings free of per-repository rules.

### Several repositories

`repo` accepts a list, so one call can compare a service with the shared library it depends on:

```json
{ "query": "where is the retry policy applied", "repo": ["D:\\work\\service", "D:\\work\\shared"] }
```

Git URLs work the same way and are cloned once into the cache. Each repository gets its own index; a
list costs one first-time index build per repository.

## Commands

MCP exposes `search` and `find_related`; Semble's two reporting subcommands only exist in its CLI. The
bundle registers `/semble` for them:

| Command | Prints |
| --- | --- |
| `/semble savings` | tokens saved by returning snippets instead of whole files, per period and per call type |
| `/semble file-types` | the extensions Semble indexes, as JSON grouped by content type |

Both run in the host process: nothing is sent to the model, no approval prompt appears, and the output
is the CLI's own (colour disabled). The same `uvx --from "semble[mcp]" semble` installation is used, so
`/semble` works exactly where the MCP server works.

`savings` reads the cache that the MCP server wrote, so it only counts searches made against the same
`SEMBLE_CACHE_LOCATION`. To see a summary of everything, and for maintenance, stay in a terminal:

```sh
uvx --from "semble[mcp]" semble savings        # same report, from a shell
uvx --from "semble[mcp]" semble clear          # drop caches
uvx --from "semble[mcp]" semble clear index    # force a rebuild
```

`/semble` is deliberately not a search shortcut — that is what the MCP tools are for — and it has no
destructive subcommands, because a slash command cannot ask for confirmation. Type `/semble` alone for
the usage line.

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

`/semble-code-search` loads *instructions*: the search itself still runs through the MCP tools. The
real executable command is `/semble` (see [Commands](#commands)), which runs a CLI report in the host
and costs no model tokens.

The body never enters the system prompt. To keep the tools and drop the skill, delete the
`ctx.skills.register(...)` block in `lib/index.js`; `/semble` keeps working because it is registered
separately.

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

Re-run the install with a newer version, or press 更新 in settings:

```sh
dsh plugin --profile web add dsh-semble@2.1.0
```

Source installs re-run with the new ref, e.g.
`dsh plugin --profile web add github:CodeIntegrity/dsh-semble#v2.1.0`.

## Uninstall

**Settings → Plugins → 卸载**, or:

```sh
dsh plugin --profile web remove dsh-semble
```

Installed the 1.x source build? Remove it by its old name first:
`dsh plugin --profile web remove @local/semble-mcp`. The package was renamed in 2.0.0, and the anchor
row only matches an install whose package name is `dsh-semble`.

The cached index and the HuggingFace model stay on disk and are reused after a reinstall.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Row reads 待重启 after install | the host loaded its layer list before the install | restart DSH once |
| Tools work, row reads 未加载 | `cordis.patch.yml` lost the anchor row | reinstall this version or newer |
| `mcp__semble__*` never appears | `uvx` missing, or the first download failed | run `uvx --from "semble[mcp]" semble --version` and read the error |
| First search takes minutes | one-time model download | wait, or set `HF_ENDPOINT` |
| First search fails on `toolCallTimeoutMs` | index build + model download outran the limit | raise `toolCallTimeoutMs`, or warm the cache once with a CLI search |
| Search looks stale after a large refactor | the disk index reuses files it believes unchanged | `uvx --from "semble[mcp]" semble clear index`, then search again |
| `/semble` answers "Could not start the Semble CLI" | `uvx` is not on the host's PATH | install uv, restart DSH |
| `savings` counts fewer calls than you made | the report reads the cache of the MCP row's `env`, which `/semble` does not inherit | set `SEMBLE_CACHE_LOCATION` in the host environment as well |
| `ERR_PNPM_GIT_RESOLVE_FAILED` | no network route to github.com | use a tarball URL or a mirror |

## Development

```sh
git clone https://github.com/CodeIntegrity/dsh-semble
dsh plugin --profile web add link:$(pwd)   # then edit and restart DSH
```

No build step: `lib/` is plain ESM and `cordis.patch.yml` is read directly. The only runtime
dependency is `uv`.

`npm test` runs the suite with Node's built-in runner. The spawn tests replace `uvx` with the Node
binary, so they neither download Semble nor touch your cache.

## License

MIT
