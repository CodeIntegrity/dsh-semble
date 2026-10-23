/**
 * Runner for the Semble command line, used by the `/semble` command.
 *
 * The bundle talks to Semble through MCP for search, but a few reports only
 * exist in the CLI: token savings (`semble savings`) and the indexed file
 * types (`semble file-types`). Those are read-only and cheap, so the command
 * shells out to the same uvx installation the MCP server uses.
 *
 * Output is captured through temporary files rather than pipes: pipes make a
 * sandboxed host refuse the spawn (EPERM on the named pipe), while file
 * descriptors keep `/semble` working wherever the plugin loads, and a file also
 * bounds the capture without stalling the child on a full pipe buffer.
 *
 * Only an allow-list is reachable from the command. Destructive subcommands
 * such as `clear` stay out on purpose: a slash command has no confirmation
 * step, and the cache it would delete is what makes the next search fast.
 */

import { spawn } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** How the MCP row launches Semble; kept identical so both share one install. */
export const SEMBLE_UVX_PREFIX = ['--from', 'semble[mcp]', 'semble']

/** Bumped from the MCP client's 60 s default: savings only reads a jsonl file. */
export const DEFAULT_TIMEOUT_MS = 60_000

/** Trace reports are tiny; a cap keeps a runaway child from filling the transcript. */
export const CAPTURE_LIMIT_BYTES = 256 * 1024

const TRUNCATED = '\n… output truncated by dsh-semble …\n'

/** Subcommands exposed by `/semble`, mapped to the argv handed to Semble. */
const SUBCOMMANDS = new Map([
  ['savings', ['savings']],
  ['file-types', ['file-types']],
])

/**
 * Parse the raw text typed after `/semble`.
 *
 * Strict on purpose: an unknown token is reported instead of being forwarded,
 * so the command can never reach a subcommand the allow-list excludes.
 *
 * @param {string | undefined} rawInput
 * @returns {{ kind: 'usage' } | { kind: 'unknown', name: string } | { kind: 'run', argv: string[] }}
 */
export function parseSembleArgs(rawInput) {
  const input = typeof rawInput === 'string' ? rawInput.trim() : ''
  if (input === '') {
    return { kind: 'usage' }
  }

  const [name, ...extra] = input.split(/\s+/)
  const argv = SUBCOMMANDS.get(name)
  if (argv === undefined || extra.length > 0) {
    return { kind: 'unknown', name: input }
  }

  return { kind: 'run', argv: [...argv] }
}

/**
 * Run one Semble CLI invocation and capture its output.
 *
 * Never rejects: every failure mode (missing uvx, timeout, abort, non-zero
 * exit) is reported in the resolved value so the command can render it.
 *
 * @param {string[]} argv
 * @param {{ timeoutMs?: number, signal?: AbortSignal, command?: string, prefix?: string[], env?: Record<string, string> }} [options]
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string, timedOut?: boolean, aborted?: boolean, error?: string }>}
 */
export function runSemble(argv, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    command = 'uvx',
    prefix = SEMBLE_UVX_PREFIX,
    env,
  } = options

  if (signal?.aborted) {
    return Promise.resolve({ code: null, stdout: '', stderr: '', aborted: true })
  }

  let capture
  try {
    capture = openCapture()
  } catch (error) {
    return Promise.resolve({ code: null, stdout: '', stderr: '', error: messageOf(error) })
  }

  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, [...prefix, ...argv], {
        // NO_COLOR/FORCE_COLOR keep ANSI escapes out of the transcript; the rest
        // of the environment is inherited so SEMBLE_* tuning applies.
        env: { ...process.env, ...env, NO_COLOR: '1', FORCE_COLOR: '0' },
        stdio: ['ignore', capture.stdoutFd, capture.stderrFd],
        windowsHide: true,
      })
    } catch (error) {
      capture.dispose()
      resolve({ code: null, stdout: '', stderr: '', error: messageOf(error) })
      return
    }

    let timedOut = false
    let aborted = false
    let settled = false

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      const { stdout, stderr } = capture.collect()
      capture.dispose()
      resolve({ ...result, stdout, stderr })
    }

    const kill = () => {
      child.kill('SIGTERM')
      // A child that ignores SIGTERM must not outlive the command; the
      // unref'd escalation is dropped once the event loop is done with it.
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref?.()
    }

    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, timeoutMs)

    function onAbort() {
      aborted = true
      kill()
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })

    child.on('error', (error) => finish({ code: null, error: messageOf(error) }))
    child.on('close', (code, closeSignal) =>
      finish({
        code: typeof code === 'number' ? code : null,
        timedOut,
        aborted,
        ...(closeSignal ? { signal: closeSignal } : {}),
      }),
    )
  })
}

/**
 * A private directory holding the child's two output streams.
 *
 * The descriptors stay open for the child's lifetime and are closed before the
 * files are read, so a child that writes until its last moment (or is killed)
 * still leaves a complete prefix behind.
 */
function openCapture() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-semble-'))
  const stdoutPath = join(dir, 'stdout.log')
  const stderrPath = join(dir, 'stderr.log')

  const stdoutFd = openSync(stdoutPath, 'w')
  let stderrFd
  try {
    stderrFd = openSync(stderrPath, 'w')
  } catch (error) {
    closeSync(stdoutFd)
    rmSync(dir, { recursive: true, force: true })
    throw error
  }

  return {
    stdoutFd,
    stderrFd,
    collect() {
      closeSync(stdoutFd)
      closeSync(stderrFd)
      return { stdout: readCapped(stdoutPath), stderr: readCapped(stderrPath) }
    },
    dispose() {
      try {
        closeSync(stdoutFd)
      } catch {}
      try {
        closeSync(stderrFd)
      } catch {}
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** Read at most CAPTURE_LIMIT_BYTES and mark the cut, so output stays bounded. */
function readCapped(path) {
  try {
    if (statSync(path).size === 0) return ''
    const text = readFileSync(path, 'utf8')
    return text.length > CAPTURE_LIMIT_BYTES ? text.slice(0, CAPTURE_LIMIT_BYTES) + TRUNCATED : text
  } catch {
    return ''
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Text shown for `/semble` with no argument, and after an unknown one. */
export const SEMBLE_USAGE = [
  'Semble CLI reports',
  '',
  '  /semble savings      tokens saved by snippets instead of whole files',
  '  /semble file-types   file extensions Semble indexes, per content type',
  '',
  'Runs the same uvx installation the MCP server uses. Cache maintenance stays in a',
  'terminal: uvx --from "semble[mcp]" semble clear --help',
].join('\n')
