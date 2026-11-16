/**
 * cordis.patch.yml ↔ lib consistency. The loader row's `config` is the
 * operator-facing source of the launcher settings, so the shipped values must
 * stay literally equal to the defaults lib/tools.js applies when the row
 * omits them.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { SEMBLE_UVX_PREFIX } from '../lib/cli.js'
import { createSembleTools, DEFAULT_TOOL_TIMEOUT_MS, parseToolConfig } from '../lib/tools.js'
import sembleBundle, { Config } from '../lib/index.js'

const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const skillMarkdown = readFileSync(new URL('../skills/semble/SKILL.md', import.meta.url), 'utf8')
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const readmeZh = readFileSync(new URL('../README.zh-CN.md', import.meta.url), 'utf8')
const cliSource = readFileSync(new URL('../lib/cli.js', import.meta.url), 'utf8')
const toolsSource = readFileSync(new URL('../lib/tools.js', import.meta.url), 'utf8')
const indexSource = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
/** This checkout, in the host convention the tools receive as `repo`. */
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** The `args:` list of the anchor row's config, as literal strings. */
function patchArgs() {
  const block = patch.match(/args:\r?\n((?:[^\S\r\n]*- .*\r?\n?)+)/)
  assert.ok(block !== null, 'no args: list found in cordis.patch.yml')
  return block[1]
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => line.trim().replace(/^-\s*/, '').replace(/^'(.*)'$/, '$1'))
}

describe('cordis.patch.yml ↔ lib', () => {
  it('is a single anchor row for this package, with no MCP client row', () => {
    assert.doesNotMatch(patch, /dsh-mcp-client/)
    assert.doesNotMatch(patch, /failOnStartupError/)
    assert.doesNotMatch(patch, /toolCallTimeoutMs/)
    assert.match(patch, /name: 'dsh-semble'/)
    assert.equal(patch.match(/- id: .*$/gm)?.length, 1)
  })

  it('launches the tools exactly the way the shipped defaults do', () => {
    assert.match(patch, /command: uvx/)
    assert.deepEqual(patchArgs(), SEMBLE_UVX_PREFIX)
    const timeout = patch.match(/toolTimeoutMs: (\d+)/)
    assert.ok(timeout !== null, 'no toolTimeoutMs found in cordis.patch.yml')
    assert.equal(Number(timeout[1]), DEFAULT_TOOL_TIMEOUT_MS)
    assert.deepEqual(parseToolConfig({ command: 'uvx', args: patchArgs(), toolTimeoutMs: Number(timeout[1]) }), parseToolConfig(undefined))
  })

  it('declares no env defaults and no cwd', () => {
    assert.doesNotMatch(patch, /^\s+env:/m)
    assert.doesNotMatch(patch, /^\s+cwd:/m)
    assert.match(patch, /HF_ENDPOINT/)
  })

  it('carries the skills inject on the default export itself', () => {
    // Cordis reads the fiber's injected services from the callback's own
    // `inject` property; `unwrapExports` collapses this module to its default
    // export, so a module-level `export const inject` alone never reaches the
    // registry and every `ctx.skills` access throws "without inject".
    assert.ok(Array.isArray(sembleBundle.inject), 'default export carries no inject array')
    assert.ok(sembleBundle.inject.includes('skills'))
    assert.equal(sembleBundle.name, 'dsh-semble')
    assert.equal(sembleBundle.Config, Config)
  })

  it('documents repo fallback consistently across both READMEs and the skill', () => {
    for (const [label, doc] of [
      ['README.md', readme],
      ['README.zh-CN.md', readmeZh],
      ['SKILL.md', skillMarkdown],
    ]) {
      assert.match(doc, /defaultRepo/, `${label} must mention defaultRepo`)
      assert.doesNotMatch(doc, /Omitting `repo` fails|省略.*会失败/, `${label} still claims repo is always required`)
      assert.doesNotMatch(doc, /append `--content all`|追加 `--content all`/, `${label} still suggests appending CLI flags to args`)
    }
  })
})

