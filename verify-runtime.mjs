/**
 * 运行时验证脚本（隔离）：加载 dsh-computer-use 插件，捕获其真实注册的工具定义，
 * 直接执行 execute + render，用真实 cua-driver 引擎（后台 daemon）+ attachments/llm 桩，
 * 验证：工具注册、ax 观察、native 直读（图片块 + attachments 落盘）、native 拒绝
 * （text-only route）、screen_zoom、vision 优雅降级、坐标语义标记。
 *
 * 运行：node /Users/Zhuanz/development/plugins/dsh-computer-use/verify-runtime.mjs
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { cuaCall } = await import(join(__dirname, 'lib/cua.js'))
const plugin = (await import(join(__dirname, 'index.js'))).default

// 不使用过期的硬编码 PID/window_id：每次运行从 cua-driver 发现一个真实可见窗口。
const liveWindowList = await cuaCall('list_windows', { on_screen_only: true })
const testWindow = (liveWindowList.windows || []).find((w) =>
  w.window_id && w.pid && w.app_name && !/^(Cua Driver|cua-driver|CursorUIViewService)$/i.test(w.app_name)
)
if (!testWindow) throw new Error('verify-runtime: 当前没有可用于真实观察的可见窗口')
const testWindowRef = String(testWindow.pid)
console.log(`测试窗口: ${testWindow.app_name} pid=${testWindow.pid} window_id=${testWindow.window_id}`)

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

// 验证环境禁用外网：GLM 兜底 fetch 立即失败（不走真实网络）
globalThis.fetch = () => Promise.reject(new Error('network disabled in verify-runtime'))

// ── stub services ────────────────────────────────────────────────
const attachmentRoot = mkdtempSync(join(tmpdir(), 'cu-att-'))
const savedImages = []
const stubAttachments = {
  imageLimits: {
    maxImageBytes: 5 * 1024 * 1024,
    maxImagePixels: 40_000_000,
    maxImagesPerMessage: 20,
    maxMessageImageBytes: 100 * 1024 * 1024,
    mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  },
  async saveImage(input) {
    const ref = {
      attachmentId: `sha256:${'v'.repeat(64)}`,
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
      name: input.name,
    }
    savedImages.push({ ref, bytes: input.data })
    return ref
  },
  async validateImage() {},
  async readImage(ref) { return { ref, data: new Uint8Array([1, 2, 3]) } },
}

function makeLlm({ visionModelCapable }) {
  return {
    async resolveModelInfo(provider, model) {
      return {
        provider,
        id: model,
        inputModalities: visionModelCapable && (model?.includes('vision') || model?.includes('exp'))
          ? ['text', 'image']
          : ['text'],
      }
    },
    async * stream() {
      // 没有真实 key：观察者流直接失败（触发降级链）
      throw new Error('MISSING_CREDENTIAL: no DEEPSEEK_API_KEY (stub)')
    },
  }
}

const services = {
  attachments: stubAttachments,
  llmImage: makeLlm({ visionModelCapable: true }),
  llmText: makeLlm({ visionModelCapable: false }),
  approval: { async request() { return 'allowed-once' } },
}

// ── ctx：只承载插件需要的最小面，注册被捕获 ────────────────────────
const registered = new Map()
const ctx = {
  get: (name) => services[name],
  logger: { info: () => {}, error: () => {} },
  tools: {
    register(def) {
      registered.set(def.name, def)
      return () => registered.delete(def.name)
    },
  },
  toolsRuntime: null,
}

const config = {
  ttlMs: 30000,
  maxElements: 100,
  allowedApps: [],
  cursorTheme: '',
  nativeImage: 'auto',
  visionProvider: 'deepseek-official',
  visionModel: 'deepseek-v4-flash-vision-exp',
}
plugin.apply(ctx, config)

// 断言工具注册 + 新能力
check('插件注册 12-13 个工具', registered.size >= 12 && registered.size <= 13, `注册 ${registered.size} 个：${[...registered.keys()].join(', ')}`)
const modeProp = registered.get('screen_observe').parameters?.properties?.mode
check('screen_observe 含 native 模式', registered.has('screen_observe') && modeProp?.enum?.includes('native'), `mode enum: ${modeProp?.enum?.join('/')}`)
check('screen_zoom 已注册', registered.has('screen_zoom'), '')

// ── 执行辅助 ─────────────────────────────────────────────────────
function agentWith(provider, model) {
  return {
    options: { provider, model },
    session: { requestHeader: () => ({ config: { provider, model } }) },
  }
}

async function runTool(name, args, agent) {
  const def = registered.get(name)
  if (!def) return { error: `tool ${name} not registered` }
  const exec = { agent, signal: new AbortController().signal, get signalSet() { return true } }
  try {
    const value = await def.execute(args, exec)
    return { value }
  } catch (err) {
    return { error: err.message }
  }
}

// 0) 安全护栏回归：无快照时动作直接拒绝（在最前、任何观察之前执行）
{
  services.llm = services.llmText
  const click = await runTool('computer_click', { x: 5, y: 5 }, agentWith('deepseek-official', 'deepseek-v4-flash'))
  check('动作仍要求新鲜快照（无快照拒绝）', click.value?.ok === false && /快照|screen_observe/.test(click.value?.result ?? click.error ?? ''), (click.value?.result ?? click.error ?? '').slice(0, 100))
}

// 1) ax 观察（真实引擎）
{
  services.llm = services.llmText
  const r = await runTool('screen_observe', { window: testWindowRef }, agentWith('deepseek-official', 'deepseek-v4-flash'))
  if (r.error) { check('screen_observe(ax) 真实引擎', false, r.error); }
  else {
    const ok = r.value?.ok === true && typeof r.value?.result === 'string' && r.value.result.length > 20
    check('screen_observe(ax) 真实引擎', ok, (r.value?.result ?? '').split('\n')[0]?.slice(0, 110))
    check(
      'ax 模式无截图时省略 image 字段',
      r.value?.ok === true && !Object.hasOwn(r.value, 'image'),
      JSON.stringify(r.value),
    )
  }
}

// 2) native 拒绝：text-only route
{
  services.llm = services.llmText
  const r = await runTool('screen_observe', { mode: 'native', window: testWindowRef }, agentWith('deepseek-official', 'deepseek-v4-flash'))
  const msg = r.value?.result ?? r.error ?? ''
  check('native 模式：text-only route 优雅拒绝', r.value?.ok === false && /image|视觉|vision/i.test(msg), msg.slice(0, 140))
}

// 2.5) 指定窗口不存在时不得回退到其他窗口
{
  services.llm = services.llmText
  const r = await runTool(
    'screen_observe',
    { window: '__verify_runtime_window_that_does_not_exist__' },
    agentWith('deepseek-official', 'deepseek-v4-flash'),
  )
  const msg = r.value?.result ?? r.error ?? ''
  check('指定窗口不存在时拒绝自动回退', r.value?.ok === false && /未找到指定窗口/.test(msg), msg.split('\n')[0])
}

// 3) native 直读：image-capable route（真实截图 + attachments 落盘 + render 图片块）
{
  services.llm = services.llmImage
  const r = await runTool('screen_observe', { mode: 'native', window: testWindowRef }, agentWith('deepseek-official', 'deepseek-v4-flash-vision-exp'))
  const v = r.value
  const ok = v?.ok === true &&
    typeof v.image === 'object' &&
    typeof v.image.attachmentId === 'string' &&
    v.image.bytes > 0 &&
    v.image.mediaType === 'image/png'
  check('native 直读：图片块 + attachments 落盘', ok, `mode=${v?.mode} ${v?.image?.mediaType} ${v?.image?.bytes}B saved=${savedImages.length}`)
  check(
    'native 模式返回合法 image 对象',
    v?.ok === true &&
      typeof v.image === 'object' &&
      typeof v.image.attachmentId === 'string' &&
      v.image.bytes > 0,
    JSON.stringify(v?.image),
  )
  // render 必须产出图片内容块
  const def = registered.get('screen_observe')
  const blocks = def.output.render({ mode: 'native' }, v)
  const hasImageBlock = Array.isArray(blocks) && blocks.some((b) => b.type === 'image' && b.attachment?.attachmentId)
  check('native render 产出 {type:"image"} 内容块', hasImageBlock, JSON.stringify(blocks.map((b) => b.type)))
  console.log('   result 摘要:', (v?.result ?? '').split('\n').slice(0, 3).join(' | ').slice(0, 220))
}

// 4) screen_zoom（真实引擎区域截图）
{
  services.llm = services.llmImage
  const r = await runTool('screen_zoom', { window_id: testWindow.window_id, x1: 0, y1: 0, x2: 300, y2: 180 }, agentWith('deepseek-official', 'deepseek-v4-flash-vision-exp'))
  const v = r.value
  check('screen_zoom 区域直读', v?.ok === true && v?.image, `${v?.image?.width}x${v?.image?.height} ${v?.image?.mediaType} ${v?.image?.bytes}B`)
  const blocks = registered.get('screen_zoom').output.render({}, v)
  check('screen_zoom render 图片块', Array.isArray(blocks) && blocks.some((b) => b.type === 'image'))
}

// 5) vision 降级链（观察者/MISSING key → GLM 无 key → 错误文本优雅返回）
{
  services.llm = services.llmImage
  const r = await runTool('screen_observe', { mode: 'vision', window: testWindowRef }, agentWith('deepseek-official', 'deepseek-v4-flash'))
  const v = r.value
  const visionPart = (v?.result ?? '').split('── 视觉理解 ──')[1] ?? ''
  check('vision 模式：无 key 不崩溃、观察者降级提示', v?.ok === true && visionPart.length > 0, visionPart.trim().slice(0, 150))
}

// 6) 坐标语义标记
{
  services.llm = services.llmImage
  const r = await runTool('screen_observe', { mode: 'native', window: testWindowRef }, agentWith('deepseek-official', 'deepseek-v4-flash-vision-exp'))
  check('坐标语义 = 截图像素（输出标注）', /截图像素/.test(r.value?.result ?? ''))
}


console.log('\n──────────────────────────────')
const failed = results.filter((r) => !r.ok)
console.log(`结果：${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) {
  for (const f of failed) console.log('  FAIL:', f.name)
  process.exit(1)
}
