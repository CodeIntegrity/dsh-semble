# Changelog

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
