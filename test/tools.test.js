/**
 * Tests for the native tool layer: config coercion, argv construction,
 * `--format json` parsing, rendering, and the tool definitions' failure
 * mapping. Everything runs against a node stand-in child process injected
 * through the plugin config — no uvx or network is needed.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_TOOL_TIMEOUT_MS,
  parseToolConfig,
  buildSearchArgs,
  buildFindRelatedArgs,
  parseSearchOutput,
  renderHits,
  createSembleTools,
} from '../lib/tools.js'
import { SEMBLE_UVX_PREFIX } from '../lib/cli.js'

/** One hit exactly as `semble search --format json` reported it on 0.7.0. */
const CLI_SHAPE = {
  query: 'register tool definitions',
  results: [
    {
      file_path: 'lib\\index.js',
      start_line: 63,
      end_line: 89,
      score: 0.0195,
      content: 'ctx.inject(["tools"], (tools) => { ... })',
    },
    {
      file_path: 'lib\\cli.js',
      start_line: 40,
      end_line: 58,
      score: 0.0082,
      content: 'export const SEMBLE_UVX_PREFIX = ...',
    },
  ],
}

test('parseToolConfig falls back to shipped defaults', () => {
  assert.deepEqual(parseToolConfig(undefined), {
    command: 'uvx',
    args: SEMBLE_UVX_PREFIX,
    env: {},
    toolTimeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
  })
  assert.deepEqual(parseToolConfig('nonsense'), parseToolConfig(undefined))
  assert.deepEqual(parseToolConfig([]), parseToolConfig(undefined))
})

test('parseToolConfig keeps valid overrides', () => {
  const config = parseToolConfig({
    command: 'semble.exe',
    args: ['search-proxy'],
    env: { HF_ENDPOINT: 'https://hf-mirror.com', BROKEN: 42 },
    toolTimeoutMs: 600_000,
  })
  assert.equal(config.command, 'semble.exe')
  assert.deepEqual(config.args, ['search-proxy'])
  assert.deepEqual(config.env, { HF_ENDPOINT: 'https://hf-mirror.com' })
  assert.equal(config.toolTimeoutMs, 600_000)
})

test('parseToolConfig survives mistyped fields', () => {
  const config = parseToolConfig({
    command: 7,
    args: ['ok', 42],
    toolTimeoutMs: -1,
    env: 'HF_ENDPOINT=https://example.com',
  })
  assert.equal(config.command, 'uvx')
  assert.deepEqual(config.args, SEMBLE_UVX_PREFIX)
  assert.equal(config.toolTimeoutMs, DEFAULT_TOOL_TIMEOUT_MS)
  assert.deepEqual(config.env, {})
})

test('buildSearchArgs matches the documented CLI invocation', () => {
  const argv = buildSearchArgs({
    query: 'persist a chunk',
    repos: ['D:\\work\\repo'],
    top_k: 5,
    max_snippet_lines: 10,
    content: ['code'],
  })
  assert.deepEqual(argv, [
    'search', 'persist a chunk', 'D:\\work\\repo',
    '-k', '5',
    '--max-snippet-lines', '10',
    '--content', 'code',
    '--format', 'json',
  ])
})

test('buildSearchArgs handles several repos, content lists and overrides', () => {
  const argv = buildSearchArgs({
    query: 'q',
    repos: ['/home/me/repo-a', '/home/me/repo-b'],
    top_k: 20,
    max_snippet_lines: 0,
    content: ['docs', 'config', 'docs'],
  })
  assert.deepEqual(argv, [
    'search', 'q', '/home/me/repo-a', '/home/me/repo-b',
    '-k', '20',
    '--max-snippet-lines', '0',
    '--content', 'docs', 'config',
    '--format', 'json',
  ])
})

test('buildSearchArgs clamps out-of-range values to CLI-safe numbers', () => {
  const argv = buildSearchArgs({ query: 'q', repos: ['.'], top_k: 5_000, max_snippet_lines: -7, content: [] })
  assert.equal(argv[argv.indexOf('-k') + 1], '100')
  assert.equal(argv[argv.indexOf('--max-snippet-lines') + 1], '0')
  assert.deepEqual(argv.slice(argv.indexOf('--content') + 1, argv.indexOf('--format')), ['code'])
})

test('buildFindRelatedArgs puts path, line, then repos', () => {
  const argv = buildFindRelatedArgs({
    path: 'lib\\index.js',
    line: 63,
    repos: ['D:\\work\\repo'],
    top_k: 5,
    max_snippet_lines: 10,
    content: ['code'],
  })
  assert.deepEqual(argv, [
    'find-related', 'lib\\index.js', '63', 'D:\\work\\repo',
    '-k', '5',
    '--max-snippet-lines', '10',
    '--content', 'code',
    '--format', 'json',
  ])
})

test('parseSearchOutput accepts the observed CLI shape', () => {
  const hits = parseSearchOutput(JSON.stringify(CLI_SHAPE))
  assert.equal(hits.length, 2)
  assert.deepEqual(hits[0], {
    file_path: 'lib\\index.js',
    start_line: 63,
    end_line: 89,
    score: 0.0195,
    content: 'ctx.inject(["tools"], (tools) => { ... })',
  })
})

test('parseSearchOutput keeps hits with missing optional fields and drops shapeless ones', () => {
  const hits = parseSearchOutput(JSON.stringify({
    results: [
      { file_path: 'a.ts' },
      { start_line: 3 },
      'junk',
    ],
  }))
  assert.equal(hits.length, 1)
  assert.equal(hits[0].file_path, 'a.ts')
  assert.equal(hits[0].start_line, null)
  assert.equal(hits[0].content, '')
})

