/**
 * observe.js —— screen_observe 工具实现（含原生视觉 Mode C / 观察者 Mode D）。
 *
 * 流程：list_windows 取窗口 → 选目标 → get_window_state 取 AX 树
 * → 精简为"编号 + 角色 + 标签 + 中心坐标"行 → 缓存快照。
 *
 * 坐标语义（cua-driver 0.21+ 实测）：所有动作坐标 = "窗口本地截图像素"，
 * 与 get_window_state 返回的截图 PNG 同一空间（左上原点）。因此：
 *   - 元素编号模式 → element_token（AX 路径，无需坐标）
 *   - x/y 坐标模式 → 直接透传截图像素，不做 ×2 / 窗口偏移换算
 *
 * 三种观察模式：
 *   - ax（默认）：只取 AX 树，零视觉 token 成本。
 *   - vision：DeepSeek 视觉观察者（ctx.llm → deepseek-v4-flash-vision-exp，
 *     可配置 visionProvider/visionModel）结构化描述截图；模型不可用时回退 GLM。
 *   - native：截图经 attachments 持久化后以图片块("原生直读")返回 ——
 *     主对话模型（需支持 image 输入）直接看图，零外部 API。
 *   自动降级：AX 树为空（游戏/Canvas/Electron 不可解析）时，
 *   优先 native（route 支持 image）→ vision（有观察模型/GLM key）→ ax。
 */
import { withSession } from './cua.js'
import { cuaCall } from './cua.js'
import { setSnapshot } from './snapshot.js'
import {
  deepseekVisionDescribe,
  glmVisionDescribe,
  glmVisionConfigured,
  routeImageCapable,
} from './vision.js'

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

/** 元素中心坐标（截图像素空间，frame 与截图同空间）。非法/缺失时返回 null。 */
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

/** 构造视觉提问（坐标系 = 截图像素 = 动作坐标）。 */
function visionQuestion(w, h) {
  return `这是一张电脑应用窗口的截图，宽 ${w}px，高 ${h}px（坐标原点左上角，坐标为窗口本地截图像素）。
请用中文描述界面内容，并列出所有可交互元素（按钮、输入框、菜单、链接、图标等），每项格式：
[序号] 类型 "文字" @(x,y)
坐标 x,y 为该元素中心在截图中的像素位置。只输出列表，最多 30 项，不要多余解释。`
}

/** base64 → Buffer。 */
function buf(b64) {
  return Buffer.from(String(b64 || ''), 'base64')
}

/**
 * 把 get_window_state 的截图提交到 attachments（原生直读 / 观察者都需要）。
 * PNG 超过单图字节限额时自动降级为引擎 zoom（整窗 JPEG，≤500px 宽）。
 * @returns {Promise<{ref:object, width:number, height:number, compact:boolean}>}
 */
async function commitScreenshot(ctx, target, state, cfg) {
  const attachments = ctx?.get?.('attachments')
  if (!attachments) {
    throw new Error('当前环境未挂载 attachments 服务，无法持久化截图（原生视觉不可用）。')
  }
  const pngBuf = buf(state.screenshot_png_b64)
  const maxBytes = attachments.imageLimits?.maxImageBytes ?? 5 * 1024 * 1024
  const compact = cfg.nativeImage === 'compact'
    || (cfg.nativeImage !== 'full' && pngBuf.byteLength > maxBytes)

  let data = pngBuf
  let mediaType = state.screenshot_mime_type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  let width = state.screenshot_width
  let height = state.screenshot_height
  let name = `screen-${target.pid}.png`

  if (compact) {
    // 整窗 zoom：x/y 用原始截图像素范围，引擎输出 ≤500px 宽的 JPEG
    const w = state.screenshot_width || 1
    const h = state.screenshot_height || 1
    const zv = await cuaCall('zoom', withSession({
      pid: target.pid,
      window_id: target.window_id,
      x1: 0,
      y1: 0,
      x2: w,
      y2: h,
    }))
    const jpeg = buf(zv?.screenshot_png_b64)
    if (jpeg.byteLength === 0) throw new Error('zoom 降级截图失败：引擎返回空图片。')
    data = jpeg
    mediaType = (zv?.mime_type === 'image/jpeg') ? 'image/jpeg' : 'image/jpeg'
    width = zv?.width || width
    height = zv?.height || height
    name = `screen-${target.pid}-compact.jpg`
  }

  const ref = await attachments.saveImage({ data, mediaType, name })
  return { ref, width, height, compact }
}

