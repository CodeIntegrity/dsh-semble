import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import sembleMcpBundle, { handleSembleCommand } from '../lib/index.js'

describe('handleSembleCommand', () => {
  it('answers usage without spawning anything', async () => {
    const result = await handleSembleCommand({ rawInput: '' })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /\/semble savings/)
  })

  it('rejects an unknown subcommand with the usage text', async () => {
    const result = await handleSembleCommand({ rawInput: 'clear' })
    assert.equal(result.kind, 'error')
    assert.match(result.text, /Unknown subcommand "clear"/)
  })
})

describe('sembleMcpBundle', () => {
  it('registers the routing skill and the /semble command once commands exist', () => {
    const skills = []
    const commands = []
    const scopes = []

    const fakeCtx = {
      skills: { register: (definition) => (skills.push(definition), () => {}) },
      inject: (deps, callback) => {
        scopes.push(deps)
        callback({ commands: { register: (definition) => (commands.push(definition), () => {}) } })
      },
    }

    sembleMcpBundle(fakeCtx)

    assert.deepEqual(scopes, [['commands']])
    assert.equal(skills.length, 1)
    assert.equal(skills[0].name, 'semble-code-search')
    assert.equal(skills[0].source, 'bundle:dsh-semble')

    assert.equal(commands.length, 1)
    assert.equal(commands[0].name, 'semble')
    assert.equal(typeof commands[0].handler, 'function')
    assert.ok(commands[0].input.hint.length > 0)
  })

  it('keeps working without a command surface', () => {
    const skills = []
    const fakeCtx = {
      skills: { register: (definition) => (skills.push(definition), () => {}) },
      // No `inject`: a composition that only loads the MCP client must still get
      // the routing skill, and must not throw.
    }

    sembleMcpBundle(fakeCtx)

    assert.equal(skills.length, 1)
  })
})
