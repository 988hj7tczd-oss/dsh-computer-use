/**
 * human.js —— 真人操作模块：像素级虚拟光标（看得见过程）。
 *
 * 核心初衷：AX 树只用于"看"（定位坐标），操作必须走虚拟光标——
 * 光标从当前位置平滑滑行到目标（弧线轨迹，彩虹光标可见），再真实点击。
 *
 * 点击寻址（2026-08 实测修正）：
 *   - element 编号模式 → 用引擎官方推荐的 element_token（AX 路径，精确定位，
 *     支持后台/隐藏窗口，无需坐标换算；引擎文档明确 "Prefer element_token"）
 *   - x/y 坐标模式 → 像素路径（CGEvent），坐标须为"窗口本地截图像素"
 *     （get_window_state 的 PNG 坐标，左上原点；Retina 下 = 窗口本地 pt × 2，
 *     由截图 px 尺寸 / 窗口 pt 尺寸 实际测得）。
 */
import { cuaCall, CUA_SESSION } from './cua.js'
import { getSnapshot } from './snapshot.js'

/** 滑行段数（越多越平滑，真人手部轨迹感）。 */
const GLIDE_SEGMENTS = 5
/** 每段间隔 ms。 */
const GLIDE_STEP_MS = 70
/** 弧线高度（px，模拟人手弧线轨迹）。 */
const ARC_HEIGHT = 40

/**
 * 光标滑行：从当前位置平滑移动到目标（分段 + 弧线）。
 * @param {number} tx - 目标 x
 * @param {number} ty - 目标 y
 */
export async function glideCursor(tx, ty) {
  // 当前光标位置
  let cur = null
  try {
    cur = await cuaCall('get_cursor_position', { session: CUA_SESSION })
  } catch { /* 拿不到就直线过去 */ }
  const sx = cur?.x ?? tx
  const sy = cur?.y ?? ty

  for (let i = 1; i <= GLIDE_SEGMENTS; i++) {
    const t = i / GLIDE_SEGMENTS
    const x = sx + (tx - sx) * t
    // 弧线：中间点抬高（模拟人手画弧）
    const y = sy + (ty - sy) * t - Math.sin(t * Math.PI) * ARC_HEIGHT
    await cuaCall('move_cursor', { session: CUA_SESSION, scope: 'window', x, y })
      .catch(() => undefined)
    await new Promise((r) => setTimeout(r, GLIDE_STEP_MS))
  }
  await cuaCall('move_cursor', { session: CUA_SESSION, scope: 'window', x: tx, y: ty })
    .catch(() => undefined)
}

/**
 * 计算元素在屏幕上的位置（滑行目标）。
 * cua-driver 0.19.3 的 get_window_state 元素 frame 与 list_windows 的窗口
 * bounds 同属屏幕 pt 坐标系（多显示器时窗口 x 可为负），元素中心即屏幕坐标。
 * 返回 {sx, sy} 屏幕坐标；失败返回 null。
 */
export function screenPointOf(entry, snap) {
  if (!entry || entry.x == null || entry.y == null) return null
  return {
    sx: entry.x,
    sy: entry.y,
  }
}

/**
 * 把屏幕 pt 坐标换算为窗口本地 pt 坐标。
 * 窗口 bounds（屏幕 pt 左上角）来自快照；bounds 缺失时原样返回（尽力而为）。
 */
export function windowLocalOf(x, y, snap) {
  const b = snap?.windowBounds
  if (!b || b.x == null || b.y == null) return { x, y }
  return { x: x - b.x, y: y - b.y }
}

/** Retina 近似缩放（窗口本地 pt → 截图像素 px）。cua-driver 0.19.3 实测 2x。 */
export const SCREEN_SCALE = 2.0

/**
 * 真人点击：滑行到目标 + 点击。
 * element 模式（带 token）走引擎 AX 路径（element_token，精确定位）；
 * 坐标模式走像素路径（x/y 须为窗口本地截图像素）。
 * @param {object} opts - { pid, windowId, x, y, sx, sy, token, count, button }
 */
export async function humanClick(opts) {
  const { pid, windowId, x, y, sx, sy, token, count = 1, button = 'left' } = opts

  // 1. 光标滑行到目标（屏幕坐标），看得见过程
  if (sx != null && sy != null) {
    await glideCursor(sx, sy)
  }

  // 2. 点击：token 优先（AX 路径），否则像素路径（窗口本地截图像素）
  const payload = { session: CUA_SESSION, pid }
  if (token) {
    payload.element_token = token
    // token 路径同样透传计数/按钮，否则双击/右键会静默退化成单次左键
    payload.count = count
    payload.button = button
  } else {
    if (x == null || y == null) throw new Error('humanClick: 缺少点击坐标（x/y）。')
    payload.window_id = windowId
    payload.x = x * SCREEN_SCALE
    payload.y = y * SCREEN_SCALE
    payload.count = count
    payload.button = button
  }
  const value = await cuaCall('click', payload)
  return value
}

/** 快照辅助：解析编号 → token + 坐标（窗口内 pt + 屏幕 pt）。 */
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
