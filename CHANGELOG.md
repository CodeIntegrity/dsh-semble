# Changelog

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
