/**
 * human.js —— 真人操作模块：像素级虚拟光标（看得见过程）。
 *
 * 坐标语义（cua-driver 0.21+）：click / drag / scroll 的 x,y 均为
 * "窗口本地截图像素"（get_window_state 返回的 PNG 同一空间，左上原点）。
 * 因此坐标不再做任何 ×2 / 窗口偏移换算 —— 模型看到的截图坐标即动作坐标。
 *
 * 点击寻址：
 *   - element 编号模式 → 用引擎官方推荐的 element_token（AX 路径，精确定位，
 *     支持后台/隐藏窗口，无需坐标；引擎文档明确 "Prefer element_token"）
 *   - x/y 坐标模式 → 像素路径（CGEvent），坐标 = 窗口本地截图像素
 */
import { cuaCall, CUA_SESSION, withSession } from './cua.js'
import { getSnapshot } from './snapshot.js'

/** 滑行段数（越多越平滑，真人手部轨迹感）。 */
const GLIDE_SEGMENTS = 5
/** 每段间隔 ms。 */
const GLIDE_STEP_MS = 70
/** 弧线高度（px，模拟人手弧线轨迹）。 */
const ARC_HEIGHT = 40

/**
 * 光标滑行：从当前位置平滑移动到目标（分段 + 弧线）。最佳努力：
 * 滑行失败不阻断点击（0.21.0 的 move_cursor 目标形状与旧版不同，逐级尝试）。
 * @param {number} tx - 目标 x（窗口逻辑像素）
 * @param {number} ty - 目标 y
 * @param {object} opts - { target, call } 目标窗口 + 可注入的引擎调用器
 */
export async function glideCursor(tx, ty, opts = {}) {
  const { call = cuaCall, ...target } = opts
  const tryMove = (payload) => call('move_cursor', payload).catch(() => undefined)
  // 当前光标位置（拿不到就从目标点直线过去）
  let cur = null
  try {
    cur = await call('get_cursor_position', { session: CUA_SESSION })
  } catch { /* 无光标信息 → 直线 */ }
  const sx = cur?.x != null ? cur.x : tx
  const sy = cur?.y != null ? cur.y : ty

  for (let i = 1; i <= GLIDE_SEGMENTS; i++) {
    const t = i / GLIDE_SEGMENTS
    const x = sx + (tx - sx) * t
    // 弧线：中间点抬高（模拟人手画弧）
    const y = sy + (ty - sy) * t - Math.sin(t * Math.PI) * ARC_HEIGHT
    await tryMove(withSession({ x, y, ...target }))
    await new Promise((r) => setTimeout(r, GLIDE_STEP_MS))
  }
  await tryMove(withSession({ x: tx, y: ty, ...target }))
}

/**
 * 截图帧 → 窗口几何的缩放比。
 *
 * 引擎返回的 PNG 可能是显示缩放后的帧（HiDPI 2x、分数缩放 1.5x），
 * 而 click / scroll / drag 的 x,y 按"窗口逻辑像素"解释
 * （引擎算出的 screen = 窗口原点 + x）。两者相差
 * screenshotWidth / window_bounds.width 倍。
 *
 * 任一侧数据缺失时按 1 处理（X11 常见情形，与旧行为一致）。
 * @returns {number} 缩放比，>= 1
 */
export function windowScale(snap) {
  const shot = Number(snap?.screenshotWidth)
  const logical = Number(snap?.windowBounds?.width)
  if (!Number.isFinite(shot) || !Number.isFinite(logical) || shot <= 0 || logical <= 0) return 1
  const scale = shot / logical
  // 只接受"截图比逻辑大"的方向；反向或异常值不换算，避免把点击打偏。
  return Number.isFinite(scale) && scale > 1 ? scale : 1
}

/**
 * 截图坐标 → 窗口逻辑坐标（引擎 click/scroll/drag 的入参空间）。
 * @param {number} x - 截图像素 x（模型在 screen_observe 图里看到的坐标）
 * @param {number} y - 截图像素 y
 * @param {object} snap - 观察快照（含 screenshotWidth / windowBounds）
 */
export function windowLocalOf(x, y, snap) {
  const scale = windowScale(snap)
  if (scale === 1) return { x, y }
  return { x: Math.round(Number(x) / scale), y: Math.round(Number(y) / scale) }
}

/**
 * 真人点击：滑行到目标 + 点击。
 * element 模式（带 token）走引擎 AX 路径（element_token，精确定位）；
 * 坐标模式走像素路径（x/y = 窗口逻辑像素，由 windowLocalOf 从截图坐标换算）。
 * @param {object} opts - { pid, windowId, x, y, sx, sy, token, count, button, call }
 *   call: 可选注入的引擎调用器（动作层用它挂前台投递重试）
 */
export async function humanClick(opts) {
  const { pid, windowId, x, y, sx, sy, token, count = 1, button = 'left', call = cuaCall } = opts

  // 1. 光标滑行到目标（最佳努力，看得见过程）
  if (sx != null && sy != null) {
    await glideCursor(sx, sy, { call, target: { kind: 'window', pid, window_id: windowId } })
  }

  // 2. 点击：token 优先（AX 路径），否则像素路径（窗口逻辑像素）
  const payload = { session: CUA_SESSION, pid }
  if (token) {
    payload.element_token = token
    // token 路径同样透传计数/按钮，否则双击/右键会静默退化成单次左键
    payload.count = count
    payload.button = button
  } else {
    if (x == null || y == null) throw new Error('humanClick: 缺少点击坐标（x/y）。')
    payload.window_id = windowId
    payload.x = x
    payload.y = y
    payload.count = count
    payload.button = button
  }
  const value = await call('click', payload)
  return value
}

/** 快照辅助：解析编号 → token + 坐标（截图像素空间）。 */
export function resolveClickTarget(index, ttlMs) {
  const snap = getSnapshot()
  if (!snap) throw new Error('没有可用的观察快照：请先调用 screen_observe。')
  const entry = snap.entries?.get(index)
  if (!entry) throw new Error(`编号 [${index}] 不在当前快照中。`)
  const pt = screenPointOf(entry, snap)
  const local = windowLocalOf(entry.x, entry.y, snap)
  return {
    pid: snap.pid,
    windowId: snap.windowId,
    token: entry.token || null,
    x: local.x,
    y: local.y,
    sx: pt?.sx,
    sy: pt?.sy,
  }
}

/**
 * 快照辅助：元素在"窗口逻辑坐标"中的位置（供虚拟光标滑行使用）。
 * move_cursor 与 click 共用同一坐标空间，必须一起换算，
 * 否则 HiDPI 下光标会滑到两倍远的位置。
 */
export function screenPointOf(entry, snap) {
  if (!entry || entry.x == null || entry.y == null) return null
  const local = windowLocalOf(entry.x, entry.y, snap)
  return { sx: local.x, sy: local.y }
}