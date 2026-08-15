/**
 * actions.js —— 动作工具实现：点击 / 双击 / 右键 / 输入 / 按键 / 滚动 / 拖拽。
 *
 * 每个动作都基于 screen_observe 的快照：
 *  - element 编号模式 → 透传 element_token（引擎校验快照是否过期）
 *  - x/y 坐标模式 → 使用快照窗口的 window-local 像素坐标
 */
import { cuaCall, normalizeMcp, withSession } from './cua.js'
import { getSnapshot } from './snapshot.js'
import { resolveToken, resolveWindow } from './snapshot.js'
import { humanClick, resolveClickTarget, screenPointOf, windowLocalOf } from './human.js'

/**
 * 构造一次"基于编号或坐标"的引擎调用参数。
 * 坐标语义：screen_observe 输出的元素坐标是屏幕 pt（cua-driver 0.19.3 的
 * frame 即屏幕坐标），引擎 click/scroll/drag 需要 window-local，故换算。
 * @returns {object} 传给 cua-driver 的参数字段
 */
function targetArgs(args, cfg, extra = {}) {
  const out = {}
  const snap = getSnapshot()
  if (args.element !== undefined && args.element !== null) {
    const { pid, token } = resolveToken(Number(args.element), cfg.ttlMs)
    out.pid = pid
    out.element_token = token
  } else if (args.x !== undefined || args.y !== undefined) {
    if (args.x === undefined || args.y === undefined) {
      throw new Error('坐标模式必须同时提供 x 和 y。')
    }
    const { pid, windowId } = resolveWindow(cfg.ttlMs)
    const local = windowLocalOf(Number(args.x), Number(args.y), snap)
    out.pid = pid
    out.window_id = windowId // 坐标点击需 window_id 定位目标窗口（避免多窗口歧义）
    out.x = local.x
    out.y = local.y
  } else {
    throw new Error('必须提供 element（观察编号）或 x/y 坐标。')
  }
  return withSession({ ...out, ...extra })
}

/** 通用动作执行：调用引擎并返回统一结果。 */
async function runAction(label, tool, args, cfg, extra = {}) {
  const payload = targetArgs(args, cfg, extra)
  const value = normalizeMcp(await cuaCall(tool, payload))
  const detail = typeof value === 'string' ? value : JSON.stringify(value)
  return { ok: true, result: `${label} 完成：${detail}` }
}

/**
 * 真人点击：解析目标（编号或坐标）→ 光标滑行 → 像素级点击。
 * @returns {Promise<{ok:boolean, result:string}>}
 */
async function humanAction(label, args, cfg, extra = {}) {
  let target
  const snap = getSnapshot()
  if (args.element !== undefined && args.element !== null) {
    target = resolveClickTarget(Number(args.element), cfg.ttlMs)
  } else if (args.x !== undefined && args.y !== undefined) {
    const { pid, windowId } = resolveWindow(cfg.ttlMs)
    const sx = Number(args.x)
    const sy = Number(args.y)
    const local = windowLocalOf(sx, sy, snap)
    target = {
      pid,
      windowId,
      x: local.x,
      y: local.y,
      sx,
      sy,
    }
  } else {
    throw new Error('必须提供 element（观察编号）或 x/y 坐标。')
  }
  const value = await humanClick({ ...target, ...extra })
  const detail = typeof value === 'string' ? value : JSON.stringify(value)
  return { ok: true, result: `${label} 完成（虚拟光标滑行+点击）：${detail}` }
}

/** computer_click —— 真人操作：光标滑行 + 像素点击 */
export async function click(args, cfg) {
  const extra = {}
  if (args.count) extra.count = Number(args.count)
  return humanAction('点击', args, cfg, extra)
}

/** computer_double_click */
export async function doubleClick(args, cfg) {
  return humanAction('双击', args, cfg, { count: 2 })
}

/** computer_right_click */
export async function rightClick(args, cfg) {
  return humanAction('右键点击', args, cfg, { button: 'right' })
}

/** computer_type —— 文本输入（可指定元素，否则输入到前台应用当前焦点） */
export async function typeText(args, cfg) {
  if (!args.text) throw new Error('computer_type: 缺少 text 参数。')
  const payload = withSession({ text: String(args.text) })
  if (args.element !== undefined && args.element !== null) {
    const { pid, token } = resolveToken(Number(args.element), cfg.ttlMs)
    payload.pid = pid
    payload.element_token = token
  } else {
    // 无指定元素：输入到前台应用（desktop scope）
    payload.scope = 'desktop'
  }
  const value = normalizeMcp(await cuaCall('type_text', payload))
  const detail = typeof value === 'string' ? value : JSON.stringify(value)
  return { ok: true, result: `输入完成：${detail}` }
}

