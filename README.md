# dsh-semble

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that exposes
[Semble](https://github.com/MinishLab/semble) (agent code search) to every DSH session as native
MCP tools.

English | [简体中文](README.zh-CN.md)

## What it does

Installs two loader rows: a no-op anchor loaded under this package's own name, plus one MCP
connection row (`@deepseek-ai/dsh-mcp-client`) configured to start the official Semble MCP server
over stdio. The anchor exists because DSH decides "loaded" by matching loader entry names against
the installed package name — without it the plugin is reported as 未加载 / 待重启 in the settings
dialog even while its tools work. It registers no tools, services or events.

```
uvx --from "semble[mcp]" semble
```

The agent then gets two tools:

- `mcp__semble__search` — semantic + lexical code search over a repo path or git URL.
- `mcp__semble__find_related` — find chunks similar to a known file/line.

Semble itself is **not vendored**: the plugin only declares how to launch it from PyPI, so nearly
all upstream updates (bugfixes, new tools) flow through automatically.

## Requirements

- [uv](https://docs.astral.sh/uv/) on PATH (`uvx` bootstraps Semble). Install it per platform:

  ```powershell
  # Windows
  winget install astral-sh.uv
  ```

  ```sh
  # macOS
  brew install uv
  # macOS / Linux
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```

- First start downloads the package from PyPI and the embedding model from HuggingFace (~1-2 min,
  one-time; offline afterwards).
- On networks where huggingface.co is unreachable, add `HF_ENDPOINT` in the plugin settings —
  the shipped default deliberately sets no endpoint, so downloads come from the official host:

  ```yaml
  env:
    HF_ENDPOINT: https://hf-mirror.com
  ```

## Platform notes

The bundle ships **no OS-specific path and no region-specific endpoint**, so the same installation
works on Windows, macOS and Linux. What does differ, and what operators have to adapt:

| Concern | Windows | macOS / Linux |
| --- | --- | --- |
| Executable | `uvx` resolves to `uvx.exe` (uv ships real binaries) | `uvx` on PATH |
| Repository paths (`repo`, `link:`) | `D:\work\repo` | `/home/me/repo` |
| Profile home | `C:\Users\<you>\.dsh` | `~/.dsh` |
| Line endings in hits | returned `file_path` keeps `\` separators | POSIX `/` |

If `uv` was installed through a shell shim rather than the official installer, `uvx` may exist only
as `uvx.cmd`; stdio spawning does not go through a shell, so point `command` at `uvx.exe`
explicitly in the settings.

## Configuration

Edit the `semble-mcp` row in the DSH plugin settings page:

- **Content types**: append `--content all` (or `docs` / `config`) to `args` to change what gets indexed.
- **Pin a version**: change `--from "semble[mcp]"` to `--from "semble[mcp]==X.Y.Z"` for stability.
- **Environment**: no `env` is set by default. Add entries such as `HF_ENDPOINT`
  (see Platform notes), `SEMBLE_MODEL_NAME` (custom model path), `SEMBLE_MAX_FILE_BYTES`,
  `SEMBLE_INDEX_WORKERS`, `SEMBLE_CACHE_LOCATION`.
- **Working directory**: `cwd` is unset, so the server inherits the host working directory; per-call
  `repo` values should be absolute paths in the host's own convention.


Config changes restart the connection; disk index caches survive.

## Install

The plugin is a pure bundle: installing it means adding the package to a DSH profile, which makes
DSH load `cordis.patch.yml` and mount the MCP connection. Pick the route that matches your setup.

### Desktop app (Settings → Plugins → Install)

Paste the repository spec into the install box:

```
github:CodeIntegrity/dsh-semble
```

To pin a release instead of tracking `main`:

```
github:CodeIntegrity/dsh-semble#v1.0.0
```

The settings page is the only supported route for the `desktop` profile — the CLI refuses it
because the Electron app owns that profile's `node_modules` and lockfile.

### CLI (any non-desktop profile: `web`, `tui`, …)

```
dsh plugin --profile web add github:CodeIntegrity/dsh-semble
```

The subcommand forwards to `pnpm add` inside the profile directory, then reconciles
`dsh.profile.bundles`, so the bundle is mounted on the next start. `github:owner/repo`,
`git+https://…`, `https://github.com/owner/repo` and `.tgz` URLs are all accepted.

### Local checkout (development)

Point the profile at this directory instead of a git ref (use the host's own path form):

```
dsh plugin --profile web add link:/absolute/path/to/dsh-semble   # macOS / Linux
dsh plugin --profile web add link:D:\path\to\dsh-semble          # Windows
```

or, from a DSH session opened in this workspace:

```
plugin_manager action=install_bundle target=D:\Workspace\dsh-semble
```

(`target` takes either form; the example above is the Windows spelling.)

The `link:` form keeps the profile pointing at your working copy, so edits to
`cordis.patch.yml` take effect on the next host start without reinstalling.

### Requirements for git installs

- `git` on PATH and network access to the repository host.
- No build step: the package has no `prepare` script, so pnpm needs no `allowBuilds` exemption.
- `uv` is still required at *runtime* (see Requirements) — installing the plugin does not install it.

Restart DSH after the first install. The settings dialog may say 待重启 until you do; that flag
lives in host memory and clears on the next start.

## Update

Re-run the install with a newer ref (or press 更新 in the settings page):

```
dsh plugin --profile web add github:CodeIntegrity/dsh-semble#v1.1.0
```

For a `link:` install, `git pull` in the checkout and restart DSH. Semble itself is updated
separately and automatically — see Update policy.

## Uninstall

Settings → Plugins → 卸载, or:

```
dsh plugin --profile web remove @local/semble-mcp
```

Removal drops the dependency and the `dsh.profile.bundles` entry; the cached Semble index and the
HuggingFace model stay on disk and are reused if you reinstall.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Row says 待重启 after install | The host loaded its layer list before the install | Restart DSH once |
| Tools work but the row says 未加载 | `cordis.patch.yml` is missing the anchor row (see What it does) | Reinstall this version or newer |
| `mcp__semble__*` never appears | `uvx` missing, or the first PyPI/model download failed | Run `uvx --from "semble[mcp]" semble --version` by hand and read the error |
| First search hangs for minutes | Embedding model download (one-time) | Wait, or set `HF_ENDPOINT` to a reachable mirror |
| `ERR_PNPM_GIT_RESOLVE_FAILED` during install | No network route to github.com | Use a tarball URL or an npm mirror instead |

## The bundled skill

Installing the bundle also registers one routing skill, `semble-code-search`. It exists because the
tools themselves do not advertise *when* they are worth calling: a model that reaches for `grep`
first never discovers what the index could have done for it.

DSH loads skills lazily, so the cost model is:

| At | Enters the session | Size |
| --- | --- | --- |
| Before the first request | one catalog entry: name plus a capped description | a few hundred bytes per session |
| When the model calls `skill` | the full `skills/semble/SKILL.md` body | ~2 KB, only when used |
| When the user types `/semble-code-search` | the same body, injected into that step | manual |

The body never enters the system prompt. That is by design: a skill body pinned there is paid for on
every session whether or not the tools are used.

To drop only the skill and keep the tools, delete the `ctx.skills.register(...)` call in
`lib/index.js`. The body lives at `skills/semble/SKILL.md` and is also valid as a hand-placed
`~/.dsh/skills/semble/SKILL.md` if you prefer the filesystem provider.

## Update policy

Default spec is floating (`semble[mcp]`) so releases follow the upstream repository automatically.
Only breaking changes to the CLI surface (arg/env renames) require editing `cordis.patch.yml` here.
