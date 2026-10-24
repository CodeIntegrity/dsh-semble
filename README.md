# dsh-semble

[![npm](https://img.shields.io/npm/v/dsh-semble.svg)](https://www.npmjs.com/package/dsh-semble)

English | [简体中文](README.zh-CN.md)

`dsh-semble` brings [Semble](https://github.com/MinishLab/semble) — a code search engine built for
agents — into each DSH session as two native tools: `semble_search` and `semble_find_related`. Since
3.0.0 there is no MCP layer: the plugin registers the tools directly into the host's tool registry,
and every call spawns the Semble CLI through `uvx`. `grep` needs a
string you already know; this needs a description of behaviour — "where is the retry policy applied
when a request fails", "which module decides the scoring weights". That is usually the moment an
agent starts guessing file names. And because only the matched snippets come back instead of whole
files, one query costs a fraction of the tokens of a grep-then-read detour: upstream benchmarks
measure **~99% fewer tokens** than grep+read, at retrieval quality on par with code-specialized
transformer retrievers.

Under the hood, Semble splits every file into code-aware chunks with tree-sitter, then retrieves
against two complementary signals: static **Model2Vec** embeddings (the code-specialized
`potion-code-16M-v2` model) for semantic similarity, and **BM25** for lexical matches on identifiers
and API names. The two result lists are fused with **Reciprocal Rank Fusion** (RRF), then re-ranked
by code-aware signals: a chunk that *defines* the queried symbol outranks one that merely mentions
it, query words matching identifier stems inside a chunk earn extra weight (`parse config →
parseConfig / config_parser`), several hits from the same file promote the file as a whole, and
test files, examples and compat shims are demoted so the canonical implementation surfaces first.
The embedding model is static — no transformer forward pass at query time — so indexing a typical
repo takes under a second and every query lands in milliseconds, entirely on CPU with no API key,
GPU or external service. Indexes are cached to disk on first use and refreshed incrementally as
files change; `https://` repositories are cloned on demand into the same cache.

**Before first use.** The plugin runs on `uvx`, which must be on PATH, and the first call is
online: it installs `semble[mcp]` from PyPI and downloads the `potion-code-16M-v2` model from
huggingface.co. Indexing and queries run locally once that is done; if your network cannot reach
huggingface.co, point `HF_ENDPOINT` at a mirror.

## What you get

| Tool | Hand it | Back comes |
| --- | --- | --- |
| `semble_search` | a sentence describing the code or where it lives | ranked `file:line` hits with snippets |
| `semble_find_related` | one location you already know | its neighbours: other implementations, callers, tests |

The bundle also registers one slash command, `/semble`, for the reporting subcommands the tools do
not expose: `/semble savings`, `/semble file-types` and `/semble version`. See
[Commands](#commands).

A typical exchange:

> **You:** Where does DSH decide that a plugin is "loaded"?
>
> **Agent:** calls `semble_search`, gets a hit in the plugin inventory, opens it with `read`, finds
> `isEntryLoaded` comparing loader entry names against the package name, and answers from the source
> rather than from a guess.

## Using the tools

- `repo` — **required**. Absolute path of the repository, or an `https://` git URL. A list searches
  several repositories at once.
- `top_k` — default 5. Raise to 10–20 when the first pass misses.
- `max_snippet_lines` — default 10; `0` returns locations only.
- `content` — `code` (default), `docs`, `config`, or `all`.

The first query against a repository builds its index (slow, one-time); later queries reuse it.
Hits are ranked by similarity. Search scores are rank-fusion values that stay small (`0.0x`) even
for exactly-relevant code — treat them as a relative ordering, not an absolute confidence. An
*empty* result is the real "nothing relevant here" signal.

## Install

### Desktop app

**Settings → Plugins → Install**, and paste:

```
dsh-semble
```

Pin a version with `dsh-semble@3.0.0`. The settings page is the only supported route for the
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

Edit the plugin's row in **Settings → Plugins** (the loader row's `config`, read by the plugin on
every call):

| Field | Default | Why change it |
| --- | --- | --- |
| `command` | `uvx` | point it at `uvx.exe` if only a `.cmd` shim is installed |
| `args` | `--from 'semble[mcp]' semble` | append `--content all` to index docs and config too |
| `args` (version) | floating | `semble[mcp]==X.Y.Z` pins a release |
| `toolTimeoutMs` | `300000` | the first call builds the index and downloads the model; lower it to fail faster |
| `env` | empty | `HF_ENDPOINT` on restricted networks, `SEMBLE_CACHE_LOCATION` to move the index |

Changing settings re-applies the plugin (re-registering the two tools); disk index caches survive.

## Tuning

Semble reads its configuration from the environment of the process that runs it. For the search
tools, put these in the `env` field of the plugin `config`. `/semble` spawns a separate process and
inherits the host environment instead, so export a value in both places when a report must agree
with search — `SEMBLE_CACHE_LOCATION` is the one that matters.

| Variable | Default | Effect |
| --- | --- | --- |
| `SEMBLE_INDEX_WORKERS` | `4` | worker processes that chunk a repository during the first index; `0` chunks in-process. Raise it on a many-core machine, lower it to stop a background search from saturating the CPU |
| `SEMBLE_MCP_IDLE_TIMEOUT` | `0` (never) | seconds an idle repository index stays in the in-memory cache of the MCP server mode; the CLI exits per call, so the variable has no effect on it |
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

The two tools cover retrieval only; Semble's reporting subcommands exist only in its CLI. The
bundle registers `/semble` for them:

| Command | Prints |
| --- | --- |
| `/semble savings` | tokens saved by returning snippets instead of whole files, per period and per call type |
| `/semble file-types` | the extensions Semble indexes, as JSON grouped by content type |
| `/semble version` | the Semble release the `uvx` installation resolved — the quickest install check |

All of them run in the host process: nothing is sent to the model, no approval prompt appears, and the output
is the CLI's own (colour disabled). The same `uvx --from "semble[mcp]" semble` installation is used, so
`/semble` works exactly where the search tools work.

`savings` reads the cache Semble wrote, so it only counts searches made against the same
`SEMBLE_CACHE_LOCATION`. To see a summary of everything, and for maintenance, stay in a terminal:

```sh
uvx --from "semble[mcp]" semble savings        # same report, from a shell
uvx --from "semble[mcp]" semble clear          # drop caches
uvx --from "semble[mcp]" semble clear index    # force a rebuild
```

`/semble` is deliberately not a search shortcut — that is what the two tools are for — and it has no
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

`/semble-code-search` loads *instructions*: the search itself still runs through the two native
tools. The
real executable command is `/semble` (see [Commands](#commands)), which runs a CLI report in the host
and costs no model tokens.

The body never enters the system prompt. To keep the tools and drop the skill, delete the
`ctx.skills.register(...)` block in `lib/index.js`; `/semble` keeps working because it is registered
separately.

## How it is wired

The bundle inserts one loader row: `semble-anchor` — this very plugin, loaded under its own package
name. DSH decides "loaded" by matching loader entry names against the installed package name, so the
row doubles as the plugin's entry point, and its `config` is read by the plugin to become the tools'
launcher settings (`command` / `args` / `toolTimeoutMs` / `env`).

Semble itself is **not vendored**. The plugin declares how to launch it from PyPI with a floating
spec, so upstream bugfixes and new CLI flags arrive on the next call; only a breaking change to
the CLI surface would need an edit here.

## Update

Re-run the install with a newer version, or press 更新 in settings:

```sh
dsh plugin --profile web add dsh-semble@3.0.0
```

Source installs re-run with the new ref, e.g.
`dsh plugin --profile web add github:CodeIntegrity/dsh-semble#v3.0.0`.

## Compatibility

The package follows semver. The public surface, which 3.x keeps stable:

- the two native tools `semble_search` and `semble_find_related` (their behavior tracks the
  PyPI `semble` release uvx resolves — the plugin pins nothing, see *How it is wired*);
- the plugin entry: the default export and the named `apply` from `dsh-semble`, receiving
  `(ctx, config)` — `config` is the loader row's `config`, coerced by the plugin; the context
  carries `skills` and optionally `inject`/`tools`/`commands`;
- the `/semble` subcommand allow-list (`savings`, `file-types`, `version`) and its result shape
  (`{ kind: 'success' | 'error', text }`);
- the exports `./locale/*.json`, `./icon`, and `./package.json`.

Not covered by the promise: row ids and launch details inside `cordis.patch.yml` (they are host
wiring, not API), the routing skill's name and body, and everything under `lib/` except the entry
point — tests may import `parseSembleArgs`/`runSemble`, but downstream packages should not.
The default `engines` requirement (`node` and `dsh`) only widens within a major version; a raised
minimum is a minor bump at most, since installs resolve through the package manager.

**2.x → 3.0.0**: the MCP bridge is gone. The tools are renamed from
`mcp__semble__search` / `mcp__semble__find_related` to `semble_search` / `semble_find_related`, and
the `toolCallTimeoutMs` setting becomes `toolTimeoutMs`. The old names are no longer registered;
update any script that referenced them. Restart DSH once after upgrading.

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
| `semble_search` / `semble_find_related` never appear | the plugin is not loaded (missing anchor row), or the host has no tool registry | reinstall, restart DSH; type `/semble version` as a self-check |
| First search takes minutes | one-time model download | wait, or set `HF_ENDPOINT` |
| Search fails with "did not finish within …" | index build + model download outran `toolTimeoutMs` | raise `toolTimeoutMs` in the plugin settings, or warm the cache once with a CLI search |
| Search fails with "The Semble CLI could not be started" | `uvx` is not on the host's PATH | install uv, restart DSH; on Windows with only a `.cmd` shim, set `command` to `uvx.exe` |
| Search looks stale after a large refactor | the disk index reuses files it believes unchanged | `uvx --from "semble[mcp]" semble clear index`, then search again |
| `/semble` answers "Could not start the Semble CLI" | `uvx` is not on the host's PATH | install uv, restart DSH |
| `savings` counts fewer calls than you made | the report reads the cache location, which `/semble` does not take from the plugin `env` | set `SEMBLE_CACHE_LOCATION` in the host environment as well |
| `ERR_PNPM_GIT_RESOLVE_FAILED` | no network route to github.com | use a tarball URL or a mirror |

## Development

```sh
git clone https://github.com/CodeIntegrity/dsh-semble
dsh plugin --profile web add link:$(pwd)   # then edit and restart DSH
```

No build step: `lib/` is plain ESM and `cordis.patch.yml` is read directly. The only runtime
dependency is `uv`.

`npm test` runs the suite with Node's built-in runner. The spawn tests replace `uvx` with the Node
binary, so they neither download Semble nor touch your cache. `npm run typecheck` runs `tsc` in
checkJs mode over `lib/` — the JSDoc annotations are the type contract, and nothing is compiled.

## Publishing

Releases are tag-driven by `.github/workflows/publish.yml`:

```sh
npm version minor          # bumps package.json and creates the vX.Y.Z tag
git push origin main --follow-tags
```

The workflow runs the tests, refuses to continue when the tag and `package.json` disagree, skips a
version that is already on the registry, and publishes with npm provenance. It needs one repository
secret:

| Secret | What it is |
| --- | --- |
| `NPM_TOKEN` | an npm granular access token with read/write access to `dsh-semble` and 2FA bypass enabled for automation |

Provenance requires a public repository; on a private one, drop `--provenance` from the publish step.
A manual run of the workflow (`workflow_dispatch`) defaults to publishing the current `package.json`
version; tick *dry_run* to only run `npm pack --dry-run`.

## License

MIT
