/**
 * vision.js —— 视觉理解模块（模式 B 观察者 + 原生接入）。
 *
 * 视觉理解有三条路径，按优先级自动选择：
 *
 * 1. NATIVE（模式 C 直读，screen_observe mode="native"）：截图经 attachments
 *    持久化后以图片块返回，由"主对话模型"直接看图 —— 零外部 API、零额外 key，
 *    理解质量 = 当前对话模型本身。只需要当前 route 的模型声明 image 输入。
 *
 * 2. DEEPSEEK 观察者（模式 D，screen_observe mode="vision"）：用 ctx.llm 调
 *    DeepSeek 视觉模型（默认 deepseek-v4-flash-vision-exp，配置 visionProvider/
 *    visionModel 可换）对截图做结构化描述 —— 免 ZHIPU key、与主模型风格一致。
 *
 * 3. GLM 兜底（无 llm 服务 / 视觉模型不可用时的最后退路）：智谱 GLM-4V-Flash
 *    免费模型外呼（需 ZHIPU_API_KEY，OpenAI 兼容接口）。仅在前两条都不可用且
 *    AX 树为空时才走这里，控制成本。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const VISION_BASE = process.env.GLM_API_BASE
  || 'https://open.bigmodel.cn/api/paas/v4/chat/completions'

/**
 * 依次尝试的 GLM 视觉模型（免费，第一个优先）。免费模型常有访问量限制（429/1305），
 * 限流时自动回退到下一个。可用 GLM_VISION_MODEL 覆盖首选。
 */
const VISION_MODELS = [
  process.env.GLM_VISION_MODEL || 'glm-4.6v-flash',
  'glm-4v-flash',
  'glm-4.1v-thinking-flash',
]

/** 依次尝试各 key 来源，返回第一个有效值（去空白）。 */
function loadKey() {
  const env = process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY
  if (env) return env.trim()
  const files = [
    process.env.ZHIPU_KEY_FILE,
    join(homedir(), '.zhipu-key'),
    join(homedir(), '.config', 'zhipu-key'),
  ].filter(Boolean)
  for (const f of files) {
    try {
      const v = readFileSync(f, 'utf8').trim()
      if (v) return v
    } catch {
      // 文件不存在/不可读 → 尝试下一个
    }
  }
  return null
}

/** GLM 视觉兜底是否已配置（有 ZHIPU key）。 */
export function glmVisionConfigured() {
  return Boolean(loadKey())
}

/**
 * 取当前调用 agent 的主 route（provider/model），与 read_image 的
 * assertImageCapableRoute 同一取法。
 * @param {object} exec - 工具执行上下文
 * @returns {{provider?:string, model?:string}}
 */
export function currentRoute(exec) {
  const routed = exec?.agent?.session?.requestHeader?.()?.config
  return {
    provider: routed?.provider ?? exec?.agent?.options?.provider,
    model: routed?.model ?? exec?.agent?.options?.model,
  }
}

/**
 * 当前主 route 是否声明 image 输入（决定 Mode C 直读是否可用）。
 * @param {object} ctx - Cordis 上下文（提供 llm 服务）
 * @param {object} exec - 工具执行上下文
 * @returns {Promise<boolean>} route 未解析/llm 不可用时返回 false
 */
export async function routeImageCapable(ctx, exec) {
  try {
    const { provider, model } = currentRoute(exec)
    const llm = ctx?.get?.('llm')
    if (!provider || !model || !llm) return false
    const info = await llm.resolveModelInfo(provider, model)
    return Boolean(info?.inputModalities?.includes?.('image'))
  } catch {
    return false
  }
}

/**
 * 检查一个指定 provider/model 是否声明 image 输入（Mode D 观察者能力检测）。
 * @param {object} ctx
 * @param {string} provider
 * @param {string} model
 * @returns {Promise<boolean>}
 */
