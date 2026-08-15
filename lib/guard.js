/**
 * guard.js —— 安全护栏（P3）。
 *
 * 1. 区域限制：仅允许操作 allowedApps 白名单中的应用（会话级）。
 * 2. 危险操作审批：目标标签命中危险词（删除/支付/购买/转账…）→ ctx.approval 征询用户。
 * 3. 敏感输入保护：密码框（AXSecureTextField）永不让模型输入——type 直接拒绝，click 需审批。
 * 4. 快照 TTL / 无快照拒绝：已在 snapshot.js 实现（动作一律要求新鲜快照）。
 */
import { getSnapshot } from './snapshot.js'

/** 危险词表（命中即审批）。 */
const DANGEROUS_PATTERNS = [
  /删除|移除|清空|清倒|格式化|卸载|永久/,
  /支付|付款|购买|下单|结账|转账|汇款|提交订单|确认交易/,
  /退出登录|注销|登出/,
]

/** 密码类 AX role（macOS）。 */
const PASSWORD_ROLES = new Set(['AXSecureTextField', 'AXPasswordField'])

/** 区域限制只约束"操作类"工具；观察/列表/启动为只读或无害，不受限。 */
const OPERATION_TOOLS = new Set([
  'computer_click', 'computer_double_click', 'computer_right_click',
  'computer_type', 'computer_key', 'computer_scroll', 'computer_drag',
])

/** 目标标签是否命中危险词。 */
export function isDangerousLabel(label) {
  const s = String(label || '')
  return DANGEROUS_PATTERNS.some((re) => re.test(s))
}

/**
 * 统一动作前置守卫。
 * @param {object} ctx - Cordis 上下文（提供 approval 服务）
 * @param {object} cfg - 插件配置（allowedApps）
 * @param {string} toolName - 当前工具名
 * @param {object} args - 工具参数
 * @param {object} exec - 工具执行上下文（exec.agent）
 * @returns {Promise<{ok:boolean, reason?:string}>} 通过返回 {ok:true}
 */
export async function guard(ctx, cfg, toolName, args, exec) {
  const snap = getSnapshot()

  // 1. 区域限制：allowedApps 非空时，操作类工具的快照窗口应用必须在白名单内
  if (OPERATION_TOOLS.has(toolName) && cfg.allowedApps && cfg.allowedApps.length > 0) {
    if (!snap) {
      return { ok: false, reason: '区域限制：先调用 screen_observe 建立快照才能操作。' }
    }
    if (!cfg.allowedApps.includes(snap.appName)) {
      return {
        ok: false,
        reason: `区域限制：应用 "${snap.appName}" 不在允许操作列表（${cfg.allowedApps.join(' / ')}）中，已拒绝。`,
      }
    }
  }

  // 2/3. 元素级检测（仅 element 编号模式可预知目标；坐标模式无法预知，靠快照 TTL 兜底）
  if (args.element !== undefined && args.element !== null && snap) {
    const info = snap.entries?.get(Number(args.element))
    const role = info?.role || ''
    const label = info?.label || ''

    // 敏感输入保护：密码框
    if (PASSWORD_ROLES.has(role)) {
      if (toolName === 'computer_type') {
        return { ok: false, reason: '敏感输入保护：密码框拒绝自动输入——密码/密钥必须由用户本人输入。' }
      }
      // 点击密码框本身 → 询问
      const outcome = await askApproval(ctx, exec, toolName, `检测到密码输入框"${label || role}"，确认执行 ${toolName}？`)
      if (outcome !== 'allowed-once') {
        return { ok: false, reason: `未获批准（${outcome}），已取消。` }
      }
      return { ok: true }
    }

    // 危险操作审批
    if (isDangerousLabel(label)) {
      const outcome = await askApproval(ctx, exec, toolName, `即将对"${label}"执行 ${toolName}——该目标可能触发删除/支付等危险操作，是否继续？`)
      if (outcome !== 'allowed-once') {
        return { ok: false, reason: `危险操作未获批准（${outcome}），已取消。` }
      }
    }
  }

  return { ok: true }
}

/** 通过 ctx.approval 征询用户（失败关闭：无 approval/agent 时视为不可用）。 */
async function askApproval(ctx, exec, toolName, reason) {
  if (!ctx.approval || !exec?.agent) return 'unavailable'
  try {
    return await ctx.approval.request({ agent: exec.agent, toolName, reason })
  } catch {
    return 'unavailable'
  }
}
