/**
 * observe.js —— screen_observe 工具实现。
 *
 * 流程：list_windows 取窗口 → 选目标 → get_window_state 取 AX 树
 * → 精简为"编号 + 角色 + 标签 + 中心坐标"行 → 缓存快照。
 *
 * 模式 A（ax，默认）：只取树，零视觉成本。
 * 模式 B（vision）：额外用视觉模型（GLM-4V-Flash 免费）理解截图，输出界面描述。
 * 自动切换：AX 树为空（游戏/Canvas/降级）且已配置视觉 Key 时，自动降级 vision。
 */
import { cuaCall } from './cua.js'
import { setSnapshot } from './snapshot.js'
import { visionDescribe, visionConfigured } from './vision.js'

/** AX role 中值得展示的精简角色名（太长会刷爆上下文）。 */
const ROLE_SHORT = {
  AXWindow: '窗口',
  AXButton: '按钮',
  AXTextField: '输入框',
  AXTextArea: '文本框',
  AXCheckBox: '复选框',
  AXRadioButton: '单选',
  AXComboBox: '下拉框',
  AXMenuButton: '菜单按钮',
  AXMenuItem: '菜单项',
  AXLink: '链接',
  AXTab: '标签页',
  AXSlider: '滑块',
  AXScrollBar: '滚动条',
  AXTable: '表格',
  AXCell: '单元格',
  AXRow: '行',
  AXOutline: '大纲',
  AXList: '列表',
  AXStaticText: '文本',
  AXImage: '图片',
  AXPopUpButton: '弹出按钮',
  AXGroup: '分组',
  AXToolbar: '工具栏',
  AXSheet: '面板',
  AXDialog: '对话框',
}

function shortRole(role) {
  return ROLE_SHORT[role] || (role ? role.replace(/^AX/, '') : '元素')
}

/** 清洗为安全字符串：保证可无损 JSON 序列化（去孤立代理项）+ 截断。 */
function safeStr(v, max = 120) {
  let s = String(v ?? '')
  // 孤立代理项（Safari/网页 AX 值常见）会导致 JSON 序列化失败
  s = s.replace(/[\uD800-\uDFFF]/g, '\uFFFD')
  return s.slice(0, max)
}

/** 是否值得给编号（可交互或有关键文本）。 */
function isActionable(e) {
  const r = e.role || ''
  if (['AXButton', 'AXTextField', 'AXTextArea', 'AXCheckBox', 'AXRadioButton',
    'AXComboBox', 'AXMenuButton', 'AXMenuItem', 'AXLink', 'AXTab', 'AXSlider',
    'AXPopUpButton', 'AXCell', 'AXRow', 'AXScrollBar'].includes(r)) return true
  if (e.label || e.value) return true
  return false
}

/** 元素中心坐标（window-local 像素，frame 是 {x,y,w,h}）。非法/缺失时返回 null。 */
function centerOf(e) {
  const f = e.frame
  if (!f) return null
  const x = f.x + f.w / 2
  const y = f.y + f.h / 2
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x: Math.round(x), y: Math.round(y) }
}

/** 渲染一行编号元素。 */
function renderLine(e) {
  const role = shortRole(e.role)
  const label = safeStr(e.label || e.value || '')
  const parts = [`[${e.element_index}] ${role}`]
  if (label) parts.push(`"${label}"`)
  const c = centerOf(e)
  if (c) parts.push(`@(${c.x},${c.y})`)
  return parts.join(' ')
}

/** 构造视觉模型的提问（坐标系 = 截图像素 = 窗口内像素）。 */
function visionQuestion(w, h) {
  return `这是一张电脑应用窗口的截图，宽 ${w}px，高 ${h}px（坐标原点左上角）。
请用中文描述界面内容，并列出所有可交互元素（按钮、输入框、菜单、链接、图标等），每项格式：
[序号] 类型 "文字" @(x,y)
坐标 x,y 为该元素中心在截图中的像素位置。只输出列表，最多 30 项，不要多余解释。`
}

/**
 * 执行 screen_observe。
 * @param {object} args - { window?, mode?, query?, maxElements? }
 * @param {object} cfg - 插件配置（ttlMs / maxElements）
 */
