import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import sembleBundle, {
  apply,
  Config,
  handleSembleCommand,
  inject as pluginInject,
  name as pluginName,
} from '../lib/index.js'
import { DEFAULT_TOOL_TIMEOUT_MS, parseToolConfig } from '../lib/tools.js'

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
    const result = await handleSembleCommand({ rawInput: 'wipe' })
    assert.equal(result.kind, 'error')
    assert.match(result.text, /Unknown subcommand "wipe"/)
  })

  it('answers usage for a bare clear instead of clearing', async () => {
    const result = await handleSembleCommand({ rawInput: 'clear' })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /\/semble clear index/)
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

describe('sembleBundle', () => {
  /** A fake plugin context that records every registration and soft injection. */
  function fakeContext() {
    const state = { skills: [], tools: [], commands: [], scopes: [] }
    const ctx = {
      skills: { register: (definition) => (state.skills.push(definition), () => {}) },
      inject: (deps, callback) => {
        state.scopes.push(deps)
        const child = /** @type {Record<string, unknown>} */ ({})
        if (deps.includes('tools')) child.tools = { register: (d) => (state.tools.push(d), () => {}) }
        if (deps.includes('commands')) child.commands = { register: (d) => (state.commands.push(d), () => {}) }
        callback(/** @type {typeof ctx & typeof child} */ (/** @type {unknown} */ ({ ...ctx, ...child })))
      },
    }
    return { ctx, state }
  }

  it('registers the tools, the routing skill, and /semble via soft injections', () => {
    const { ctx, state } = fakeContext()

    sembleBundle(ctx)

    assert.deepEqual(state.scopes, [['tools'], ['commands']])

    assert.deepEqual(state.tools.map((definition) => definition.name), ['semble_search', 'semble_find_related'])
    for (const definition of state.tools) {
      assert.equal(typeof definition.description, 'string')
      assert.equal(definition.parameters.type, 'object')
      assert.equal(definition.timeoutMs, DEFAULT_TOOL_TIMEOUT_MS)
      assert.deepEqual(definition.output.schema, { type: 'string' })
      assert.equal(typeof definition.execute, 'function')
    }

    assert.equal(state.skills.length, 1)
    assert.equal(state.skills[0].name, 'semble-code-search')
    assert.equal(state.skills[0].source, 'bundle:dsh-semble')
    assert.match(state.skills[0].resourceBase.description, /semble_search and semble_find_related/)

    assert.equal(state.commands.length, 1)
    assert.equal(state.commands[0].name, 'semble')
    assert.equal(typeof state.commands[0].handler, 'function')
    assert.ok(state.commands[0].input.hint.length > 0)
  })

  it('applies the loader row config to the registered tools', () => {
    const { ctx, state } = fakeContext()

    sembleBundle(ctx, { toolTimeoutMs: 250_000, command: 'semble.exe', args: ['--from', 'semble[mcp]', 'semble'] })

    for (const definition of state.tools) {
      assert.equal(definition.timeoutMs, 250_000)
    }
  })

  it('keeps working without an inject function', () => {
    const skills = []
    const fakeCtx = {
      skills: { register: (definition) => (skills.push(definition), () => {}) },
      // No `inject`: a composition with neither a tool registry nor a command
      // surface must still get the routing skill, and must not throw.
    }

    sembleBundle(fakeCtx)

    assert.equal(skills.length, 1)
  })

  it('strips the YAML frontmatter from the registered skill body', () => {
    const { ctx, state } = fakeContext()

    sembleBundle(ctx)

    assert.ok(!state.skills[0].content.startsWith('---'))
    assert.match(state.skills[0].content, /^# Semble code search/)
  })

  it('runs /semble through the same launcher settings as the tools', async () => {
    const { ctx, state } = fakeContext()

    sembleBundle(ctx, {
      command: process.execPath,
      args: ['-e', 'process.stdout.write("configured:" + process.env.DSH_SEMBLE_PROBE)', '--'],
      env: { DSH_SEMBLE_PROBE: 'ok' },
      toolTimeoutMs: 5_000,
      maxConcurrent: 3,
    })

    const result = await state.commands[0].handler({ rawInput: 'savings' })
    assert.deepEqual(result, { kind: 'success', text: 'configured:ok' })
  })

  it('exposes a Standard Schema and a consistent export shape', () => {
    assert.equal(pluginName, 'dsh-semble')
    assert.deepEqual(pluginInject, ['skills'])
    assert.equal(apply, sembleBundle)
    assert.equal(sembleBundle.name, 'dsh-semble')
    assert.equal(sembleBundle.Config, Config)

    const validated = Config['~standard'].validate(undefined)
    assert.equal(validated.issues, undefined)
    assert.equal(validated.value, undefined)
  })

  it('reports malformed config fields as Standard Schema issues', () => {
    const result = Config['~standard'].validate({
      command: 42,
      args: 'not-a-list',
      toolTimeoutMs: -1,
      maxConcurrent: 0,
      defaultContent: 'bogus',
      defaultRepo: '',
      env: { BROKEN: 7 },
    })

    assert.equal(result.value, undefined)
    const messages = result.issues.map((issue) => issue.message)
    assert.ok(messages.includes('command must be a non-empty string'))
    assert.ok(messages.includes('args must be a non-empty list of strings'))
    assert.ok(messages.includes('toolTimeoutMs must be a positive number'))
    assert.ok(messages.includes('maxConcurrent must be a positive number (>= 1)'))
    assert.ok(messages.includes('defaultContent must be a non-empty list of code/docs/config/all'))
    assert.ok(messages.includes('defaultRepo must be a non-empty string'))
    assert.ok(messages.includes('env.BROKEN must be a string'))
  })

  it('accepts a fully valid config without issues', () => {
    const raw = {
      command: 'uvx',
      args: ['--from', 'semble', 'semble'],
      toolTimeoutMs: 300000,
      maxConcurrent: 4,
      defaultContent: ['code', 'docs'],
      defaultRepo: '/work/repo',
      env: { HF_ENDPOINT: 'https://hf-mirror.com' },
    }
    const result = Config['~standard'].validate(raw)
    assert.equal(result.issues, undefined)
    // Validation must not rewrite the value: `apply` normalizes it once, and a
    // normalized value fed back through parseToolConfig warns about its own
    // `null` placeholders.
    assert.deepEqual(result.value, raw)
  })

  it('hands apply a config that parses without warnings', () => {
    const raw = { command: 'uvx', args: ['--from', 'semble', 'semble'], maxConcurrent: 2 }
    const warnings = []
    const original = console.warn
    console.warn = (...args) => warnings.push(args.join(' '))
    try {
      parseToolConfig(Config['~standard'].validate(raw).value)
    } finally {
      console.warn = original
    }
    assert.deepEqual(warnings, [])
  })

  it('rejects a non-object config', () => {
    const result = Config['~standard'].validate('uvx')
    assert.deepEqual(result.issues, [{ message: 'config must be an object' }])
    assert.equal(result.value, undefined)
  })
})