export async function modelImageCapable(ctx, provider, model) {
  try {
    const llm = ctx?.get?.('llm')
    if (!llm || !provider || !model) return false
    const info = await llm.resolveModelInfo(provider, model)
    return Boolean(info?.inputModalities?.includes?.('image'))
  } catch {
    return false
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 模式 D：让 DeepSeek 视觉模型（ctx.llm）描述一张已持久化的截图。
 *
 * 与 GLM 外呼不同，图片引用（attachment）必须已通过 attachments.saveImage
 * 持久化 —— 序列化器按附件 id 读回字节，这正是 read_image 同款路径。
 * @param {object} ctx - Cordis 上下文（llm 服务）
 * @param {object} cfg - 插件配置（visionProvider / visionModel）
 * @param {object} opts
 * @param {object} opts.imageRef - attachments.saveImage 返回的引用
 *   {attachmentId, mediaType, bytes, width, height}
 * @param {string} opts.question - 提问
 * @param {number} opts.maxTokens - 输出上限（默认 32768）
 * @returns {Promise<string>} 模型文本回复
 */
export async function deepseekVisionDescribe(ctx, cfg, { imageRef, question, maxTokens = 32768 }) {
  const llm = ctx?.get?.('llm')
  if (!llm) {
    throw new Error('当前环境未挂载 llm 服务，无法使用 DeepSeek 视觉观察者。')
  }
  const provider = cfg.visionProvider || 'deepseek-official'
  const model = cfg.visionModel || 'deepseek-v4-flash-vision-exp'
  const capable = await modelImageCapable(ctx, provider, model)
  if (!capable) {
    throw new Error(
      `视觉观察模型 ${provider}/${model} 未声明 image 输入：请确认该模型已在 harness 中注册为视觉模型` +
      `（llm-deepseek models 或 llm-pi-ai modelOverrides 配 input: [text, image]），` +
      `或改配 visionModel / visionProvider。`,
    )
  }
  const safeMax = Math.max(1, Math.min(Number(maxTokens) || 32768, 32768))
  const streamOnce = async (extra) => {
    let acc = ''
    let accReason = ''
    for await (const chunk of llm.stream({
      provider,
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: question },
          { type: 'image', attachment: imageRef },
        ],
      }],
      maxTokens: safeMax,
      temperature: 0,
      ...extra,
    })) {
      if (chunk.type === 'text-delta') acc += chunk.text
      else if (chunk.type === 'reasoning-delta') accReason += chunk.text
      else if (chunk.type === 'error') {
        throw new Error(`DeepSeek 视觉观察失败: ${chunk.error?.message ?? '未知错误'}`)
      }
    }
    return { acc, accReason }
  }
  // 思考型模型会把预算烧在推理上导致正文为空：优先 low effort，模型不支持时去掉重试。
  let out = ''
  let reason = ''
  try {
    ;({ acc: out, accReason: reason } = await streamOnce({ reasoningEffort: 'low' }))
  } catch (err) {
    if (/UNSUPPORTED_REASONING_EFFORT|does not support reasoning effort/.test(String(err?.message))) {
      ;({ acc: out, accReason: reason } = await streamOnce({}))
    } else {
      throw err
    }
  }
  if (!out.trim()) {
    throw new Error(`DeepSeek 视觉观察未返回文本${reason ? `（模型只输出了思考：${reason.slice(0, 120)}）` : ''}`)
  }
  return out
}

/**
 * GLM 兜底：让 GLM-4V-Flash 描述一张截图（base64 直传，仅当 Mode D 不可用时使用）。
 * @returns {Promise<string>} 模型文本回复
 */
export async function glmVisionDescribe({ imageBase64, mimeType = 'image/png', question, maxTokens = 1024 }) {
  const key = loadKey()
  if (!key) {
    throw new Error(
      '视觉兜底需要 ZHIPU_API_KEY：智谱开放平台 bigmodel.cn 免费申请（模型 glm-4.6v-flash 免费）。' +
      '设置环境变量，或把 key 写入 ~/.zhipu-key（一行一个）后重试。',
    )
  }
  // 智谱免费视觉模型 max_tokens 上限 1024，超限报 1210
  const safeMax = Math.max(1, Math.min(Number(maxTokens) || 1024, 1024))
  const body = {
    model: '', // 每个候选模型循环填充
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        { type: 'text', text: question },
      ],
    }],
    max_tokens: safeMax,
  }

  let lastErr = null
  // 依次尝试候选模型（限流/超限 → 下一个），每个模型最多重试 2 次
  for (const model of VISION_MODELS) {
    body.model = model
    for (let attempt = 0; attempt < 2; attempt++) {
      let res
      try {
        res = await fetch(VISION_BASE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
        })
      } catch (err) {
        lastErr = new Error(`GLM 视觉请求失败: ${err.message}`)
        await sleep(1000 * (attempt + 1))
        continue
      }
      // 限流/访问量过大 → 换下一个模型
      if (res.status === 429 || res.status === 1305) {
        lastErr = new Error(`GLM 视觉模型 ${model} 限流 (${res.status})`)
        await sleep(1500 * (attempt + 1))
        continue
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        // 1305 错误码（访问量过大）也换模型
        if (text.includes('1305')) {
          lastErr = new Error(`GLM 视觉模型 ${model} 访问量过大`)
          continue
        }
        throw new Error(`GLM 视觉 API ${res.status}: ${text.slice(0, 300)}`)
      }
      const data = await res.json().catch(() => null)
      const content = data?.choices?.[0]?.message?.content
      if (typeof content === 'string' && content) return content
      return JSON.stringify(data).slice(0, 2000)
    }
  }
  throw lastErr || new Error('GLM 视觉调用失败（全部候选模型均不可用）')
}

/** 兼容旧引用：visionConfigured / visionDescribe 仍可用（指向 GLM 兜底）。 */
export const visionConfigured = glmVisionConfigured
export const visionDescribe = glmVisionDescribe