/**
 * Runner for the Semble command line, used by both the native search tools and
 * the `/semble` command.
 *
 * Every Semble call in the bundle shells out to the same uvx installation:
 * `uvx --from "semble[mcp]" semble <subcommand> ...`. The tools pass
 * `--format json` and parse the result (lib/tools.js); the reports paste the
 * text straight into the transcript.
 *
 * Output is captured through temporary files rather than pipes: pipes make a
 * sandboxed host refuse the spawn (EPERM on the named pipe), while file
 * descriptors keep `/semble` working wherever the plugin loads, and a file also
 * bounds the capture without stalling the child on a full pipe buffer.
 *
 * Only an allow-list is reachable from the command. `clear` is on the list but
 * guarded: it requires an explicit target (`index`, `savings`, `orphans`,
 * `all`) typed by the person, a bare `/semble clear` only prints the usage, and
 * no other destructive surface is forwarded.
 */

import { spawn } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Overrides for a `runSemble` invocation. Tests substitute `command` and
 * `prefix` with a node stand-in instead of relying on a uvx install.
 *
 * @typedef {object} RunSembleOptions
 * @property {number} [timeoutMs] Kill the child after this many milliseconds.
 * @property {AbortSignal} [signal] Abort the run; the child is killed.
 * @property {string} [command] Executable to launch; defaults to `uvx`.
 * @property {string[]} [prefix] Arguments placed before the Semble subcommand.
 * @property {Record<string, string>} [env] Variables layered onto the inherited environment.
 */

/**
 * @typedef {object} RunSembleResult
 * @property {number | null} code Exit status, or `null` when the child never ran or died by signal.
 * @property {string} stdout Captured output, capped at CAPTURE_LIMIT_BYTES bytes.
 * @property {string} stderr Captured diagnostics, capped the same way.
 * @property {boolean} [timedOut] True when the child outlived `timeoutMs`.
 * @property {boolean} [aborted] True when the caller's signal fired mid-run.
 * @property {string} [error] Why the child could not start at all.
 * @property {string} [signal] Name of the signal that killed the child, when close reports one.
 */

/** How uvx launches Semble: resolve the `semble[mcp]` extra, run its CLI. */
export const SEMBLE_UVX_PREFIX = ['--from', 'semble[mcp]', 'semble']

/** Reports only read local files, so they stay at 60 s; the search tools carry
 * their own longer ceiling for cold-start indexing (lib/tools.js). */
export const DEFAULT_TIMEOUT_MS = 60_000

/** Trace reports are tiny; a cap keeps a runaway child from filling the transcript. */
export const CAPTURE_LIMIT_BYTES = 256 * 1024

const TRUNCATED = '\n… output truncated by dsh-semble …\n'

/** Subcommands exposed by `/semble`, mapped to the argv handed to Semble. */
const SUBCOMMANDS = new Map([
  ['savings', ['savings']],
  ['file-types', ['file-types']],
  ['version', ['--version']],
])

/** The targets `semble clear` accepts, per its own usage. */
const CLEAR_TARGETS = new Set(['all', 'index', 'savings', 'orphans'])

/**
 * Parse the raw text typed after `/semble`.
 *
 * Strict on purpose: an unknown token is reported instead of being forwarded,
 * so the command can never reach a subcommand the allow-list excludes. A bare
 * `clear` shows the usage rather than deleting anything — the destructive call
 * must name its target explicitly.
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
  if (name === 'clear') {
    if (extra.length !== 1 || !CLEAR_TARGETS.has(extra[0])) {
      return { kind: 'usage' }
    }
    return { kind: 'run', argv: ['clear', extra[0]] }
  }

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
 * @param {RunSembleOptions} [options]
 * @returns {Promise<RunSembleResult>}
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

    /** @param {Omit<RunSembleResult, 'stdout' | 'stderr'>} result */
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
 *
 * @returns {{
 *   stdoutFd: number,
 *   stderrFd: number,
 *   collect(): { stdout: string, stderr: string },
 *   dispose(): void,
 * }}
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
    closeQuietly(stdoutFd)
    removeDir(dir)
    throw error
  }

  return {
    stdoutFd,
    stderrFd,
    // collect() and dispose() run inside child-process event handlers: an
    // error escaping there is an uncaughtException that takes the whole host
    // process down, so every step must be total (never throw).
    collect() {
      closeQuietly(stdoutFd)
      closeQuietly(stderrFd)
      return { stdout: readCapped(stdoutPath), stderr: readCapped(stderrPath) }
    },
    dispose() {
      closeQuietly(stdoutFd)
      closeQuietly(stderrFd)
      removeDir(dir)
    },
  }
}

/**
 * Close a descriptor, swallowing the EBADF of an already-closed one.
 *
 * @param {number} fd
 */
function closeQuietly(fd) {
  try {
    closeSync(fd)
  } catch {}
}

/**
 * Remove the capture directory, swallowing the locks a dying child can leave.
 *
 * @param {string} dir
 */
function removeDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  } catch {}
}

/**
 * Read at most CAPTURE_LIMIT_BYTES bytes and mark the cut, so output stays
 * bounded no matter how much the child wrote. The cap is measured in bytes
 * (not UTF-16 code units), and a file larger than the cap is only read up to
 * the cap — a runaway child cannot spend host memory on its output.
 *
 * @param {string} path
 * @returns {string}
 */
function readCapped(path) {
  try {
    const size = statSync(path).size
    if (size === 0) return ''
    if (size <= CAPTURE_LIMIT_BYTES) return readFileSync(path, 'utf8')

    const buffer = Buffer.alloc(CAPTURE_LIMIT_BYTES)
    const fd = openSync(path, 'r')
    try {
      readSync(fd, buffer, 0, CAPTURE_LIMIT_BYTES, 0)
    } finally {
      closeQuietly(fd)
    }
    return decodeUtf8Prefix(buffer) + TRUNCATED
  } catch {
    return ''
  }
}

/**
 * Decode a byte prefix without splitting a multi-byte character at the cut.
 *
 * @param {Buffer} buffer
 * @returns {string}
 */
function decodeUtf8Prefix(buffer) {
  let end = buffer.length
  if ((buffer[end - 1] & 0x80) !== 0) {
    // The last byte belongs to a multi-byte sequence: walk back to its lead
    // byte and drop the whole character when it did not fit in the cap.
    let start = end - 1
    while (start > 0 && (buffer[start] & 0xc0) === 0x80) start -= 1
    const lead = buffer[start]
    const expected =
      (lead & 0xf8) === 0xf0 ? 4 : (lead & 0xf0) === 0xe0 ? 3 : (lead & 0xe0) === 0xc0 ? 2 : 1
    if (end - start < expected) end = start
  }
  return buffer.subarray(0, end).toString('utf8')
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Text shown for `/semble` with no argument, and after an unknown one. */
export const SEMBLE_USAGE = [
  'Semble CLI reports',
  '',
  '  /semble savings          tokens saved by snippets instead of whole files',
  '  /semble file-types       file extensions Semble indexes, per content type',
  '  /semble version          the Semble release the uvx installation resolved',
  '  /semble clear index      drop the search index cache; the next search rebuilds it',
  '  /semble clear orphans    remove indexes whose source path no longer exists',
  '  /semble clear savings    reset the token-savings statistics',
  '  /semble clear all        all of the above',
  '',
  'Runs the same uvx installation the search tools use. Clearing is safe but not',
  'free: the first search after `clear index` or `clear all` re-indexes from scratch.',
].join('\n')