/** 观察者（Mode D）：DeepSeek 视觉模型描述，失败回退 GLM。 */
async function describeVision(ctx, cfg, state, target, exec, question) {
  const w = state.screenshot_width || 0
  const h = state.screenshot_height || 0
  const q = question || visionQuestion(w, h)
  // 1. 优先 DeepSeek 观察者（需 attachments 持久化 + llm 服务）
  const attachments = ctx?.get?.('attachments')
  const llm = ctx?.get?.('llm')
  if (llm && attachments) {
    try {
      const { ref, compact } = await commitScreenshot(ctx, target, state, cfg)
      const text = await deepseekVisionDescribe(ctx, cfg, {
        imageRef: ref,
        question: q,
      })
      return `（观察者 ${cfg.visionProvider}/${cfg.visionModel}${compact ? ' · 紧凑图' : ''}）\n${text}`
    } catch (err) {
      // 观察者不可用 → 记录后走 GLM
      return `（DeepSeek 观察者不可用：${err.message}）\n${await glmVisionDescribe({
        imageBase64: state.screenshot_png_b64,
        mimeType: state.screenshot_mime_type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
        question: q,
      }).catch((e2) => `（视觉理解失败：${e2.message}）`)}`
    }
  }
  // 2. 无 llm/attachments：GLM 直传
  return glmVisionDescribe({
    imageBase64: state.screenshot_png_b64,
    mimeType: state.screenshot_mime_type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
    question: q,
  }).catch((err) => `（视觉理解失败：${err.message}）`)
}

/**
 * 执行 screen_observe。
 * @param {object} ctx - Cordis 上下文（llm / attachments 服务）
 * @param {object} args - { window?, mode?, query?, maxElements? }
 * @param {object} cfg - 插件配置（ttlMs / maxElements / nativeImage / visionProvider / visionModel）
 * @param {object} exec - 工具执行上下文（取当前 route）
 */
