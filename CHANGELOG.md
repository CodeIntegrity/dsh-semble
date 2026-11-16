# Changelog

## 3.2.0 (2026-11-16)

- Align CI and publishing with `engines.node >=24.9`; the publish job now runs
  `npm ci` and typecheck before `npm publish`.
- `/semble` now uses the plugin's `command` / `args` / `env` / `toolTimeoutMs`
  settings, so the Windows `uvx.exe` fix and cache overrides apply to reports
  as well as to the search tools.
- Add `defaultContent` and `maxConcurrent` settings. Per-call `content` still
  wins over `defaultContent`; remove the invalid advice about appending
  `--content all` to `args`.
- Sync README.md, README.zh-CN.md and the bundled skill with the actual
  repo-fallback semantics (first call needs `repo` or `defaultRepo`; later
  calls may reuse the last single repository).
- Add a zero-dependency Standard Schema `Config`, align the default export's
  `name` with the loader name, and stop ignoring new files under `test/` in
  `.gitignore`.
- Make `Config` validation real: it now reports malformed fields as Standard
  Schema `issues` (via a strict `validateToolConfig`) instead of always passing
  through. Those issues are fatal — Cordis raises a ValidationError and does not
  load the row, so a typo shows up as a failed plugin row instead of quietly
  becoming a default. `parseToolConfig` keeps its tolerant fallbacks for direct
  callers and tests, and validation no longer rewrites the config it hands back
  (that double normalization made every load warn about `defaultRepo`).
- Attribute the `~99% fewer tokens` and sub-second/millisecond figures in both
  READMEs to the upstream Semble benchmarks rather than implying they were
  measured by this plugin.
- `max_snippet_lines: 0` now renders the `file:line` header alone instead of an
  empty code fence, and a failed call names the repositories it searched, since
  "No chunk found" usually means a stale remembered repository rather than a
  bad path.

## 3.1.1 (2026-11-16)

- Commit `pnpm-lock.yaml` alongside `package-lock.json` so pnpm users resolve
  the same `@types/node` and `typescript` versions CI installs.
- Ignore the `test` path in `.gitignore`.

## 3.1.0 (2026-11-13)

- Remember the last single repository: once a call names one `repo`, later
  calls may omit it, and a multi-repo call is deliberately not remembered
  (reusing one of several would silently narrow the next search). A new
  `defaultRepo` setting backs the very first repo-less call; with neither
  known, the CLI still rejects the call before spawning anything.
- Tear down the whole child process tree on timeout or abort: POSIX children
  lead their own process group so one signal reaches uvx's python worker, then
  SIGTERM escalates to SIGKILL after `TERM_GRACE_MS`, and the runner settles
  `FORCE_SETTLE_MS` after the kill so a child the OS will not reap cannot
  strand a concurrency slot (`lib/cli.js`). Windows still terminates only the
  direct child.
- Route behaviour questions to the tools first: the skill description and both
  tool descriptions now say to call `semble_search` before guessing grep
  keywords, and to call `semble_find_related` once a `file:line` is known.
- Extend `test/consistency.test.js` with a routing-scope suite that builds a
  scenario table from this repository's own modules and asserts the skill,
  tool descriptions and docs agree with it.
- Rewrite `docs/upgrade-plan.md` as a kept audit and decision record
  (baseline v3.0.6, 64 tests) instead of a stale to-do list.

## 3.0.6 (2026-11-13)

- Bound concurrent Semble CLI subprocesses to `DEFAULT_MAX_CONCURRENT = 2` via
  a zero-dependency FIFO semaphore in `lib/cli.js` (with `AbortSignal` queue
  cancellation), preventing parallel tool or sub-agent calls from contending
  on `uvx` environment setup, index locks, and embedding-model memory.
- Set `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` on child processes by default
  so Windows Python writes UTF-8 to redirected output files instead of the
  system code page (fixing garbled box-drawing/progress characters in
  `/semble savings`).
- Document git worktree `repo` path handling in `skills/semble/SKILL.md` and
  `/semble clear orphans` usage for cleaned-up worktrees in both READMEs.

## 3.0.5 (2026-11-11)

Track upstream `semble` 0.7.3 (PyPI, 2026-11-08) without pinning it.

- Surface the `repos` map upstream adds when one call searches several
  repositories: `semble_search` output now ends the header with
  `Sources: <label> → <path>`. A git URL's source is its temp clone, so this
  is what makes those hits openable. Hits are unchanged; `parseSearchOutput`
  keeps its array shape and `parseSearchPayload` exposes both.
- Document the map in the routing skill and both READMEs.

The CLI contract is otherwise unchanged from the 0.7.0 test baseline:
`search`/`find-related` positional arguments and the
`-k/--max-snippet-lines/--format/--content` flags still parse, and
`--format json` still emits `query` plus
`results[].{file_path,start_line,end_line,score,content}` — re-verified live
against 0.7.3. No dependency pin: the floating `semble[mcp]` spec keeps
picking up upstream fixes (0.7.3 chunks in process when a sandbox denies the
worker pool, which is exactly the dsh-semble launch environment).

## 3.0.4 (2026-11-02)

Align engine declarations with DSH 0.2.2-alpha.2, which raised the host's
minimum Node.js to 24.9.

- Raise `engines.node` from `>=22` to `>=24.9` to match the DSH host floor.
- Bump `@types/node` devDependency from `^22.20.5` to `^24.0.0`.
- Add `.npm-cache/` to `.gitignore`.

No runtime code changes; all 51 tests pass and `tsc --noEmit` is clean.

## 3.0.3

Close the missing-CLI triage loop in the routing skill. Add
awesome-dsh-plugin and dsh-plugin.org listing badges.

## 3.0.2

Add `/semble clear <index|savings|orphans|all>`.

## 3.0.1

Carry the `skills` inject declaration on the default export so Cordis
resolves the injected service after `unwrapExports`.

## 3.0.0

Drop the MCP loader row; register `semble_search` and
`semble_find_related` as native tools via `ctx.tools`.
