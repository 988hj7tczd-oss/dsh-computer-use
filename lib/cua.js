/**
 * cua.js —— cua-driver 引擎调用封装。
 *
 * 通过 `cua-driver call <tool> '<json-args>'` 的子进程方式调用引擎。
 * 零外部依赖：不需要 MCP SDK，CLI 即接口。
 *
 * 引擎二进制定位见 resolveBin()：CUA_DRIVER_BIN → PATH → 官方安装器路径 → 常见安装路径。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, win32 } from 'node:path'

/**
 * 解析引擎二进制路径（优先级）：
 *   1. 环境变量 CUA_DRIVER_BIN（显式指定）
 *   2. PATH 目录扫描（cua-driver / cua-driver.exe）
 *   3. 官方安装器路径：~/.cua-driver/packages/current/<exe>
 *   4. 常见安装路径：~/.local/bin（旧版安装器默认位置）、
 *      /usr/local/bin、/opt/homebrew/bin（Apple Silicon）、Windows %LOCALAPPDATA%
 *   4. 兜底 'cua-driver'（交给 spawn 报 ENOENT，错误信息含自救指引）
 *
 * 说明：GUI 应用（harness-desktop）的 PATH 通常不含 shell 的 ~/.local/bin，
 * 因此必须探测官方安装器的默认位置，否则 macOS 用户开箱即 ENOENT。
 */
export function resolveBin({ platform = process.platform, env = process.env, home = homedir(), exists = existsSync } = {}) {
  const explicit = env.CUA_DRIVER_BIN
  if (explicit) return explicit
  const sep = platform === 'win32' ? ';' : ':'
  const exe = platform === 'win32' ? 'cua-driver.exe' : 'cua-driver'
  const pathJoin = platform === 'win32' ? win32.join : join
  for (const dir of (env.PATH || '').split(sep)) {
    if (!dir) continue
    try { if (exists(pathJoin(dir, exe))) return pathJoin(dir, exe) } catch { /* 忽略 */ }
  }
  const common = [
    pathJoin(home, '.cua-driver', 'packages', 'current', exe),
    pathJoin(home, '.local', 'bin', exe),
    pathJoin('/usr/local/bin', exe),
    pathJoin('/opt/homebrew/bin', exe),
    pathJoin(home, 'AppData', 'Local', 'cua-driver', exe),
  ]
  for (const p of common) {
    try { if (exists(p)) return p } catch { /* 忽略 */ }
  }
  return 'cua-driver'
}

export const CUA_BIN = resolveBin()

/**
 * 插件统一的虚拟光标会话 id：所有动作绑定同一会话，
 * 光标主题/运动参数才能稳定生效（会话级）。
 */
export const CUA_SESSION = process.env.CUA_SESSION || 'dsh-computer-use'

/** 给动作类调用注入统一会话（观察类只读工具不需要）。 */
export function withSession(args = {}) {
  return { session: CUA_SESSION, ...args }
}

export function isSessionEndedError(message) {
  return /\bsession\s+(?:'[^']+'\s+)?has\s+ended\b|\brevive\s+it\b/i.test(String(message || ''))
}

/** Create the retry wrapper with an injectable raw call for deterministic tests. */
export function createCuaCall(callRaw, session = CUA_SESSION) {
  if (typeof callRaw !== 'function') throw new TypeError('createCuaCall requires a raw-call function')
  return async function callWithSessionRecovery(tool, args = {}) {
    try {
      return await callRaw(tool, args)
    } catch (err) {
      if (tool !== 'start_session' && isSessionEndedError(err?.message)) {
        await callRaw('start_session', { session }).catch(() => undefined)
        return callRaw(tool, args)
      }
      throw err
    }
  }
}

/** Call a cua-driver tool with session recovery enabled. */
export const cuaCall = createCuaCall(rawCall)

/** 底层单次调用（不含会话自愈）。 */
function rawCall(tool, args = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(CUA_BIN, ['call', tool, JSON.stringify(args)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => {
      const hint = e.code === 'ENOENT'
        ? `未找到 cua-driver：请确保它已安装并在 PATH 中，或确认官方安装器路径 ~/.cua-driver/packages/current/cua-driver.exe 可用，或设置环境变量 CUA_DRIVER_BIN 指向完整路径。`
        : ''
      reject(new Error(`cua-driver 无法启动 (${CUA_BIN}): ${e.message}${hint ? ' ' + hint : ''}`))
    })
    child.on('close', (code) => {
      if (code !== 0) {
        const msg = (err || out).trim()
        reject(new Error(`cua-driver ${tool} 失败 (exit ${code}): ${msg.slice(0, 800)}`))
        return
      }
      try {
        resolve(JSON.parse(out))
      } catch {
        reject(new Error(`cua-driver ${tool} 返回非 JSON: ${out.slice(0, 500)}`))
      }
    })
  })
}

/**
 * 归一化 MCP 形状的返回：若结果带 content 数组（[{type:'text',text}]），
 * 提取文本拼接；否则原样返回。
 */
export function normalizeMcp(value) {
  if (value && Array.isArray(value.content)) {
    const texts = value.content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
    if (texts.length > 0) return texts.join('\n')
  }
  return value
}
