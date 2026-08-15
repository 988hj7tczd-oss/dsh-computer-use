/**
 * snapshot.js —— 观察快照缓存。
 *
 * screen_observe 的结果有 TTL：过期后任何依赖编号/坐标的动作都会被拒绝，
 * 要求重新观察（对应项目书安全设计第 5 条"过期状态拒绝"）。
 * element_token 自带引擎侧 snapshot 校验，双重保险。
 * 快照同时记录 appName（区域限制）与元素 role/label（危险/敏感检测）。
 */

/** 当前快照（单会话单窗口模型，P2 可扩展为多窗口表）。 */
let snapshot = null

/**
 * 保存一次 screen_observe 的快照。
 * @param {object} s
 * @param {Map<number,{token:string,role?:string,label?:string}>} s.entries - 编号 → 元素信息
 */
export function setSnapshot(s) {
  snapshot = s
}

/** 读取当前快照（可能为 null）。 */
export function getSnapshot() {
  return snapshot
}

/** 快照是否新鲜（在 TTL 内）。 */
export function isFresh(ttlMs) {
  return Boolean(snapshot) && Date.now() - snapshot.at <= ttlMs
}

/** 清除快照（例如发生明显环境变化后）。 */
export function clearSnapshot() {
  snapshot = null
}

/**
 * 校验并取回编号对应的元素信息。
 * @param {number} index - screen_observe 输出的编号（= element_index）
 * @param {number} ttlMs - 快照 TTL
 * @returns {{pid:number, token:string, windowId:number, role?:string, label?:string}}
 * @throws 快照缺失 / 过期 / 编号不存在时抛出带指引的错误
 */
export function resolveToken(index, ttlMs) {
  if (!snapshot) {
    throw new Error('没有可用的观察快照：请先调用 screen_observe 再执行动作。')
  }
  if (!isFresh(ttlMs)) {
    clearSnapshot()
    throw new Error(`观察快照已过期（超过 ${Math.round(ttlMs / 1000)} 秒）：请重新调用 screen_observe。`)
  }
  const entry = snapshot.entries?.get(index)
  if (!entry || !entry.token) {
    throw new Error(`编号 [${index}] 不在当前快照中：请重新调用 screen_observe 获取最新编号。`)
  }
  return {
    pid: snapshot.pid,
    token: entry.token,
    windowId: snapshot.windowId,
    role: entry.role,
    label: entry.label,
  }
}

/**
 * 取回快照的窗口定位信息（坐标模式使用 window-local 像素）。
 */
export function resolveWindow(ttlMs) {
  if (!snapshot) {
    throw new Error('没有可用的观察快照：请先调用 screen_observe 再执行动作。')
  }
  if (!isFresh(ttlMs)) {
    clearSnapshot()
    throw new Error(`观察快照已过期（超过 ${Math.round(ttlMs / 1000)} 秒）：请重新调用 screen_observe。`)
  }
  return { pid: snapshot.pid, windowId: snapshot.windowId }
}
