/**
 * Native tool definitions backed by the Semble CLI.
 *
 * Since 3.0.0 the bundle no longer loads an MCP server. The two search tools
 * are registered directly into the host's tool registry (ctx.tools) and every
 * call spawns the same `uvx --from "semble[mcp]" semble` installation the
 * `/semble` command uses, with `--format json` so the result can be parsed
 * here instead of being pasted into the transcript.
 *
 * The CLI is the backend of record: `semble search` and `semble find-related`
 * expose the same ranking, snippet and content-type controls the MCP server
 * did, so `lib/cli.js` stays the single spawn path for both surfaces. All
 * failures (uvx missing, cold-start timeout, non-zero exit, malformed JSON)
 * are thrown as ordinary tool errors: the model sees a readable message and
 * the turn continues.
 */

import { runSemble, SEMBLE_UVX_PREFIX } from './cli.js'

/**
 * The runner settings derived from the loader row's `config`. The row config
 * arrives as a plain object (the plugin exports no Config schema on purpose,
 * to stay dependency-free), so every field is coerced here and falls back to
 * the shipped default when absent or mistyped.
 *
 * @typedef {object} SembleToolSettings
 * @property {string} command Executable to launch; defaults to `uvx`.
 * @property {string[]} args Arguments placed before the Semble subcommand.
 * @property {Record<string, string>} env Variables layered onto the child environment.
 * @property {number} toolTimeoutMs Kill the child after this many milliseconds.
 */

/** The first query in a repository also builds its index: chunking plus a
 * one-time model download routinely exceeds the 60 s the reports need, so
 * tools get the five-minute ceiling the MCP row used to carry. */
export const DEFAULT_TOOL_TIMEOUT_MS = 300_000

const DEFAULT_COMMAND = 'uvx'

const CONTENT_TYPES = new Set(['code', 'docs', 'config', 'all'])

const DEFAULT_TOP_K = 5
const MAX_TOP_K = 100
const DEFAULT_MAX_SNIPPET_LINES = 10

/**
 * Narrow an unknown value to a string-keyed record.
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Drop every non-string value, so a YAML `true` cannot leak into the env.
 *
 * @param {unknown} raw
 */
function collectEnv(raw) {
  if (!isRecord(raw)) return {}
  /** @type {Record<string, string>} */
  const env = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') env[key] = value
  }
  return env
}

/**
 * Coerce the loader row's raw `config` into runner settings.
 *
 * Never throws: a mistyped field falls back to its default (with a console
 * warning) so a settings typo cannot take the whole plugin down.
 *
 * @param {unknown} raw
 * @returns {SembleToolSettings}
 */
export function parseToolConfig(raw) {
  const config = isRecord(raw) ? raw : {}

  let command = DEFAULT_COMMAND
  if (typeof config.command === 'string' && config.command.trim() !== '') {
    command = config.command
  } else if (config.command !== undefined) {
    console.warn('[dsh-semble] config.command must be a non-empty string; using uvx')
  }

  let args = SEMBLE_UVX_PREFIX
  if (
    Array.isArray(config.args) &&
    config.args.length > 0 &&
    config.args.every((entry) => typeof entry === 'string')
  ) {
    args = /** @type {string[]} */ (config.args)
  } else if (config.args !== undefined) {
    console.warn('[dsh-semble] config.args must be a non-empty list of strings; using the shipped prefix')
  }

  let toolTimeoutMs = DEFAULT_TOOL_TIMEOUT_MS
  if (typeof config.toolTimeoutMs === 'number' && Number.isFinite(config.toolTimeoutMs) && config.toolTimeoutMs > 0) {
    toolTimeoutMs = config.toolTimeoutMs
  } else if (config.toolTimeoutMs !== undefined) {
    console.warn('[dsh-semble] config.toolTimeoutMs must be a positive number; using 300000')
  }

  return { command, args, toolTimeoutMs, env: collectEnv(config.env) }
}

/**
 * Normalize the `repo` argument: one path or a list of paths.
 *
 * @param {unknown} repo
 * @returns {string[]}
 */
function normalizeRepos(repo) {
  const repos = typeof repo === 'string' ? [repo] : Array.isArray(repo) ? repo : []
  const paths = repos.filter((entry) => typeof entry === 'string' && entry.trim() !== '')
  if (paths.length === 0) {
    throw new TypeError('repo must be an absolute path (or an https:// git URL), or a list of them')
  }
  return paths
}