export async function screenObserve(args, cfg) {
  const wantMode = args.mode === 'vision' ? 'vision' : 'ax'
  const maxElements = args.maxElements || cfg.maxElements || 500

  // 1. 窗口列表
  const winList = await cuaCall('list_windows', { on_screen_only: true })
  const windows = (winList.windows || []).filter((w) => w.window_id && (w.title || w.app_name))

  if (windows.length === 0) {
    return { ok: false, result: '当前没有可见窗口。', windows: [] }
  }

  // 2. 选目标窗口：参数 window（pid / 标题子串）→ 否则 z 序最前
  let target = null
  const want = args.window
  if (want !== undefined && want !== null && want !== '') {
    const wantStr = String(want)
    target = windows.find((w) => String(w.pid) === wantStr)
      || windows.find((w) => (w.title || '').toLowerCase().includes(wantStr.toLowerCase()))
      || windows.find((w) => (w.app_name || '').toLowerCase().includes(wantStr.toLowerCase()))
  }
  if (!target) {
    const sorted = [...windows].sort((a, b) => (b.z_index || 0) - (a.z_index || 0))
    target = sorted[0]
  }

  // 3. AX 树（vision 模式同时抓截图）
  const gwArgs = {
    pid: target.pid,
    window_id: target.window_id,
    include_screenshot: wantMode === 'vision',
    max_elements: maxElements,
  }
  if (args.query) gwArgs.query = String(args.query)
  const state = await cuaCall('get_window_state', gwArgs)
  const rawElements = Array.isArray(state.elements) ? state.elements : []
  const elements = rawElements.filter(isActionable)

  // 4. 自动切换：AX 树为空 且 配置了视觉 Key → 降级 vision
  const degraded = Boolean(state.degraded_reason) || rawElements.length === 0
  const useVision = wantMode === 'vision' || (degraded && visionConfigured())
  const effectiveMode = useVision ? 'vision' : 'ax'

  let visionText = ''
  let screenshotFile = state.screenshot_out_file || null
  if (useVision) {
    if (!state.screenshot_png_b64) {
      // 首次抓取未带截图 → 补抓
      const v = await cuaCall('get_window_state', {
        pid: target.pid,
        window_id: target.window_id,
        include_screenshot: true,
        max_elements: maxElements,
      })
      state.screenshot_png_b64 = v.screenshot_png_b64
      state.screenshot_width = v.screenshot_width
      state.screenshot_height = v.screenshot_height
    }
    const w = state.screenshot_width || 0
    const h = state.screenshot_height || 0
    try {
      visionText = await visionDescribe({
        imageBase64: state.screenshot_png_b64,
        mimeType: 'image/png',
        question: visionQuestion(w, h),
      })
    } catch (err) {
      visionText = `（视觉理解失败：${err.message}）`
    }
  }

  // 5. 快照缓存（element_token 自带的 snapshot_id 由引擎校验）
  const entries = new Map()
  for (const e of elements) {
    const c = centerOf(e)
    entries.set(e.element_index, {
      token: e.element_token,
      role: safeStr(e.role, 40),
      label: safeStr(e.label || e.value || '', 100),
      x: c ? c.x : null,
      y: c ? c.y : null,
    })
  }
  setSnapshot({
    at: Date.now(),
    ttlMs: cfg.ttlMs,
    pid: target.pid,
    windowId: target.window_id,
    appName: target.app_name || '',
    windowBounds: target.bounds || null, // 窗口屏幕位置（换算像素光标坐标）
    snapshotId: state.snapshot_id,
    entries,
    elementCount: state.element_count,
    totalElementCount: state.total_element_count,
    mode: effectiveMode,
  })

  // 6. 渲染
  const lines = elements.map(renderLine)
  const modeNote = effectiveMode === 'vision'
    ? `模式=vision${degraded && wantMode === 'ax' ? '（AX 树为空自动降级）' : ''}`
    : '模式=ax'
  const header = [
    `窗口: ${safeStr(target.app_name)} · ${safeStr(target.title)}`,
    `pid=${target.pid} window_id=${target.window_id} ${modeNote}`,
    effectiveMode === 'ax'
      ? `可见元素 ${lines.length} 个（树共 ${state.element_count}/${state.total_element_count}，快照 ${state.snapshot_id}）`
      : `AX 元素 ${lines.length} 个，视觉描述如下`,
  ].join('\n')

  const body = lines.length > 0
    ? lines.join('\n')
    : '(AX 树无可用元素)'

  const visionBlock = visionText ? `\n── 视觉理解 ──\n${visionText}` : ''

  return {
    ok: true,
    result: `${header}\n${body}${visionBlock}\n\n提示: 用 computer_click(element=[编号]) 或 computer_click(x=, y=) 操作。`,
    window: { pid: target.pid, windowId: target.window_id, app: safeStr(target.app_name, 60), title: safeStr(target.title, 80) },
    elementCount: elements.length,
    mode: effectiveMode,
    elements: elements.map((e) => {
      const c = centerOf(e)
      return {
        index: e.element_index,
        role: safeStr(shortRole(e.role), 40),
        label: safeStr(e.label || e.value || '', 100),
        x: c ? c.x : null,
        y: c ? c.y : null,
      }
    }),
    screenshotFile: screenshotFile || null,
  }
}
