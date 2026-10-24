---
name: semble-code-search
description: Find code by what it does, not by exact text. Use when you need to locate an implementation, a caller, or a related pattern in the current repository before editing, or when a plain text search returns too much noise.
---

# Semble code search

Semantic search over code, registered by the dsh-semble plugin as two native tools:

- `semble_search` — describe what the code does or where it lives, get ranked `file:line` hits with snippets.
- `semble_find_related` — given one known location, find its siblings: other implementations of the same interface, the callers of a function, the tests for a class.

## When to use it

Use it when you know *what* you are looking for but not *where* it is:

- "where is the retry policy applied when a request fails"
- "which module decides the scoring weights"
- "what else implements this provider interface"

Prefer the `grep` and `read` tools when you already have a path, an exact identifier, or a
short literal to match — the semantic index is a coarse first pass, not a replacement for
reading the code.

## How to query well

The query is matched against embedded function bodies, so phrase it as behaviour:

- Good: `persist a chunk to the vector store`, `resolve the model name from config`, `stream tokens to the client`.
- Bad: a stack trace, an error string, a single identifier, or `fix bug`.

Controls, all on both tools unless noted:

- `repo` — **required**. The absolute path of the repository, or an `https://` URL of a git remote.
  In a session this is normally the session working directory, written the way the host writes paths
  (`D:\work\repo` on Windows, `/home/me/repo` on macOS/Linux). Pass a list to search several
  repositories at once. Omitting it fails validation, so always send it.
- `top_k` — default 5; raise it to 10–20 when the first pass misses.
- `max_snippet_lines` — default 10; use `0` for locations only.
- `content` — `code` (default), `docs`, `config`, or `all`; switch to `all` when the answer may live in documentation or configuration.

## Workflow

1. `semble_search` with a behaviour phrase, always passing `repo`.
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
