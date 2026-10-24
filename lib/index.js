/**
 * Semble code-search bundle — host-side anchor plugin.
 *
 * Since 3.0.0 this bundle does not load an MCP server. Four responsibilities:
 *
 * 1. Give the bundle a stable loader entry. DSH's plugin inventory and the
 *    Plugin Hub decide "loaded" by matching loader entry names against the
 *    installed npm package name (`isEntryLoaded`), so cordis.patch.yml declares
 *    exactly one row — an empty plugin loaded under this package's own name —
 *    and that row is what keeps the bundle reported as loaded.
 *
 * 2. Register the two native search tools, `semble_search` and
 *    `semble_find_related`, directly into the host's tool registry. There is no
 *    MCP layer any more: every call spawns the Semble CLI
 *    (`uvx --from "semble[mcp]" semble search|find-related --format json`,
 *    through lib/cli.js) and the JSON hits are parsed and rendered here. The
 *    loader passes the row's `config` to apply as its second argument, so the
 *    launcher (`command`/`args`), child `env` and `toolTimeoutMs` are all
 *    configurable from the plugin settings.
 *
 * 3. Register the bundled routing skill so the model knows *when* the search
 *    tools are worth calling. The skill body ships inside this package
 *    (skills/semble/SKILL.md) and is registered as a runtime skill, which keeps
 *    plugin installation a single step: no copying files into ~/.dsh/skills.
 *
 * 4. Register the `/semble` command, which shells out to the Semble CLI for the
 *    read-only reports the tools do not expose (`savings`, `file-types`,
 *    `version`). The command runs in the host, so it works wherever the plugin
 *    works, and its output never costs a model turn.
 *
 * The skill is loaded lazily by DSH: the session catalog carries only the name
 * and description, and the body text reaches the model only when it calls the
 * `skill` tool. Reading the file here costs one small synchronous read at host
 * start and nothing per request.
 */
import { readFileSync } from 'node:fs'

import { parseSembleArgs, runSemble, SEMBLE_USAGE } from './cli.js'
import { createSembleTools, parseToolConfig } from './tools.js'

/**
 * The slice of the DSH plugin context this bundle consumes. Only the members
 * actually called are declared; the authoritative interface lives in the host.
 *
 * @typedef {object} PluginContext
 * @property {{ register(definition: {
 *   name: string,
 *   description: string,
 *   whenToUse?: string,
 *   content: string,
 *   source?: string,
 *   resourceBase?: { kind: string, description: string },
 *   invocation?: { modelInvocable?: boolean, userInvocable?: boolean },
 * }): unknown }} skills
 * @property {(deps: string[], callback: (ctx: PluginContext & {
 *   tools: NonNullable<PluginContext['tools']>,
 *   commands: NonNullable<PluginContext['commands']>,
 * }) => void) => void} [inject]
 * @property {{ register(definition: import('./tools.js').SembleToolDefinition): unknown }} [tools]
 * @property {{ register(definition: {
 *   name: string,
 *   description: string,
 *   input?: { hint?: string },
 *   handler: (invocation: CommandInvocation) => unknown,
 * }): unknown }} [commands]
 */

/** @typedef {{ rawInput?: string, signal?: AbortSignal }} CommandInvocation */

/** @typedef {{ kind: 'success', text: string } | { kind: 'error', text: string }} CommandResult */

export const name = 'dsh-semble'

export const inject = ['skills']

const SKILL_URL = new URL('../skills/semble/SKILL.md', import.meta.url)

/** Strip the YAML frontmatter so filesystem-style SKILL.md files render clean.
 *
 * @param {string} markdown
 * @returns {string}
 */
function stripFrontmatter(markdown) {
  const match = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(markdown)
  return match === null ? markdown : markdown.slice(match[0].length).replace(/^\s*\n/, '')
}

/** Read the bundled skill body, or `undefined` when the package is incomplete.
 *
 * @returns {string | undefined}
 */
function readSkillBody() {
  try {
    return stripFrontmatter(readFileSync(SKILL_URL, 'utf8')).trim()
  } catch (error) {
    // A missing skill file must not take the loader anchor down with it: the
    // tools keep working, only the routing hint is absent.
    console.warn('[dsh-semble] bundled skill could not be read:', error instanceof Error ? error.message : String(error))
    return undefined
  }
}

/**
 * Handler for `/semble`.
 *
 * Returns a CommandResult instead of throwing: the command surface renders
 * `{ kind: 'error' }` inline, and a failed uvx run is an ordinary answer here,
 * not a plugin fault.
 *
 * @param {CommandInvocation} invocation
 * @param {import('./cli.js').RunSembleOptions} [options]
 *   Passed through to `runSemble`; tests substitute the runner here instead of
 *   relying on a uvx install.
 * @returns {Promise<CommandResult>}
 */
