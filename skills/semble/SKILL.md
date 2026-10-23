---
name: semble-code-search
description: Find code by what it does, not by exact text. Use when you need to locate an implementation, a caller, or a related pattern in this repository before editing, or when a plain text search returns too much noise.
---

# Semble code search

Semantic search over code, exposed by the Semble MCP server as two tools:

- `mcp__semble__search` — describe what the code does or where it lives, get ranked `file:line` hits with snippets.
- `mcp__semble__find_related` — given one known location, find its siblings: other implementations of the same interface, the callers of a function, the tests for a class.

## When to use it

Use it when you know *what* you are looking for but not *where* it is:

- "where is the retry policy applied when a request fails"
- "which module decides the scoring weights"
- "what else implements this provider interface"

Prefer plain `grep`/`read` when you already have a path, an exact identifier, or a short literal to match — the semantic index is a coarse first pass, not a replacement for reading the code.

## How to query well

The query is matched against embedded function bodies, so phrase it as behaviour:

- Good: `persist a chunk to the vector store`, `resolve the model name from config`, `stream tokens to the client`.
- Bad: a stack trace, an error string, a single identifier, or `fix bug`.

Controls:

- `repo` — local path or `https://` URL; pass several to search across repositories.
- `top_k` — default 5; raise it to 10–20 when the first pass misses.
- `max_snippet_lines` — default 10; use `0` for locations only, or omit a cap to see a whole chunk.
- `content` — `code` (default), `docs`, `config`, or `all`; switch to `all` when the answer may live in documentation or configuration.

## Workflow

1. `search` with a behaviour phrase.
2. Read the top hit at its `file_path:line` to confirm it is the right code, not a similarity artifact.
3. `find_related` on that location when you need callers, siblings, or tests.
4. Only then edit.

## Costs and limits

- The first query against a repository builds its index; later queries reuse it. Expect the first call in a new repository to be slow.
- Results are ranked by similarity, so the top hit can be a near-miss. Treat every hit as a lead to verify, never as a fact.
- The index may be stale relative to uncommitted edits; when proximity matters, read the file rather than trusting the snippet.