describe('trigger routing scope (dsh-semble repository baseline)', () => {
  /** Collect the registered skill and tool definitions from the bundle. */
  function collectSurface() {
    /** @type {Array<Record<string, unknown>>} */
    const skills = []
    /** @type {import('../lib/tools.js').SembleToolDefinition[]} */
    const tools = []
    sembleBundle({
      skills: { register: (d) => (skills.push(d), () => {}) },
      inject: (deps, cb) => {
        if (deps.includes('tools')) {
          cb(/** @type {never} */ ({ tools: { register: (d) => (tools.push(d), () => {}) } }))
        }
      },
    })
    return { skill: skills[0], tools }
  }

  it('keeps SKILL.md frontmatter description in sync with the runtime skill catalog entry', () => {
    const { skill } = collectSurface()
    const match = /^---\r?\nname:\s*(.+)\r?\ndescription:\s*(.+)\r?\n---/.exec(skillMarkdown)
    assert.ok(match !== null, 'SKILL.md is missing YAML frontmatter')
    assert.equal(match[1].trim(), skill.name)
    assert.equal(match[2].trim(), skill.description)
  })

  it('exposes explicit positive trigger directives and negative boundaries on always-visible surfaces', () => {
    const { skill } = collectSurface()
    const [searchTool, findRelatedTool] = createSembleTools(parseToolConfig(undefined))
    const skillDesc = String(skill.description)

    // 0. DSH's session catalog renders `<name>: <description>` (dropping whenToUse)
    // and truncates around ~430 chars, so `description` itself must start with
    // "Use FIRST", stay concise (<350 chars), forbid guessing grep keywords, and
    // carry bilingual trigger terms.
    assert.match(skillDesc, /^Use FIRST /i)
    assert.ok(skillDesc.length <= 350, `skill.description is too long (${skillDesc.length} > 350) and risks catalog truncation`)
    assert.match(skillDesc, /do NOT guess keywords for grep/i)
    assert.match(skillDesc, /代码语义搜索/)
    assert.match(skillDesc, /grep\/ops is noisy\/empty/i)

    // 1. Imperative first-call directive for behaviour/unfamiliar code lookup.
    assert.match(searchTool.description, /Call this FIRST/i)
    assert.match(searchTool.description, /where\/how does X work/i)
    assert.match(searchTool.description, /do NOT guess keywords to grep first/i)
    assert.match(searchTool.description, /代码语义搜索/)
    assert.match(String(skill.whenToUse), /ALWAYS consult or use when/i)

    // 2. Immediate fallback directive when grep/glob/ops returns 0 hits or noisy matches.
    assert.match(searchTool.description, /switch to it immediately if a grep\/glob\/ops search returns zero hits or too much noise/i)
    assert.match(String(skill.whenToUse), /grep\/glob\/ops search returns no results or too many noisy matches/i)

    // 3. Pre-edit impact & sibling discovery directive on semble_find_related.
    assert.match(findRelatedTool.description, /before refactoring or editing/i)
    assert.match(findRelatedTool.description, /callers\/callees|other implementations|tests/i)
    assert.match(findRelatedTool.description, /关联代码搜索/)

    // 4. Negative boundary: only skip when the prompt already gives an exact identifier/file (never guessed).
    assert.match(searchTool.description, /never guessed from concepts/i)
    assert.match(searchTool.description, /call semble_find_related/i)
    assert.match(String(skill.whenToUse), /Skip only when the prompt already names an exact symbol literal or file path/i)
  })

  it('routes dsh-semble codebase tasks to the designed tool and resolves live repository symbols', async () => {
    /**
     * Reference routing policy matching the prompt instructions in lib/index.js,
     * lib/tools.js, and skills/semble/SKILL.md.
     *
     * @param {{
     *   intent: 'behaviour_query' | 'find_siblings_or_callers' | 'exact_identifier' | 'known_file_path',
     *   priorGrep?: 'none' | 'zero_hits' | 'noisy',
     * }} task
     */
    function selectTool(task) {
      if (task.intent === 'known_file_path') return 'read'
      if (task.intent === 'exact_identifier' && (!task.priorGrep || task.priorGrep === 'none')) {
        return 'grep'
      }
      if (task.intent === 'find_siblings_or_callers') return 'semble_find_related'
      if (
        task.intent === 'behaviour_query' ||
        task.priorGrep === 'zero_hits' ||
        task.priorGrep === 'noisy'
      ) {
        return 'semble_search'
      }
      return 'grep'
    }

    // Grounded scenario table built from actual modules in this repository.
    const scenarios = [
      {
        name: 'behaviour query: UTF-8 byte-capped output truncation',
        intent: /** @type {const} */ ('behaviour_query'),
        query: 'cap child process output at a byte limit without splitting multi-byte UTF-8 characters',
        expectedTool: 'semble_search',
        expectedFile: 'lib/cli.js',
        expectedSymbol: 'function decodeUtf8Prefix(buffer)',
        sourceText: cliSource,
      },
      {
        name: 'behaviour query: FIFO concurrency semaphore with AbortSignal cancellation',
        intent: /** @type {const} */ ('behaviour_query'),
        query: 'bound simultaneous CLI subprocesses with a FIFO semaphore and cancel queued waiters on abort',
        expectedTool: 'semble_search',
        expectedFile: 'lib/cli.js',
        expectedSymbol: 'function createSemaphore(limit)',
        sourceText: cliSource,
      },
      {
        name: 'fallback after noisy grep: loader config coercion to defaults',
        intent: /** @type {const} */ ('exact_identifier'),
        priorGrep: /** @type {const} */ ('noisy'),
        query: 'coerce mistyped loader row config fields back to shipped defaults',
        expectedTool: 'semble_search',
        expectedFile: 'lib/tools.js',
        expectedSymbol: 'export function parseToolConfig(raw)',
        sourceText: toolsSource,
      },
      {
        name: 'pre-edit impact check: find callers and tests for parseSembleArgs',
        intent: /** @type {const} */ ('find_siblings_or_callers'),
        path: 'lib/cli.js',
        line: 90,
        expectedTool: 'semble_find_related',
        expectedFile: 'lib/index.js',
        expectedSymbol: 'const parsed = parseSembleArgs(invocation.rawInput)',
        sourceText: indexSource,
      },
      {
        name: 'negative boundary: known exact constant identifier stays on grep',
        intent: /** @type {const} */ ('exact_identifier'),
        priorGrep: /** @type {const} */ ('none'),
        symbol: 'DEFAULT_MAX_CONCURRENT',
        expectedTool: 'grep',
      },
      {
        name: 'negative boundary: known file path stays on read',
        intent: /** @type {const} */ ('known_file_path'),
        path: 'cordis.patch.yml',
        expectedTool: 'read',
      },
    ]

    for (const scenario of scenarios) {
      const chosen = selectTool(scenario)
      assert.equal(chosen, scenario.expectedTool, `wrong routing for scenario: ${scenario.name}`)

      if (scenario.expectedSymbol && scenario.sourceText) {
        const lines = scenario.sourceText.split(/\r?\n/)
        const zeroIdx = lines.findIndex((line) => line.includes(scenario.expectedSymbol))
        assert.ok(
          zeroIdx !== -1,
          `expected symbol "${scenario.expectedSymbol}" to exist in ${scenario.expectedFile}`,
        )
        const startLine = zeroIdx + 1
        const endLine = Math.min(lines.length, startLine + 6)
        const snippet = lines.slice(zeroIdx, endLine).join('\n')

        // Verify the plugin's native tool executes and renders the live repository hit cleanly.
        const payload = JSON.stringify({
          query: scenario.query ?? `related to ${scenario.path}:${scenario.line}`,
          results: [
            {
              file_path: scenario.expectedFile,
              start_line: startLine,
              end_line: endLine,
              score: 0.0241,
              content: snippet,
            },
          ],
        })
        const [searchTool, findRelatedTool] = createSembleTools(
          parseToolConfig({
            command: process.execPath,
            args: ['-e', `process.stdout.write(${JSON.stringify(payload)})`],
          }),
        )

        const rendered =
          chosen === 'semble_search'
            ? await searchTool.execute({ query: scenario.query, repo: repoRoot })
            : await findRelatedTool.execute({
                path: scenario.path,
                line: scenario.line,
                repo: repoRoot,
              })

        assert.match(rendered, new RegExp(`${scenario.expectedFile}:${startLine}-${endLine}`))
        assert.ok(rendered.includes(scenario.expectedSymbol))
      }
    }
  })
})
