import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import sembleMcpBundle, { handleSembleCommand } from '../lib/index.js'

/** `node -e savings` replaces uvx, so the handler branches run without an install. */
const NODE_RUNNER = { command: process.execPath, prefix: ['-e'] }

/** Same substitution, but the script ignores the appended subcommand and hangs. */
const HANGING_RUNNER = { command: process.execPath, prefix: ['-e', 'setTimeout(() => {}, 5000)', '--'] }

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

  it('returns CLI output on success', async () => {
    const result = await handleSembleCommand(
      { rawInput: 'savings' },
      { command: process.execPath, prefix: ['-e', 'process.stdout.write("ok")', '--'] },
    )
    assert.equal(result.kind, 'success')
    assert.equal(result.text, 'ok')
  })

  it('renders a non-zero exit as an error result', async () => {
    const result = await handleSembleCommand({ rawInput: 'savings' }, NODE_RUNNER)
    assert.equal(result.kind, 'error')
    assert.match(result.text, /exited with code 1/)
    assert.match(result.text, /savings is not defined/)
  })

  it('explains how to recover when the CLI cannot start', async () => {
    const result = await handleSembleCommand(
      { rawInput: 'savings' },
      { command: 'dsh-semble-definitely-not-installed' },
    )
    assert.equal(result.kind, 'error')
    assert.match(result.text, /Could not start the Semble CLI/)
    assert.match(result.text, /docs\.astral\.sh\/uv/)
    assert.match(result.text, /uvx\.exe/)
  })

  it('surfaces a timeout as an error result', async () => {
    const result = await handleSembleCommand(
      { rawInput: 'savings' },
      { ...HANGING_RUNNER, timeoutMs: 200 },
    )
    assert.equal(result.kind, 'error')
    assert.match(result.text, /did not finish within its time limit/)
  })

  it('reports a cancelled run', async () => {
    const controller = new AbortController()
    const pending = handleSembleCommand(
      { rawInput: 'savings', signal: controller.signal },
      HANGING_RUNNER,
    )
    controller.abort()
    const result = await pending
    assert.equal(result.kind, 'error')
    assert.match(result.text, /cancelled/)
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

  it('strips the YAML frontmatter from the registered skill body', () => {
    const skills = []
    const fakeCtx = {
      skills: { register: (definition) => (skills.push(definition), () => {}) },
    }

    sembleMcpBundle(fakeCtx)

    assert.ok(!skills[0].content.startsWith('---'))
    assert.match(skills[0].content, /^# Semble code search/)
  })
})
