/**
 * vision.js —— 视觉兜底模式（模式 B）：截图 → 视觉模型理解界面。
 *
 * 使用智谱 GLM-4V-Flash（免费模型，OpenAI 兼容接口）：
 *   POST https://open.bigmodel.cn/api/paas/v4/chat/completions
 *   Authorization: Bearer <ZHIPU_API_KEY>
 *
 * 仅 AX 树不可用时才走这里（游戏 / Canvas / 自定义渲染界面），控制成本。
 * Key 读取优先级（避免 key 出现在对话/代码中）：
 *   1. 环境变量 ZHIPU_API_KEY / GLM_API_KEY
 *   2. ZHIPU_KEY_FILE 指向的文件
 *   3. ~/.zhipu-key（一行一个 key）
 *   4. ~/.config/zhipu-key
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const VISION_BASE = process.env.GLM_API_BASE
  || 'https://open.bigmodel.cn/api/paas/v4/chat/completions'

/**
 * 依次尝试的视觉模型（免费，第一个优先）。免费模型常有访问量限制（429/1305），
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

/** 视觉模型是否已配置（有 Key）。 */
export function visionConfigured() {
  return Boolean(loadKey())
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 让视觉模型描述一张截图。
 * @param {object} opts
 * @param {string} opts.imageBase64 - PNG/JPEG base64（不含 data: 前缀）
 * @param {string} opts.mimeType - 如 image/png
 * @param {string} opts.question - 提问
 * @param {number} opts.maxTokens - 输出上限
 * @returns {Promise<string>} 模型文本回复
 */
export async function visionDescribe({ imageBase64, mimeType = 'image/png', question, maxTokens = 1024 }) {
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
