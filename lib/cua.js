/**
 * cua.js —— cua-driver 引擎调用封装。
 *
 * 通过 `cua-driver call <tool> '<json-args>'` 的子进程方式调用引擎。
 * 零外部依赖：不需要 MCP SDK，CLI 即接口。
 *
 * 引擎二进制定位见 resolveBin()：CUA_DRIVER_BIN → PATH → 常见安装路径。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 解析引擎二进制路径（优先级）：
 *   1. 环境变量 CUA_DRIVER_BIN（显式指定）
 *   2. PATH 目录扫描（cua-driver / cua-driver.exe）
 *   3. 常见安装路径：~/.local/bin（cua-driver 官方安装器默认位置）、
 *      /usr/local/bin、/opt/homebrew/bin（Apple Silicon）、Windows %LOCALAPPDATA%
 *   4. 兜底 'cua-driver'（交给 spawn 报 ENOENT，错误信息含自救指引）
 *
 * 说明：GUI 应用（harness-desktop）的 PATH 通常不含 shell 的 ~/.local/bin，
 * 因此必须探测官方安装器的默认位置，否则 macOS 用户开箱即 ENOENT。
 */
function resolveBin() {
  const explicit = process.env.CUA_DRIVER_BIN
  if (explicit) return explicit
  const sep = process.platform === 'win32' ? ';' : ':'
  const exe = process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver'
  for (const dir of (process.env.PATH || '').split(sep)) {
    if (!dir) continue
    try { if (existsSync(join(dir, exe))) return join(dir, exe) } catch { /* 忽略 */ }
  }
  const common = [
    join(homedir(), '.local', 'bin', exe),
    `/usr/local/bin/${exe}`,
    `/opt/homebrew/bin/${exe}`,
    join(homedir(), 'AppData', 'Local', 'cua-driver', exe),
  ]
  for (const p of common) {
    try { if (existsSync(p)) return p } catch { /* 忽略 */ }
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

/**
 * 调用一个 cua-driver 工具（带会话自愈）。
 * 若会话已结束（daemon 空闲回收/重启导致），自动 start_session 恢复后重试一次，
 * 保证插件长时运行不因会话失效而中断。
 * @param {string} tool - 工具名，如 'get_window_state' / 'click'
 * @param {object} args - 参数对象
 * @returns {Promise<any>} 解析后的 JSON 值（CLI 输出即 structuredContent 形状）
 */
export async function cuaCall(tool, args = {}) {
  try {
    return await rawCall(tool, args)
  } catch (err) {
    if (tool !== 'start_session' && /session '.*' has ended|revive it/.test(err.message)) {
      await rawCall('start_session', { session: CUA_SESSION }).catch(() => undefined)
      return rawCall(tool, args)
    }
    throw err
  }
}

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
        ? `未找到 cua-driver：请确保它已安装并在 PATH 中，或设置环境变量 CUA_DRIVER_BIN 指向完整路径（如 CUA_DRIVER_BIN=/path/to/cua-driver）。`
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
