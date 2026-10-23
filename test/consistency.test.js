import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { SEMBLE_UVX_PREFIX } from '../lib/cli.js'

const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

/** The `args:` list of the MCP row, as literal strings. */
function patchArgs() {
  const block = patch.match(/args:\r?\n((?:[^\S\r\n]*- .*\r?\n?)+)/)
  assert.ok(block !== null, 'no args: list found in cordis.patch.yml')
  return block[1]
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => line.trim().replace(/^-\s*/, '').replace(/^'(.*)'$/, '$1'))
}

describe('cordis.patch.yml ↔ lib/cli.js', () => {
  it('launches /semble exactly the way the MCP row launches the server', () => {
    assert.match(patch, /command: uvx/)
    assert.deepEqual(patchArgs(), SEMBLE_UVX_PREFIX)
  })
})
