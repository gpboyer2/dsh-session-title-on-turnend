/**
 * `dsh-session-title-on-turnend`
 *
 * 会话「每回合回答结束」后，自动用**指定模型**（默认局域网 31.99 的
 * Qwen3.8 27B）读取该会话的全部人类用户消息，生成一条限定字符数的标题，
 * 并写回（重命名）该会话标题。
 *
 * 与官方两个自动命名来源的区别：
 *   - 官方 first-prompt：只在首条消息后出一次标题（且用主模型）；
 *   - 官方 all-prompts（截图「随对话更新的标题」）：**每收到一条新提示**就
 *     重新调一次主模型改标题，很吵。
 * 本插件改为：**每个 turn 结束**（用户问完、助手答完）后，用独立的本地/
 * 局域网模型，基于整段对话重新生成一次标题并覆盖。
 *
 * 实现要点：
 *   - 不注册 sessionTitle provider（服务只允许一个、且 automatic 只能
 *     first-prompt/all-prompts，没有「会话结束」节奏）；改为直接调用
 *     `ctx.sessionTitle.rename(session, title)` 把标题写为最终值。
 *   - 只用 ctx 注入的服务（sessionTitle / llm / sessions）与 Node 内置，
 *     不 import 任何 `@deepseek-ai/*` 包，link 安装最稳。
 *
 * @module dsh-session-title-on-turnend
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** 插件 id，需与 cordis.patch.yml 的 id 一致。 */
export const name = 'dsh-session-title-on-turnend'

/** 依赖的宿主服务。 */
export const inject = ['sessionTitle', 'llm', 'sessions']

/** 构造辅助请求消息时使用的 producer-owned source kind（v4 会话格式要求）。 */
const SOURCE_KIND = `plugin:${name}`

/** 服务侧标题硬上限（dsh-base 里 session-title 的 maxTitleBytes=80）。 */
const SERVICE_MAX_TITLE_BYTES = 80

/** 默认配置。 */
export const DEFAULTS = {
  enabled: true,
  /** 标题生成所用路由（provider/model）。默认局域网 31.99 的 Qwen3.8 27B。 */
  provider: 'magpie',
  model: 'local-31-99/qwen3.8-27b',
  /** 标题最多多少个「字符」（按 Unicode 码点计，汉字算 1 个）。 */
  maxChars: 20,
  /** 送给模型的消息负载字节上限。 */
  maxInputBytes: 16384,
  /** 输出 token 上限（防止思考/跑飞；不是标题长度目标）。 */
  maxOutputTokens: 256,
  /** 端到端超时（毫秒）。 */
  timeoutMs: 60000,
  /** 跳过子代理（subagent）会话，只给顶层会话起标题。 */
  skipSubagents: true,
  /** 是否把诊断写成 ~/.dsh/logs 下的日志文件。 */
  debug: true,
  /** 日志文件路径。 */
  logFile: path.join(os.homedir(), '.dsh', 'logs', 'session-title-on-turnend.log'),
  /** 自定义系统提示词；null 用内置中文提示。 */
  systemPrompt: null,
}

/** 校验并合并默认配置。 */
export function resolveConfig(config = {}) {
  const merged = { ...DEFAULTS, ...(config && typeof config === 'object' ? config : {}) }
  const positiveInt = (key) => {
    const value = merged[key]
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`session-title-on-turnend: ${key} must be a positive integer`)
    }
    return value
  }
  const nonEmptyString = (key) => {
    const value = merged[key]
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`session-title-on-turnend: ${key} must be a non-empty string`)
    }
    return value
  }
  return {
    enabled: merged.enabled !== false,
    provider: nonEmptyString('provider'),
    model: nonEmptyString('model'),
    maxChars: positiveInt('maxChars'),
    maxInputBytes: positiveInt('maxInputBytes'),
    maxOutputTokens: positiveInt('maxOutputTokens'),
    timeoutMs: positiveInt('timeoutMs'),
    skipSubagents: merged.skipSubagents !== false,
    debug: merged.debug !== false,
    logFile: typeof merged.logFile === 'string' && merged.logFile.length > 0 ? merged.logFile : DEFAULTS.logFile,
    systemPrompt: typeof merged.systemPrompt === 'string' && merged.systemPrompt.length > 0 ? merged.systemPrompt : null,
  }
}

/* ------------------------------------------------------------------ *
 * 标题文本清洗 / UTF-8 安全截断（与 @deepseek-ai/dsh-session-title 同义）
 * ------------------------------------------------------------------ */

