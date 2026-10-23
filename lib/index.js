/**
 * Semble MCP bundle — host-side anchor plugin.
 *
 * Two responsibilities:
 *
 * 1. Give the bundle a stable loader entry. The real work is done by the
 *    `@deepseek-ai/dsh-mcp-client` row declared next to this one in
 *    cordis.patch.yml, which loads the MCP client under its own module name, so
 *    a running host would otherwise have no loader entry named after this
 *    package. DSH's plugin inventory and the Plugin Hub decide "loaded" by
 *    matching loader entry names against the installed npm package name
 *    (`isEntryLoaded`), so without an entry of our own the plugin is reported as
 *    未加载 / 待重启 even while its MCP tools are registered and working.
 *
 * 2. Register the bundled routing skill so the model knows *when* the MCP tools
 *    are worth calling. The skill body ships inside this package (skills/
 *    semble/SKILL.md) and is registered as a runtime skill, which keeps plugin
 *    installation a single step: no copying files into ~/.dsh/skills.
 *
 * The skill is loaded lazily by DSH: the session catalog carries only the name
 * and description, and the body text reaches the model only when it calls the
 * `skill` tool. Reading the file here costs one small synchronous read at host
 * start and nothing per request.
 */
import { readFileSync } from 'node:fs'

export const name = 'semble-mcp'

export const inject = ['skills']

const SKILL_URL = new URL('../skills/semble/SKILL.md', import.meta.url)

/** Strip the YAML frontmatter so filesystem-style SKILL.md files render clean. */
function stripFrontmatter(markdown) {
  const match = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(markdown)
  return match === null ? markdown : markdown.slice(match[0].length).replace(/^\s*\n/, '')
}

/** Read the bundled skill body, or `undefined` when the package is incomplete. */
function readSkillBody() {
  try {
    return stripFrontmatter(readFileSync(SKILL_URL, 'utf8')).trim()
  } catch (error) {
    // A missing skill file must not take the MCP connection's anchor row down
    // with it: the tools keep working, only the routing hint is absent.
    console.warn('[semble-mcp] bundled skill could not be read:', error?.message ?? error)
    return undefined
  }
}

/** Apply: provide the loader anchor and register the bundled routing skill. */
export default function sembleMcpBundle(ctx) {
  const content = readSkillBody()
  if (content === undefined) return
  // Registered into this plugin's layer, so teardown follows the fiber and the
  // returned disposer needs no bookkeeping here.
  ctx.skills.register({
    name: 'semble-code-search',
    description:
      'Find code by what it does, not by exact text. Use when locating an implementation, a caller, or a related pattern before editing, or when a plain text search returns too much noise.',
    whenToUse:
      'before a broad code search in a repository, and when a grep result is too noisy to be useful; gives the query shape, the semantic search workflow, and the cost limits of the Semble MCP tools.',
    content,
    source: 'bundle:@local/semble-mcp',
    resourceBase: { kind: 'opaque', description: 'Exposed as the mcp__semble__search and mcp__semble__find_related MCP tools.' },
    invocation: { modelInvocable: true, userInvocable: true },
  })
}

/**
 * Named form of the same entry point. The loader accepts either the default
 * export or a module-level `apply(ctx)`, and spelling both out makes the
 * plugin's shape explicit to readers and to plugin-listing checks.
 */
export const apply = sembleMcpBundle
