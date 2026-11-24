import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

/** 造一个够用的假宿主上下文。 */
function makeCtx({ text = '**这是 一个 标题**', finish = { kind: 'stop' }, seenSources = [] } = {}) {
  const handlers = {}
  const renamed = []
  const ctx = {
    logger: { info() {}, warn() {} },
    on(event, fn) {
      handlers[event] = fn
    },
    sessions: { get: (id) => ctx._live[id] },
    sessionTitle: {
      rename(session, title) {
        renamed.push({ id: session.id, title })
        return { title }
      },
    },
    llm: {
      async resolveCallConfig() {
        return { provider: 'magpie', model: 'local-31-99/qwen3.8-27b', reasoningEffort: 'off' }
      },
      async *stream(options) {
        if (seenSources.length === 0 && options.messages?.[0]?.source) {
          seenSources.push(options.messages[0].source.kind)
        }
        yield { type: 'text-delta', text }
        yield { type: 'finish', reason: finish }
      },
    },
    _live: {},
    _handlers: handlers,
    _renamed: renamed,
  }
  return ctx
}

function makeSession(id, events, header = {}) {
  return { id, header, snapshotEvents: () => events }
}

const flush = () => new Promise((r) => setTimeout(r, 60))

test('turn/end 触发：生成→截断→rename，source 为 plugin:…', async () => {
  const seenSources = []
  const ctx = makeCtx({ text: '**这是一个超过二十个字符限制的非常长的会话标题文本**', seenSources })
  const events = [
    { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我修复登录 bug' }] } },
  ]
  const session = makeSession('s1', events)
  ctx._live['s1'] = session

  apply(ctx, { debug: false })
  ctx._handlers['session/event'](session, { type: 'turn/end', data: { reason: { kind: 'stop' } } })
  await flush()

  assert.equal(ctx._renamed.length, 1)
  assert.equal(ctx._renamed[0].id, 's1')
  assert.equal([...ctx._renamed[0].title].length, 20) // 截断到 20 字符
  assert.equal(seenSources[0], 'plugin:dsh-session-title-on-turnend')
})

test('子代理会话（header.parentSession）跳过', async () => {
  const ctx = makeCtx()
  const events = [
    { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '子任务' }] } },
  ]
  const session = makeSession('sub1', events, { parentSession: 'main' })
  ctx._live['sub1'] = session
  apply(ctx, { debug: false })
  ctx._handlers['session/event'](session, { type: 'turn/end', data: { reason: { kind: 'stop' } } })
  await flush()
  assert.equal(ctx._renamed.length, 0)
})

test('无用户消息时跳过', async () => {
  const ctx = makeCtx()
  const session = makeSession('s2', [])
  ctx._live['s2'] = session
  apply(ctx, { debug: false })
  ctx._handlers['session/event'](session, { type: 'turn/end', data: { reason: { kind: 'stop' } } })
  await flush()
  assert.equal(ctx._renamed.length, 0)
})

test('模型 finish=error 时不 rename', async () => {
  const ctx = makeCtx({ finish: { kind: 'error', failure: { message: 'boom' } } })
  const events = [
    { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] } },
  ]
  const session = makeSession('s3', events)
  ctx._live['s3'] = session
  apply(ctx, { debug: false })
  ctx._handlers['session/event'](session, { type: 'turn/end', data: { reason: { kind: 'stop' } } })
  await flush()
  assert.equal(ctx._renamed.length, 0)
})

test('非 turn/end 事件不触发', async () => {
  const ctx = makeCtx()
  const events = [
    { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] } },
  ]
  const session = makeSession('s4', events)
  ctx._live['s4'] = session
  apply(ctx, { debug: false })
  ctx._handlers['session/event'](session, { type: 'user/message', data: {} })
  await flush()
  assert.equal(ctx._renamed.length, 0)
})