/**
 * Clamp one optional integer flag into the range the CLI accepts.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampInteger(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/**
 * Normalize the optional `content` selection; unknown values are dropped and
 * an empty selection means the CLI default (code).
 *
 * @param {unknown} content
 * @returns {string[]}
 */
function normalizeContent(content) {
  const requested = typeof content === 'string' ? [content] : Array.isArray(content) ? content : []
  const types = requested.filter((entry) => typeof entry === 'string' && CONTENT_TYPES.has(entry))
  return types.length === 0 ? ['code'] : [...new Set(types)]
}

/**
 * Shared flags for both subcommands. Order mirrors `semble search --help`:
 * positionals first, then options — argparse accepts either, and this reads
 * like the documented invocation.
 *
 * @param {{ top_k?: unknown, max_snippet_lines?: unknown, content?: unknown }} params
 * @returns {string[]}
 */
function sharedFlags(params) {
  const topK = clampInteger(params.top_k, DEFAULT_TOP_K, 1, MAX_TOP_K)
  const snippetLines = clampInteger(params.max_snippet_lines, DEFAULT_MAX_SNIPPET_LINES, 0, Number.MAX_SAFE_INTEGER)
  return [
    '-k', String(topK),
    '--max-snippet-lines', String(snippetLines),
    '--content', ...normalizeContent(params.content),
    '--format', 'json',
  ]
}

/**
 * Build the argv for `semble search`. The caller has already normalized
 * `repos` to at least one entry.
 *
 * @param {{ query: string, repos: string[], top_k?: unknown, max_snippet_lines?: unknown, content?: unknown }} params
 * @returns {string[]}
 */
export function buildSearchArgs(params) {
  return ['search', params.query, ...params.repos, ...sharedFlags(params)]
}

/**
 * Build the argv for `semble find-related`: the file path exactly as a search
 * result showed it, its 1-indexed line, then the repositories to search.
 *
 * @param {{ path: string, line: unknown, repos: string[], top_k?: unknown, max_snippet_lines?: unknown, content?: unknown }} params
 * @returns {string[]}
 */
export function buildFindRelatedArgs(params) {
  const line = clampInteger(params.line, 1, 1, Number.MAX_SAFE_INTEGER)
  return ['find-related', params.path, String(line), ...params.repos, ...sharedFlags(params)]
}

/** How much of an unexpected payload to quote in an error message. */
const EXCERPT_BYTES = 200

/**
 * Quote the head of an unexpected payload, newlines collapsed, for an error.
 *
 * @param {string} text
 * @returns {string}
 */
function excerpt(text) {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= EXCERPT_BYTES ? flat : `${flat.slice(0, EXCERPT_BYTES)}…`
}

/**
 * Parse `semble --format json` output into hit records.
 *
 * Throws an ordinary Error (never a parse crash) so a semver drift upstream
 * surfaces as a readable tool failure instead of an unhandled exception.
 *
 * @param {string} stdout
 * @returns {{ file_path: string, start_line: number | null, end_line: number | null, score: number | null, content: string }[]}
 */
export function parseSearchOutput(stdout) {
  /** @type {unknown} */
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error(`semble returned output that is not JSON: ${excerpt(stdout)}`)
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
    throw new Error(`semble returned JSON without a "results" list: ${excerpt(stdout)}`)
  }
  return parsed.results.flatMap((hit) => {
    if (!isRecord(hit) || typeof hit.file_path !== 'string') return []
    return [{
      file_path: hit.file_path,
      start_line: typeof hit.start_line === 'number' ? hit.start_line : null,
      end_line: typeof hit.end_line === 'number' ? hit.end_line : null,
      score: typeof hit.score === 'number' ? hit.score : null,
      content: typeof hit.content === 'string' ? hit.content : '',
    }]
  })
}

/**
 * Render parsed hits the way the model should see them: one `file:line`
 * header with the similarity score, then the snippet.
 *
 * @param {string} query
 * @param {string[]} repos
 * @param {ReturnType<parseSearchOutput>} hits
 * @returns {string}
 */
