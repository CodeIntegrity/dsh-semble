import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CAPTURE_LIMIT_BYTES, parseSembleArgs, runSemble, SEMBLE_USAGE } from '../lib/cli.js'

/** `node -e <script>` is a portable stand-in for `uvx --from semble[mcp] semble`. */
const NODE_PREFIX = ['-e']

describe('parseSembleArgs', () => {
  it('maps the allow-listed subcommands', () => {
    assert.deepEqual(parseSembleArgs('savings'), { kind: 'run', argv: ['savings'] })
    assert.deepEqual(parseSembleArgs('  file-types  '), { kind: 'run', argv: ['file-types'] })
    assert.deepEqual(parseSembleArgs('version'), { kind: 'run', argv: ['--version'] })
  })

  it('shows usage for empty input', () => {
    assert.deepEqual(parseSembleArgs(''), { kind: 'usage' })
    assert.deepEqual(parseSembleArgs(undefined), { kind: 'usage' })
    assert.deepEqual(parseSembleArgs('   '), { kind: 'usage' })
  })

  it('rejects anything outside the allow-list, including extra words', () => {
    assert.deepEqual(parseSembleArgs('clear'), { kind: 'unknown', name: 'clear' })
    assert.deepEqual(parseSembleArgs('savings --format json'), {
      kind: 'unknown',
      name: 'savings --format json',
    })
    assert.deepEqual(parseSembleArgs('rm -rf /'), { kind: 'unknown', name: 'rm -rf /' })
  })

  it('keeps the usage text free of ANSI escapes', () => {
    assert.match(SEMBLE_USAGE, /savings/)
    assert.match(SEMBLE_USAGE, /file-types/)
    assert.doesNotMatch(SEMBLE_USAGE, /\u001B\[/)
  })
})

describe('runSemble', () => {
  it('captures stdout from a successful child', async () => {
    const result = await runSemble(['process.stdout.write("hello")'], {
      command: process.execPath,
      prefix: NODE_PREFIX,
    })
    assert.equal(result.code, 0)
    assert.equal(result.stdout, 'hello')
    assert.equal(result.stderr, '')
    assert.equal(result.error, undefined)
  })

  it('reports a non-zero exit with its stderr', async () => {
    const result = await runSemble(['process.stderr.write("oops"); process.exit(3)'], {
      command: process.execPath,
      prefix: NODE_PREFIX,
    })
    assert.equal(result.code, 3)
    assert.match(result.stderr, /oops/)
  })

  it('surfaces a missing executable as an error instead of throwing', async () => {
    const result = await runSemble([], { command: 'dsh-semble-definitely-not-installed' })
    assert.equal(result.code, null)
    assert.match(result.error ?? '', /ENOENT|not found/i)
  })

  it('gives up on a child that outlives the timeout', async () => {
    const result = await runSemble(['setTimeout(() => {}, 5000)'], {
      command: process.execPath,
      prefix: NODE_PREFIX,
      timeoutMs: 200,
    })
    assert.equal(result.timedOut, true)
    assert.equal(result.code, null)
  })

  it('kills the child when the invocation is aborted', async () => {
    const controller = new AbortController()
    const pending = runSemble(['setTimeout(() => {}, 5000)'], {
      command: process.execPath,
      prefix: NODE_PREFIX,
      signal: controller.signal,
    })
    controller.abort()
    const result = await pending
    assert.equal(result.aborted, true)
  })

  it('caps oversized stdout at the byte limit and marks the cut', async () => {
    const result = await runSemble([`process.stdout.write("x".repeat(${300 * 1024}))`], {
      command: process.execPath,
      prefix: NODE_PREFIX,
    })
    assert.equal(result.code, 0)
    assert.ok(result.stdout.startsWith('x'.repeat(CAPTURE_LIMIT_BYTES)))
    assert.match(result.stdout, /output truncated by dsh-semble/)
  })

  it('never splits a multi-byte character at the cut', async () => {
    // '你' takes 3 UTF-8 bytes and CAPTURE_LIMIT_BYTES = 3 * 87381 + 1, so the
    // leftover byte of character 87382 must be dropped, not decoded into garbage.
    const result = await runSemble(['process.stdout.write("你".repeat(200000))'], {
      command: process.execPath,
      prefix: NODE_PREFIX,
    })
    assert.ok(result.stdout.startsWith('你'.repeat(87381)))
    assert.ok(!result.stdout.includes('你'.repeat(87382)))
    assert.ok(!result.stdout.includes('\uFFFD'))
    assert.match(result.stdout, /output truncated by dsh-semble/)
  })

  it('passes the caller environment through to the child', async () => {
    const script = 'console.log(process.env.DSH_SEMBLE_PROBE, process.env.NO_COLOR)'
    const result = await runSemble([script], {
      command: process.execPath,
      prefix: NODE_PREFIX,
      env: { DSH_SEMBLE_PROBE: '42' },
    })
    assert.equal(result.stdout.trim(), '42 1')
  })
})