export async function screenObserve(ctx, args, cfg, exec) {
  const wantMode = args.mode
  const maxElements = args.maxElements || cfg.maxElements || 500

  // 1. 窗口列表
  const winList = await cuaCall('list_windows', { on_screen_only: true })
  const windows = (winList.windows || []).filter((w) => w.window_id && (w.title || w.app_name))

  if (windows.length === 0) {
    return { ok: false, result: '当前没有可见窗口。' }
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
  if (!target && want !== undefined && want !== null && want !== '') {
    const candidates = windows
      .map((w) => `${w.app_name || ''} · ${w.title || ''} · pid=${w.pid}`)
      .join('\n')
    return {
      ok: false,
      result:
        `未找到指定窗口「${String(want)}」，已拒绝继续操作。\n` +
        `当前可见窗口：\n${candidates || '无'}`,
    }
  }
  if (!target) {
    const sorted = [...windows].sort((a, b) => (b.z_index || 0) - (a.z_index || 0))
    target = sorted[0]
  }

  // 3. AX 树（vision / native 模式同时抓截图）
  const needShot = wantMode === 'vision' || wantMode === 'native'
  const gwArgs = {
    pid: target.pid,
    window_id: target.window_id,
    include_screenshot: needShot,
    max_elements: maxElements,
  }
  if (args.query) gwArgs.query = String(args.query)
  let state = await cuaCall('get_window_state', gwArgs)
  const rawElements = Array.isArray(state.elements) ? state.elements : []
  const elements = rawElements.filter(isActionable)
  // 截图缺失（首次 ax 调用后才降级）→ 补抓
  const needShotNow = needShot || (wantMode !== 'vision' && wantMode !== 'native'
    && (Boolean(state.degraded_reason) || rawElements.length === 0) && (await routeImageCapable(ctx, exec) || glmVisionConfigured()))
  if (needShotNow && !state.screenshot_png_b64) {
    const v = await cuaCall('get_window_state', {
      pid: target.pid,
      window_id: target.window_id,
      include_screenshot: true,
      max_elements: maxElements,
    })
    state = { ...state, ...v }
  }

  // 4. 模式决策
  const degraded = Boolean(state.degraded_reason) || rawElements.length === 0
  let effectiveMode = 'ax'
  let visionText = ''
  let image = null

  if (wantMode === 'native') {
    const capable = await routeImageCapable(ctx, exec)
    if (!capable) {
      const { provider, model } = { provider: exec?.agent?.options?.provider, model: exec?.agent?.options?.model }
      return {
        ok: false,
        result: `原生视觉模式（mode="native"）需要当前对话模型支持图片输入，但当前 route ${provider}/${model} 未声明 image 能力。`
          + '请切换到视觉模型（如 deepseek-v4-flash-vision-exp），或使用 mode="vision"（观察者）/ mode="ax"。',
      }
    }
    try {
      const { ref, width, height, compact } = await commitScreenshot(ctx, target, state, cfg)
      image = {
        attachmentId: ref.attachmentId,
        mediaType: ref.mediaType,
        bytes: ref.bytes,
        width: ref.width ?? width,
        height: ref.height ?? height,
        name: ref.name,
      }
      effectiveMode = 'native'
      visionText = compact
        ? '（紧凑图：原始截图超附件限额，已用引擎 zoom 降采样为 ≤500px JPEG）'
        : ''
    } catch (err) {
      return { ok: false, result: `原生截图失败：${err.message}` }
    }
  } else if (wantMode === 'vision') {
    visionText = await describeVision(ctx, cfg, state, target, exec)
    effectiveMode = 'vision'
  } else { // ax 默认
    if (degraded) {
      if (await routeImageCapable(ctx, exec)) {
        try {
          const { ref, width, height } = await commitScreenshot(ctx, target, state, cfg)
          image = { attachmentId: ref.attachmentId, mediaType: ref.mediaType, bytes: ref.bytes, width: ref.width ?? width, height: ref.height ?? height, name: ref.name }
          effectiveMode = 'native'
        } catch {
          effectiveMode = 'ax'
        }
      } else if (glmVisionConfigured()) {
        visionText = await describeVision(ctx, cfg, state, target, exec)
        effectiveMode = 'vision'
      }
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
    snapshotId: state.snapshot_id,
    entries,
    elementCount: state.element_count,
    totalElementCount: state.total_element_count,
    mode: effectiveMode,
    screenshotWidth: state.screenshot_width || null,
    screenshotHeight: state.screenshot_height || null,
  })

  // 6. 渲染
  const lines = elements.map(renderLine)
  let modeNote = `模式=${effectiveMode}`
  if (effectiveMode === 'vision') {
    modeNote += degraded && wantMode !== 'vision' ? '（AX 树为空自动降级）' : ''
  } else if (effectiveMode === 'native') {
    modeNote += degraded && wantMode !== 'native' ? '（AX 树为空自动降级）' : ''
  }
  const header = [
    `窗口: ${safeStr(target.app_name)} · ${safeStr(target.title)}`,
    `pid=${target.pid} window_id=${target.window_id} ${modeNote} 坐标=窗口本地截图像素`,
    effectiveMode === 'ax'
      ? `可见元素 ${lines.length} 个（树共 ${state.element_count}/${state.total_element_count}，快照 ${state.snapshot_id}）`
      : effectiveMode === 'native'
        ? `AX 元素 ${lines.length} 个，原生直读截图如下 ${visionText}`
        : `AX 元素 ${lines.length} 个，视觉描述如下`,
  ].join('\n')

  const body = lines.length > 0
    ? lines.join('\n')
    : effectiveMode === 'native'
      ? '(AX 树无可用元素 —— 请直接看图，用截图坐标点击)'
      : '(AX 树无可用元素)'

  const visionBlock = visionText && effectiveMode === 'vision' ? `\n── 视觉理解 ──\n${visionText}` : ''

  return buildObserveOutput({
    ok: true,
    result: `${header}\n${body}${visionBlock}\n\n提示: 用 computer_click(element=[编号]) 或 computer_click(x=, y=) 操作（坐标为截图像素）。`,
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
    screenshotFile: state.screenshot_out_file || null,
    image,
  })
}

/** Assemble the schema-facing output without serializing an absent image as null. */
export function buildObserveOutput({ image, ...value }) {
  return image ? { ...value, image } : value
}

/**
 * screen_zoom —— 区域截图工具：裁剪窗口某区域（截图像素）为 ≤500px JPEG 直读。
 * 用于"放大某块区域细看"：图片 token 远小于整窗截图。
 * @param {object} ctx
 * @param {object} args - { window?, x1, y1, x2, y2, question? }
 */
export async function screenZoom(ctx, args, cfg, exec) {
  const capable = await routeImageCapable(ctx, exec)
  if (!capable) {
    return { ok: false, result: 'screen_zoom 需要当前对话模型支持图片输入（原生直读），请使用视觉模型（如 deepseek-v4-flash-vision-exp）。' }
  }
  // pid 缺省时按 window_id 从窗口表解析（引擎 zoom 需要 pid）
  let pid = args.pid
  if (!pid) {
    const winList = await cuaCall('list_windows', { on_screen_only: true })
    const hit = (winList.windows || []).find((w) => Number(w.window_id) === Number(args.window_id))
    if (!hit) return { ok: false, result: `window_id ${args.window_id} 不在当前可见窗口列表中。` }
    pid = hit.pid
  }
  const size = await cuaCall('get_window_state', {
    pid,
    window_id: args.window_id,
    include_screenshot: true,
    max_elements: 1,
  })
  const w = size?.screenshot_width || 1
  const h = size?.screenshot_height || 1
  const x1 = args.x1 ?? 0
  const y1 = args.y1 ?? 0
  const x2 = args.x2 ?? w
  const y2 = args.y2 ?? h
  const attachments = ctx?.get?.('attachments')
  if (!attachments) return { ok: false, result: '当前环境未挂载 attachments 服务。' }
  const zv = await cuaCall('zoom', withSession({
    pid,
    window_id: args.window_id,
    x1: Math.max(0, Number(x1)),
    y1: Math.max(0, Number(y1)),
    x2: Math.max(1, Math.min(w, Number(x2))),
    y2: Math.max(1, Math.min(h, Number(y2))),
  }))
  const jpeg = buf(zv?.screenshot_png_b64)
  if (jpeg.byteLength === 0) return { ok: false, result: 'zoom 返回空图片。' }
  const ref = await attachments.saveImage({
    data: jpeg,
    mediaType: 'image/jpeg',
    name: `screen-zoom-${args.window_id}.jpg`,
  })
  const image = {
    attachmentId: ref.attachmentId,
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width ?? zv?.width,
    height: ref.height ?? zv?.height,
    name: ref.name,
  }
  return {
    ok: true,
    result: `区域截图完成（${image.width}×${image.height}px JPEG）：坐标为窗口本地截图像素，点击时直接传截图坐标。`,
    image,
  }
}
