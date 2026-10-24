/**
 * cordis.patch.yml ↔ lib consistency. The loader row's `config` is the
 * operator-facing source of the launcher settings, so the shipped values must
 * stay literally equal to the defaults lib/tools.js applies when the row
 * omits them.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { SEMBLE_UVX_PREFIX } from '../lib/cli.js'
import { DEFAULT_TOOL_TIMEOUT_MS, parseToolConfig } from '../lib/tools.js'

const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

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
})