const OSC_SEQUENCE = /(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu
const CSI_SEQUENCE = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu
const ESC_SEQUENCE = /\u001B[@-_]/gu
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu
const DIRECTIONAL_CONTROL = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu

/** 去掉终端控制序列/方向控制符，压缩空白，返回单行。 */
export function cleanTitleText(input) {
  return String(input)
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(ESC_SEQUENCE, '')
    .replace(CONTROL_CHARACTER, '')
    .replace(DIRECTIONAL_CONTROL, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** 按 UTF-8 字节预算截断，不切断码点。 */
export function truncateUtf8(input, maxBytes) {
  if (Buffer.byteLength(input, 'utf8') <= maxBytes) return input
  let used = 0
  let output = ''
  for (const character of input) {
    const bytes = Buffer.byteLength(character, 'utf8')
    if (used + bytes > maxBytes) break
    output += character
    used += bytes
  }
  return output
}

/** 清洗 + 字节截断（与官方 normalizeSessionTitle 等价）。 */
export function normalizeTitle(input, maxBytes = SERVICE_MAX_TITLE_BYTES) {
  return truncateUtf8(cleanTitleText(input), maxBytes).trimEnd()
}

/** 按「字符」（码点）截断到 maxChars 个，不切断码点。 */
export function clampChars(input, maxChars) {
  const chars = Array.from(input)
  if (chars.length <= maxChars) return input
  return chars.slice(0, maxChars).join('')
}

/** 整行被 ** / * / *** 强调包裹时去掉那对标记。 */
const EMPHASIS_WRAPPER = /^(?<marker>\*{1,3})(?<inner>\S(?:.*\S)?)\k<marker>$/u

/**
 * 从模型输出里取标题：第一个非空行，去掉包裹整行的星号强调。
 * 兼容模型无视「只输出一行」、标题在前解释在后的情况。
 */
export function titleFromOutput(text) {
  const line = String(text)
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .find((item) => item.length > 0) ?? ''
  const groups = EMPHASIS_WRAPPER.exec(line)?.groups
  const marker = groups?.marker
  const inner = groups?.inner
  return marker === undefined || inner === undefined || inner.includes(marker) ? line : inner
}

/* ------------------------------------------------------------------ *
 * 会话消息收集与选择
 * ------------------------------------------------------------------ */

/**
 * 从会话事件日志里收集全部「合格的人类用户消息」（source.kind==='user'
 * 且含可见文本），保持时间顺序，带确切 seq。
 */
export function collectUserMessages(events) {
  const messages = []
  for (const event of events) {
    if (!event || event.type !== 'user/message') continue
    const data = event.data
    if (!data || typeof data !== 'object') continue
    if (!data.source || typeof data.source !== 'object' || data.source.kind !== 'user') continue
    const content = Array.isArray(data.content) ? data.content : []
    const text = content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
    if (normalizeTitle(text, Number.MAX_SAFE_INTEGER).length === 0) continue
    messages.push({ seq: event.seq, text })
  }
  return messages
}

/** 把消息数组框成 JSON，用户文本无法破坏结构分隔。 */
function frameMessages(messages) {
  return `Generate the session title from this JSON array of human messages:\n${JSON.stringify(messages)}`
}

/**
 * 预算内选消息：能全放就全放；否则「首条锚点 + 尽量多的最近消息」；
 * 首条自身超预算时按比例截断首条。
 */
export function selectMessages(all, maxInputBytes) {
  if (all.length === 0) return []
  const fits = (selection) => Buffer.byteLength(frameMessages(selection), 'utf8') <= maxInputBytes
  if (fits(all)) return all
  const first = all[0]
  const rest = all.slice(1)
  for (let k = rest.length; k >= 1; k--) {
    const selection = [first, ...rest.slice(rest.length - k)]
    if (fits(selection)) return selection
  }
  let text = first.text
  while (text.length > 0 && Buffer.byteLength(frameMessages([{ seq: first.seq, text }]), 'utf8') > maxInputBytes) {
    text = text.slice(0, Math.floor(text.length * 0.8))
  }
  if (text.length === 0) {
    throw new Error('session-title-on-turnend: the first user message alone exceeds maxInputBytes')
  }
  return [{ seq: first.seq, text }]
}

/* ------------------------------------------------------------------ *
 * 生成标题
 * ------------------------------------------------------------------ */

/** 构造发送给模型的用户消息（v4 producer-owned source）。 */
function buildUserMessage(framedInput) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: framedInput }],
    source: { kind: SOURCE_KIND },
  }
}

/** 默认中文系统提示。 */
function defaultSystemPrompt(config) {
  return [
    '你是会话标题生成器。根据用户提供的 JSON 数组（按时间顺序的人类用户消息），为这段 AI 编程助手会话起一个简洁标题。',
    '只输出标题本身：一行、纯文本，不要引号、前缀、解释、Markdown、XML 或终端控制字符，不要出现代码。',
    `用消息本身的语言（中文对话就用中文），控制在 ${config.maxChars} 个字符以内。`,
    '如果信息很少，也给一个最简短的主题词（例如「问候」），不要解释。',
  ].join('\n')
}

/** 试出路由是否支持 off 档（关思考）；不支持则不带该档位。 */
async function resolveReasoningEffort(llm, provider, model) {
  try {
    await llm.resolveCallConfig({ provider, model, reasoningEffort: 'off' })
    return 'off'
  } catch (error) {
    if (error && error.code === 'UNSUPPORTED_REASONING_EFFORT') return undefined
    throw error
  }
}