export function renderHits(query, repos, hits) {
  if (hits.length === 0) {
    return [
      `No hits for "${query}" in ${repos.join(', ')}.`,
      'Search scores are rank-fusion values that stay small (~0.02) even for exactly-relevant code,',
      'so compare hits against each other, not against an absolute scale. An empty result means nothing',
      'relevant was indexed: try a behaviour phrase, or content ["all"] when the answer may live in docs or config.',
    ].join('\n')
  }

  const header = `${hits.length} hit(s) for "${query}" in ${repos.join(', ')}:`
  const blocks = hits.map((hit) => {
    const range = hit.start_line === null ? '' : hit.end_line === null ? `:${hit.start_line}` : `:${hit.start_line}-${hit.end_line}`
    const score = hit.score === null ? '' : `  score ${hit.score.toFixed(4)}`
    return [`${hit.file_path}${range}${score}`, '', '```', hit.content, '```'].join('\n')
  })
  return [header, ...blocks].join('\n\n')
}

/**
 * The model-facing parameter schema for both tools, in the raw JSON Schema
 * subset the tool registry enforces (type/oneOf/properties/required/
 * additionalProperties/items/enum plus annotations — no anyOf, no bounds).
 *
 * `repo` is string-or-list via oneOf: a single path and a list never both
 * match, so exact-one behaves like a union here.
 */

/** @type {Record<string, unknown>} */
const REPO_PROPERTY = {
  oneOf: [
    { type: 'string', description: 'Absolute repository path in the host convention (D:\\work\\repo on Windows, /home/me/repo elsewhere), or an https:// git URL.' },
    { type: 'array', items: { type: 'string' }, description: 'Several repositories searched together; results are prefixed per repository.' },
  ],
}

/** @type {Record<string, unknown>} */
const TOP_K_PROPERTY = { type: 'integer', description: 'Number of results, 1–100. Default 5; raise to 10–20 when the first pass misses.' }

/** @type {Record<string, unknown>} */
const MAX_SNIPPET_LINES_PROPERTY = { type: 'integer', description: 'Lines of source per result. Default 10; 0 gives locations only.' }

/** @type {Record<string, unknown>} */
const CONTENT_PROPERTY = {
  type: 'array',
  items: { type: 'string', enum: ['code', 'docs', 'config', 'all'] },
  description: 'Content types to search. Default ["code"]; use ["all"] when the answer may live in docs or config.',
}

/** @type {Record<string, unknown>} */
const SEARCH_PARAMETERS = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'What the code does, phrased as behaviour — e.g. "persist a chunk to the vector store". A single identifier or a stack trace matches poorly.' },
    repo: REPO_PROPERTY,
    top_k: TOP_K_PROPERTY,
    max_snippet_lines: MAX_SNIPPET_LINES_PROPERTY,
    content: CONTENT_PROPERTY,
  },
  required: ['query', 'repo'],
  additionalProperties: false,
}

/** @type {Record<string, unknown>} */
const FIND_RELATED_PARAMETERS = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'File path exactly as a semble_search result showed it (backslashes on Windows are kept as given).' },
    line: { type: 'integer', description: '1-indexed line number of the known location.' },
    repo: REPO_PROPERTY,
    top_k: TOP_K_PROPERTY,
    max_snippet_lines: MAX_SNIPPET_LINES_PROPERTY,
    content: CONTENT_PROPERTY,
  },
  required: ['path', 'line', 'repo'],
  additionalProperties: false,
}

/**
 * Run one subcommand through the CLI and return the rendered hit text.
 *
 * @param {string[]} argv
 * @param {SembleToolSettings} settings
 * @param {{ signal?: AbortSignal }} [exec]
 * @param {{ query?: string, repos?: string[] }} [render]
 */
async function runToHits(argv, settings, exec, render = { query: '', repos: [] }) {
  const result = await runSemble(argv, {
    timeoutMs: settings.toolTimeoutMs,
    signal: exec?.signal,
    command: settings.command,
    prefix: settings.args,
    env: settings.env,
  })
  const hits = parseOrThrow(result, argv)
  return renderHits(render.query ?? '', render.repos ?? [], hits)
}

/**
 * @param {import('./cli.js').RunSembleResult} result
 * @param {string[]} argv
 */