export async function handleSembleCommand(invocation, options = {}) {
  const parsed = parseSembleArgs(invocation.rawInput)

  if (parsed.kind === 'usage') {
    return { kind: 'success', text: SEMBLE_USAGE }
  }
  if (parsed.kind === 'unknown') {
    return { kind: 'error', text: `Unknown subcommand "${parsed.name}".\n\n${SEMBLE_USAGE}` }
  }

  const result = await runSemble(parsed.argv, { signal: invocation.signal, ...options })
  const output = [result.stdout?.trim(), result.stderr?.trim()].filter(Boolean).join('\n')

  if (result.error !== undefined) {
    return {
      kind: 'error',
      text: [
        `Could not start the Semble CLI (${result.error}).`,
        'Install uv first: https://docs.astral.sh/uv/',
        'On Windows, if uv is installed but only a `uvx.cmd` shim is on PATH, set the',
        "plugin's `command` setting to `uvx.exe` instead.",
      ].join('\n'),
    }
  }
  if (result.aborted === true) {
    return { kind: 'error', text: 'Semble CLI command cancelled.' }
  }
  if (result.timedOut === true) {
    return {
      kind: 'error',
      text: `Semble CLI did not finish within its time limit; the first uvx run may still be downloading.\n\n${output}`.trim(),
    }
  }
  if (result.code !== 0) {
    return {
      kind: 'error',
      text: `semble ${parsed.argv.join(' ')} exited with code ${result.code ?? 'unknown'}.\n\n${output}`.trim(),
    }
  }

  return { kind: 'success', text: output === '' ? 'Semble CLI returned no output.' : output }
}

/**
 * Register the two native search tools once the optional `tools` service is
 * available. The definitions are built from the settings parsed out of the
 * loader row's config, so editing the plugin settings re-applies the bundle
 * with new launcher/env/timeout values.
 *
 * @param {PluginContext & { tools: NonNullable<PluginContext['tools']> }} ctx
 * @param {import('./tools.js').SembleToolSettings} settings
 */
function registerSembleTools(ctx, settings) {
  for (const definition of createSembleTools(settings)) {
    ctx.tools.register(definition)
  }
}

/**
 * Register `/semble` once the optional `commands` service is available.
 *
 * A UI-less composition (for example an ACP automation profile) provides no
 * command surface; the search tools and the skill must keep working there, so
 * the command is a child plugin rather than a hard dependency.
 *
 * @param {PluginContext & { commands: NonNullable<PluginContext['commands']> }} ctx
 */
function registerSembleReports(ctx) {
  ctx.commands.register({
    name: 'semble',
    description: 'Show Semble CLI reports (token savings, indexed file types, version)',
    input: { hint: 'savings | file-types | version' },
    handler: handleSembleCommand,
  })
}

/**
 * Apply: provide the loader anchor, the native search tools, the routing
 * skill, and the CLI reports.
 *
 * @param {PluginContext} ctx
 * @param {unknown} [config] The loader row's `config`, coerced by parseToolConfig.
 */
export default function sembleBundle(ctx, config) {
  const settings = parseToolConfig(config)

  const content = readSkillBody()
  if (content !== undefined) {
    // Registered into this plugin's layer, so teardown follows the fiber and the
    // returned disposer needs no bookkeeping here.
    ctx.skills.register({
      name: 'semble-code-search',
      description:
        'Find code by what it does, not by exact text. Use when locating an implementation, a caller, or a related pattern before editing, or when a plain text search returns too much noise.',
      whenToUse:
        'before a broad code search in a repository, and when a grep result is too noisy to be useful; gives the query shape, the semantic search workflow, and the cost limits of the Semble search tools.',
      content,
      source: 'bundle:dsh-semble',
      resourceBase: { kind: 'opaque', description: 'Exposed as the semble_search and semble_find_related native tools.' },
      invocation: { modelInvocable: true, userInvocable: true },
    })
  }

  // `ctx.inject` starts a child plugin that loads only when the service exists,
  // which keeps UI-less compositions usable while adding the tools wherever a
  // tool registry is present, and `/semble` wherever a command surface is.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['tools'], (toolsCtx) => registerSembleTools(toolsCtx, settings))
    ctx.inject(['commands'], registerSembleReports)
  }
}

/**
 * Named form of the same entry point. The loader accepts either the default
 * export or a module-level `apply(ctx)`, and spelling both out makes the
 * plugin's shape explicit to readers and to plugin-listing checks.
 */
export const apply = sembleBundle