/** computer_key —— 按键 / 快捷键（如 return、cmd+c） */
export async function key(args, cfg) {
  if (!args.key) throw new Error('computer_key: 缺少 key 参数。')
  const parts = String(args.key).toLowerCase().split('+').map((s) => s.trim())
  const MODS = new Set(['cmd', 'command', 'ctrl', 'control', 'option', 'alt', 'shift', 'fn'])
  const modifiers = parts.filter((p) => MODS.has(p)).map((p) => {
    if (p === 'command') return 'cmd'
    if (p === 'control') return 'ctrl'
    if (p === 'option') return 'alt'
    return p
  })
  const keyName = parts.filter((p) => !MODS.has(p))[0]
  if (!keyName) throw new Error('computer_key: 无法解析按键（示例: return / cmd+c / shift+tab）。')
  const payload = withSession({ key: keyName })
  if (modifiers.length > 0) payload.modifiers = modifiers
  // press_key 需要 pid+window_id（精准作用于快照窗口）或 scope=desktop（作用于前台应用）
  // 注：只传 pid 在多窗口应用（QQ 等）会歧义，必须带 window_id
  try {
    const { pid, windowId } = resolveWindow(cfg.ttlMs)
    payload.pid = pid
    payload.window_id = windowId
  } catch {
    payload.scope = 'desktop'
  }
  const value = normalizeMcp(await cuaCall('press_key', payload))
  const detail = typeof value === 'string' ? value : JSON.stringify(value)
  return { ok: true, result: `按键完成 (${String(args.key)})：${detail}` }
}

/** computer_scroll */
export async function scroll(args, cfg) {
  const dir = args.direction || 'down'
  if (!['up', 'down', 'left', 'right'].includes(dir)) {
    throw new Error('computer_scroll: direction 必须是 up/down/left/right。')
  }
  const payload = withSession({ direction: dir })
  if (args.amount) payload.amount = Number(args.amount)
  if (args.element !== undefined && args.element !== null) {
    const { pid, token } = resolveToken(Number(args.element), cfg.ttlMs)
    payload.pid = pid
    payload.element_token = token
  } else {
    const { pid } = resolveWindow(cfg.ttlMs)
    payload.pid = pid
  }
  const value = normalizeMcp(await cuaCall('scroll', payload))
  const detail = typeof value === 'string' ? value : JSON.stringify(value)
  return { ok: true, result: `滚动完成 (${dir})：${detail}` }
}

/** computer_drag —— 拖拽（坐标语义同观察输出：屏幕 pt，内部换算窗口本地） */
export async function drag(args, cfg) {
  const { pid } = resolveWindow(cfg.ttlMs)
  if ([args.from_x, args.from_y, args.to_x, args.to_y].some((v) => v === undefined)) {
    throw new Error('computer_drag: 需要 from_x/from_y/to_x/to_y。')
  }
  const snap = getSnapshot()
  const from = windowLocalOf(Number(args.from_x), Number(args.from_y), snap)
  const to = windowLocalOf(Number(args.to_x), Number(args.to_y), snap)
  const payload = withSession({
    pid,
    from_x: from.x,
    from_y: from.y,
    to_x: to.x,
    to_y: to.y,
  })
  if (args.duration_ms) payload.duration_ms = Number(args.duration_ms)
  const value = normalizeMcp(await cuaCall('drag', payload))
  const detail = typeof value === 'string' ? value : JSON.stringify(value)
  return { ok: true, result: `拖拽完成：${detail}` }
}

/** computer_wait —— 本地等待（不调引擎） */
export async function wait(args) {
  const ms = Math.max(0, Math.min(Number(args.ms) || 1000, 60000))
  await new Promise((r) => setTimeout(r, ms))
  return { ok: true, result: `已等待 ${ms}ms。` }
}

/** app_list —— 列出应用 */
export async function listApps() {
  const value = await cuaCall('list_apps')
  const apps = (value.apps || []).filter((a) => a.running)
  const lines = apps.map((a) => {
    const win = a.windows && a.windows.length > 0 ? ` (${a.windows.length} 窗口)` : ''
    return `- ${a.name}${win} [pid=${a.pid}]${a.active ? ' ★活动' : ''}`
  })
  const result = `正在运行的应用（${apps.length} 个）：\n${lines.join('\n')}`
  return { ok: true, result, apps: apps.map((a) => ({ name: a.name, pid: a.pid, active: a.active })) }
}

/** app_launch —— 启动应用（后台），可选前置 */
export async function launchApp(args) {
  if (!args.name && !args.bundle_id) {
    throw new Error('app_launch: 需要 name（应用名）或 bundle_id。')
  }
  const payload = {}
  if (args.bundle_id) payload.bundle_id = String(args.bundle_id)
  else payload.name = String(args.name)
  if (args.creates_new_instance) payload.creates_new_instance = true
  const launched = await cuaCall('launch_app', payload)

  // 若请求前置，找 pid 并 bring_to_front
  let pid = launched?.pid ?? null
  let frontNote = ''
  if (args.bring_to_front && pid) {
    await cuaCall('bring_to_front', { pid })
    frontNote = ' 已前置'
  }

  const detail = typeof launched === 'string' ? launched : JSON.stringify(launched)
  return {
    ok: true,
    result: `应用已启动${frontNote}：${detail}`,
    pid,
  }
}