function parseOrThrow(result, argv) {
  if (result.error !== undefined) {
    throw new Error([
      `The Semble CLI could not be started (${result.error}).`,
      'Install uv first: https://docs.astral.sh/uv/',
      'On Windows, if uv is installed but only a `uvx.cmd` shim is on PATH, set the plugin\'s `command` setting to `uvx.exe`.',
    ].join('\n'))
  }
  if (result.aborted === true) {
    throw new Error('The Semble call was cancelled.')
  }
  if (result.timedOut === true) {
    throw new Error([
      'semble did not finish within its time limit.',
      'The first query in a new repository also builds that repository\'s index (local chunking plus a one-time embedding-model download),',
      'which can exceed the limit on a slow link; raise `toolTimeoutMs` in the plugin settings.',
      result.stderr.trim(),
    ].filter(Boolean).join('\n'))
  }
  if (result.code !== 0) {
    throw new Error(`semble ${argv[0]} exited with code ${result.code ?? 'unknown'}.\n${[result.stdout?.trim(), result.stderr?.trim()].filter(Boolean).join('\n')}`.trim())
  }
  return parseSearchOutput(result.stdout)
}

/**
 * A tool definition shaped for the host's registry: model-facing
 * name/description/parameters, a canonical string output with a text render,
 * an `execute` body, and a cooperative `timeoutMs` ceiling shared with the
 * child-process kill timer.
 *
 * @typedef {object} SembleToolDefinition
 * @property {string} name
 * @property {string} description
 * @property {Record<string, unknown>} parameters Raw JSON Schema (registry subset).
 * @property {number} [timeoutMs]
 * @property {{ schema: Record<string, unknown>, render: (args: unknown, value: string) => Array<{ type: string, text: string }> }} output
 * @property {(args: Record<string, unknown>, exec?: { signal?: AbortSignal }) => Promise<string>} execute
 */

/**
 * Build the two native tool definitions.
 *
 * @param {SembleToolSettings} settings
 * @returns {SembleToolDefinition[]}
 */
export function createSembleTools(settings) {
  return [
    {
      name: 'semble_search',
      description:
        'Semantic code search over one or more repositories: describe what the code does and get ranked file:line hits with snippets. Prefer grep/read when an exact identifier or path is already known.',
      parameters: SEARCH_PARAMETERS,
      timeoutMs: settings.toolTimeoutMs,
      output: {
        schema: { type: 'string' },
        /**
         * @param {unknown} _args
         * @param {string} value
         */
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      /**
       * @param {Record<string, unknown>} args
       * @param {{ signal?: AbortSignal }} [exec]
       */
      async execute(args, exec) {
        const { query, repo, top_k: topK, max_snippet_lines: snippetLines, content } = /** @type {Record<string, unknown>} */ (args)
        if (typeof query !== 'string' || query.trim() === '') {
          throw new TypeError('query must be a non-empty behaviour phrase')
        }
        const repos = normalizeRepos(repo)
        const argv = buildSearchArgs({ query, repos, top_k: topK, max_snippet_lines: snippetLines, content })
        return runToHits(argv, settings, exec, { query, repos })
      },
    },
    {
      name: 'semble_find_related',
      description:
        'Given one known location (a file and line from semble_search), find its siblings: other implementations of the same interface, the callers of a function, the tests for a class.',
      parameters: FIND_RELATED_PARAMETERS,
      timeoutMs: settings.toolTimeoutMs,
      output: {
        schema: { type: 'string' },
        /**
         * @param {unknown} _args
         * @param {string} value
         */
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      /**
       * @param {Record<string, unknown>} args
       * @param {{ signal?: AbortSignal }} [exec]
       */
      async execute(args, exec) {
        const { path, line, repo, top_k: topK, max_snippet_lines: snippetLines, content } = /** @type {Record<string, unknown>} */ (args)
        if (typeof path !== 'string' || path.trim() === '') {
          throw new TypeError('path must be the file path exactly as a search result showed it')
        }
        const repos = normalizeRepos(repo)
        const argv = buildFindRelatedArgs({ path, line, repos, top_k: topK, max_snippet_lines: snippetLines, content })
        return runToHits(argv, settings, exec, { query: `related to ${path}:${line}`, repos })
      },
    },
  ]
}
