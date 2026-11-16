---
name: semble-code-search
description: Use FIRST for "how/where does X work" or behaviour questions when no exact code identifier or file path is given in the prompt — do NOT guess keywords for grep. Also use when grep/ops is noisy/empty, or to find callers and tests before editing (代码语义搜索：提问未直接给出精确符号/路径时优先调用，勿凭猜测关键词 grep).
---

# Semble code search

Semantic search over code, registered by the dsh-semble plugin as two native tools:

- `semble_search` — describe what the code does or where it lives, get ranked `file:line` hits with snippets.
- `semble_find_related` — given one known location, find its siblings: other implementations of the same interface, the callers of a function, the tests for a class.

## When to use it

Call `semble_search` **first** (instead of guessing keywords for `grep`) whenever you know *what*
behaviour you are looking for but not *where* or under *what symbol name* it lives:

1. **Behaviour / architecture questions**: "where is the retry policy applied when a request fails",
   "how are child process outputs capped without splitting multi-byte UTF-8 characters",
   "which module decides the scoring weights".
2. **Unfamiliar repository exploration**: locating the entry point, data flow, or error-handling path
   before planning a change.
3. **Immediate fallback after a failed or noisy `grep`/`glob`**: if a text search returns 0 hits or
   dozens of irrelevant matches, switch to `semble_search` immediately rather than guessing more
   keywords.
4. **Pre-edit impact & sibling discovery (`semble_find_related`)**: once you have a target `file:line`,
   call `semble_find_related` to find parallel implementations, callers, or tests before editing.

**When NOT to use it (stay with `grep` / `glob` / `read`)**:
- The user prompt **already gives** the exact file path (`lib/cli.js`), an exact code identifier (`DEFAULT_MAX_CONCURRENT`),
  or a verbatim error string literal to match.
- Natural-language concepts in a question (e.g. "truncation", "Chinese characters", "retry") are **not**
  exact identifiers — do **not** translate them into guessed `grep` keywords; call `semble_search` first.

## How to query well

The query is matched against embedded function bodies, so phrase it as behaviour:

- Good: `persist a chunk to the vector store`, `resolve the model name from config`, `stream tokens to the client`.
- Bad: a stack trace, an error string, a single identifier, or `fix bug`.

Controls, all on both tools unless noted:

- `repo` — **required on the first call** unless the plugin's `defaultRepo` setting is set. Use the
  absolute path of the repository, or an `https://` URL of a git remote. In a session this is
  normally the session working directory (for a git worktree or sub-agent worktree, pass that
  worktree's path rather than the main checkout), written the way the host writes paths
  (`D:\work\repo` on Windows, `/home/me/repo` on macOS/Linux). Pass a list to search several
  repositories at once; hit paths are then prefixed per repository and the output ends its header
  with `Sources: <label> → <path>`. For a git URL the label only names the temporary clone, so read
  those hits through the path in that line. After any call naming a **single** repository, later
  calls may omit `repo` and reuse it; a multi-repo call is deliberately not remembered.
- `top_k` — default 5; raise it to 10–20 when the first pass misses.
- `max_snippet_lines` — default 10; use `0` for locations only.
- `content` — a **list** of `code` (default), `docs`, `config`, or `all`; pass `["all"]` when the
  answer may live in documentation or configuration. The plugin's `defaultContent` setting changes
  what is used when this argument is omitted.

## Workflow

1. `semble_search` with a behaviour phrase; pass `repo` on the first call (or rely on `defaultRepo` /
   the remembered single repository), then use the `content` argument rather than guessing grep keywords.
2. Open the top hit with the `read` tool, using its `start_line` as `offset`, to confirm it is the
   right code and not a similarity artifact. Pass the returned path through exactly as given — it
   keeps `\` separators on Windows and is already POSIX on macOS/Linux. Rewriting separators by hand
   is where these paths break.
3. `semble_find_related` on that location when you need callers, siblings, or tests.
4. Only then edit.

## Costs and limits

- The first query against a repository builds its index; later queries reuse it. Expect the first
  call in a new repository to be slow — the plugin raises its call ceiling for exactly this reason.
- Results are ranked by similarity; the top hit can still be a near-miss, so open it and read before
  acting. Search scores are rank-fusion values that stay small (~0.0x) even for exactly-relevant
  code — treat them as a relative ordering, not an absolute confidence. An *empty* result is the
  signal that nothing relevant was indexed; rephrase once, then stop.
- The index may be stale relative to uncommitted edits; when proximity matters, read the file
  rather than trusting the snippet.

## If the tools are missing

`semble_search` and `semble_find_related` are registered by the dsh-semble plugin. If they are
absent from your toolset, the plugin is not loaded in this session: say so and fall back to
`grep`/`glob`; do not narrate a call you cannot make. The user can still run `/semble savings`,
`/semble file-types` and `/semble version` from the composer — those are host commands and do not
depend on the tool registry. If those report the Semble CLI could not be started, the usual cause
is `uv` missing from the host's PATH (install: <https://docs.astral.sh/uv/>); on Windows with only
a `uvx.cmd` shim, the plugin's `command` setting must point at `uvx.exe`.