test('parseSearchOutput rejects non-JSON and result-less payloads', () => {
  assert.throws(() => parseSearchOutput('Traceback (most recent call last): ...'), /not JSON/)
  assert.throws(() => parseSearchOutput('{"query": "x"}'), /"results"/)
  assert.throws(() => parseSearchOutput('[1, 2, 3]'), /"results"/)
})

test('renderHits renders file:line headers, scores and fenced snippets', () => {
  const hits = parseSearchOutput(JSON.stringify(CLI_SHAPE))
  const text = renderHits('register tool definitions', ['D:\\work\\repo'], hits)
  assert.match(text, /^2 hit\(s\) for "register tool definitions" in D:\\work\\repo:/)
  assert.match(text, /lib\\index\.js:63-89 {2}score 0\.0195/)
  assert.match(text, /lib\\cli\.js:40-58 {2}score 0\.0082/)
  assert.match(text, /```\nctx\.inject\(\["tools"\]/)
  assert.equal(text.includes('"results"'), false)
})

test('renderHits gives guidance on an empty result', () => {
  const text = renderHits('zzz-nothing', ['/repo'], [])
  assert.match(text, /^No hits for "zzz-nothing" in \/repo\./)
  assert.match(text, /content \["all"\]/)
})

test('createSembleTools yields exactly the two registry-ready definitions', () => {
  const [search, findRelated] = createSembleTools(parseToolConfig(undefined))
  assert.equal(search.name, 'semble_search')
  assert.equal(findRelated.name, 'semble_find_related')
  for (const definition of [search, findRelated]) {
    assert.equal(typeof definition.description, 'string')
    assert.equal(definition.parameters.type, 'object')
    assert.equal(definition.timeoutMs, DEFAULT_TOOL_TIMEOUT_MS)
    assert.deepEqual(definition.output.schema, { type: 'string' })
    assert.deepEqual(definition.output.render(null, 'text'), [{ type: 'text', text: 'text' }])
    assert.equal(typeof definition.execute, 'function')
  }
  assert.deepEqual(search.parameters.required, ['query', 'repo'])
  assert.deepEqual(findRelated.parameters.required, ['path', 'line', 'repo'])
  assert.deepEqual(
    Object.keys(search.parameters.properties).sort(),
    ['content', 'max_snippet_lines', 'query', 'repo', 'top_k'],
  )
  assert.deepEqual(
    Object.keys(findRelated.parameters.properties).sort(),
    ['content', 'line', 'max_snippet_lines', 'path', 'repo', 'top_k'],
  )
  assert.deepEqual(search.parameters.properties.repo.oneOf.map((branch) => branch.type), ['string', 'array'])
})

/** Tools whose child process is a node stand-in printing the given script. */
function standInTools(script, extraConfig = {}) {
  return createSembleTools(parseToolConfig({
    command: process.execPath,
    args: ['-e', script],
    toolTimeoutMs: 15_000,
    ...extraConfig,
  }))
}

test('execute renders hits from a node stand-in that prints the CLI JSON shape', async () => {
  const [search] = standInTools(`console.log(JSON.stringify(${JSON.stringify(CLI_SHAPE)}))`)
  const text = await search.execute({ query: 'register tool definitions', repo: 'D:\\work\\repo' })
  assert.match(text, /^2 hit\(s\)/)
  assert.match(text, /lib\\index\.js:63-89/)
})

test('execute reports a non-zero exit with the child stderr', async () => {
  const [search] = standInTools('console.error("semulation failure"); process.exit(3)')
  await assert.rejects(
    () => search.execute({ query: 'q', repo: 'D:\\work\\repo' }),
    /exited with code 3[\s\S]*semulation failure/,
  )
})

test('execute reports a failed launch as an actionable error', async () => {
  const [search] = standInTools('', { command: 'definitely-not-a-real-exe-4f2a' })
  await assert.rejects(
    () => search.execute({ query: 'q', repo: 'D:\\work\\repo' }),
    /could not be started[\s\S]*Install uv/,
  )
})

test('execute reports a timeout with the toolTimeoutMs hint', async () => {
  const [search] = standInTools('setInterval(() => {}, 1000)', { toolTimeoutMs: 250 })
  await assert.rejects(
    () => search.execute({ query: 'q', repo: 'D:\\work\\repo' }),
    /did not finish within|time limit/,
  )
})

test('execute reports malformed CLI output instead of crashing on JSON.parse', async () => {
  const [search] = standInTools('console.log("<html>not json</html>")')
  await assert.rejects(
    () => search.execute({ query: 'q', repo: 'D:\\work\\repo' }),
    /not JSON/,
  )
})

test('find-related execute reaches the stand-in and renders its hits', async () => {
  const [, findRelated] = standInTools(`console.log(JSON.stringify(${JSON.stringify(CLI_SHAPE)}))`)
  const text = await findRelated.execute({ path: 'lib\\index.js', line: 63, repo: ['D:\\work\\repo'] })
  assert.match(text, /^2 hit\(s\) for "related to lib\\index\.js:63"/)
  assert.match(text, /lib\\index\.js:63-89/)
})

test('execute rejects a repo-less call before spawning anything', async () => {
  const [search] = standInTools('')
  await assert.rejects(() => search.execute({ query: 'q' }), /repo must be/)
  const [, findRelated] = standInTools('')
  await assert.rejects(() => findRelated.execute({ path: 'a.ts', line: 1 }), /repo must be/)
})