/**
 * 生成一次标题：选消息 → 框定 → 调模型（关思考）→ 解析 → 截断。
 * @param ctx 宿主上下文（含 llm 服务）
 * @param config 已解析配置
 * @param session 目标会话（取 id 作归属）
 * @param messages 该会话全部合格用户消息
 * @param signal 外部取消信号（较新的 turn/end 会中止旧生成）
 */
export async function generateTitle(ctx, config, session, messages, signal) {
  if (messages.length === 0) throw new Error('session-title-on-turnend: no user messages to summarize')
  const selected = selectMessages(messages, config.maxInputBytes)
  const framedInput = frameMessages(selected)
  const inputBytes = Buffer.byteLength(framedInput, 'utf8')
  if (inputBytes > config.maxInputBytes) {
    throw new Error(`session-title-on-turnend: input is ${inputBytes} bytes, exceeding maxInputBytes ${config.maxInputBytes}`)
  }

  const system = config.systemPrompt ?? defaultSystemPrompt(config)
  const effort = await resolveReasoningEffort(ctx.llm, config.provider, config.model)

  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason ?? new Error('aborted'))
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => controller.abort(new Error('session-title-on-turnend: timeout')), config.timeoutMs)

  try {
    const options = {
      provider: config.provider,
      model: config.model,
      messages: [buildUserMessage(framedInput)],
      system,
      maxTokens: config.maxOutputTokens,
      sessionId: session.id,
      purpose: 'session-title',
      signal: controller.signal,
    }
    if (effort !== undefined) options.reasoningEffort = effort

    let text = ''
    let finish
    for await (const chunk of ctx.llm.stream(options)) {
      if (!chunk || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'finish') finish = chunk.reason
    }
    if (finish && finish.kind && finish.kind !== 'stop') {
      const detail = finish.failure?.message ? `: ${finish.failure.message}` : ''
      throw new Error(`session-title-on-turnend: title llm finish "${finish.kind}"${detail}`)
    }

    let title = titleFromOutput(text)
    title = cleanTitleText(title)
    title = clampChars(title, config.maxChars)
    title = normalizeTitle(title, SERVICE_MAX_TITLE_BYTES)
    if (title.length === 0) throw new Error('session-title-on-turnend: title model produced no text')
    return title
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

/* ------------------------------------------------------------------ *
 * 插件入口
 * ------------------------------------------------------------------ */

/**
 * 挂载插件：监听 `session/event` 的 `turn/end`，每回合结束后生成并写回标题。
 * @param ctx 宿主上下文
 * @param config 原始插件配置
 */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  if (!resolved.enabled) return

  const log = (msg) => {
    if (resolved.debug) ctx.logger?.info?.(`[${name}] ${msg}`)
    if (resolved.debug) {
      try {
        fs.mkdirSync(path.dirname(resolved.logFile), { recursive: true })
        fs.appendFileSync(resolved.logFile, `${new Date().toISOString()} INFO ${msg}\n`)
      } catch { /* 诊断失败不应当影响功能 */ }
    }
  }
  const warn = (msg) => {
    ctx.logger?.warn?.(`[${name}] ${msg}`)
    try {
      fs.mkdirSync(path.dirname(resolved.logFile), { recursive: true })
      fs.appendFileSync(resolved.logFile, `${new Date().toISOString()} WARN ${msg}\n`)
    } catch { /* ignore */ }
  }

  /** 每个会话一个进行中控制器：较新的 turn/end 会中止旧的生成。 */
  const inFlight = new Map()

  const run = async (session, reasonKind, signal) => {
    try {
      if (resolved.skipSubagents && session.header && session.header.parentSession !== undefined) {
        return
      }
      const messages = collectUserMessages(session.snapshotEvents())
      if (messages.length === 0) {
        log(`session ${session.id}: no eligible user messages, skip`)
        return
      }
      const title = await generateTitle(ctx, resolved, session, messages, signal)
      if (signal.aborted) return
      // 写回前确认会话仍存活（rename 要求 live in store）。
      if (ctx.sessions.get(session.id) !== session) {
        warn(`session ${session.id}: no longer live, skip rename`)
        return
      }
      ctx.sessionTitle.rename(session, title)
      log(`session ${session.id}: renamed to "${title}" (turn/end reason=${reasonKind ?? 'unknown'}, ${messages.length} msgs)`)
    } catch (error) {
      if (signal.aborted) return
      warn(`session ${session.id}: title generation failed: ${error && error.message ? error.message : String(error)}`)
    }
  }

  ctx.on('session/event', (session, event) => {
    if (!event || event.type !== 'turn/end') return
    // 该会话上一轮若还在生成，取消它（以最新一轮为准）。
    const previous = inFlight.get(session.id)
    if (previous) previous.abort(new Error('superseded by newer turn/end'))
    const controller = new AbortController()
    inFlight.set(session.id, controller)
    const reasonKind = event.data?.reason?.kind
    Promise.resolve()
      .then(() => run(session, reasonKind, controller.signal))
      .finally(() => {
        if (inFlight.get(session.id) === controller) inFlight.delete(session.id)
      })
  })

  log(`applied: provider=${resolved.provider} model=${resolved.model} maxChars=${resolved.maxChars}`)
}
