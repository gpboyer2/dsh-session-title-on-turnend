import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveConfig,
  DEFAULTS,
  cleanTitleText,
  truncateUtf8,
  normalizeTitle,
  clampChars,
  titleFromOutput,
  collectUserMessages,
  selectMessages,
} from '../lib/index.js'

test('resolveConfig 默认值', () => {
  const c = resolveConfig({})
  assert.equal(c.provider, 'magpie')
  assert.equal(c.model, 'local-31-99/qwen3.8-27b')
  assert.equal(c.maxChars, 20)
  assert.equal(c.skipSubagents, true)
  assert.equal(c.systemPrompt, null)
})

test('resolveConfig 拒绝非法数值', () => {
  assert.throws(() => resolveConfig({ maxChars: 0 }), /maxChars must be a positive integer/)
  assert.throws(() => resolveConfig({ provider: '' }), /provider must be a non-empty string/)
})

test('clampChars 按码点截断中文到 20 个', () => {
  const s = '这是一个非常非常长的会话标题它绝对超过了二十个字符的限制'
  const out = clampChars(s, 20)
  assert.equal([...out].length, 20)
  assert.equal(out, [...s].slice(0, 20).join(''))
})

test('clampChars 不切断 emoji 代理对', () => {
  const s = '😀😀😀😀😀'
  const out = clampChars(s, 3)
  assert.equal(out, '😀😀😀')
})

test('titleFromOutput 取第一个非空行并去星号强调', () => {
  assert.equal(titleFromOutput('**修复登录 bug**\n解释一大段'), '修复登录 bug')
  assert.equal(titleFromOutput('\n\n  标题甲  \n第二行'), '标题甲')
  assert.equal(titleFromOutput('*斜体标题*'), '斜体标题')
})

test('cleanTitleText 去控制符并压缩空白', () => {
  assert.equal(cleanTitleText('  a\u001b[31mb\u0007  c  '), 'ab c')
})

test('normalizeTitle 字节安全截断', () => {
  const s = '中'.repeat(40) // 120 bytes
  const out = normalizeTitle(s, 80)
  assert.ok(Buffer.byteLength(out, 'utf8') <= 80)
  assert.equal(out, '中'.repeat(26)) // 78 bytes
})

test('collectUserMessages 只收 user 来源且有文本的消息', () => {
  const events = [
    { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] } },
    { seq: 2, type: 'assistant/message', data: { message: { source: { kind: 'model' }, content: [{ type: 'text', text: 'hi' }] } } },
    { seq: 3, type: 'user/message', data: { source: { kind: 'plugin:x' }, content: [{ type: 'text', text: '插件消息' }] } },
    { seq: 4, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '   ' }] } },
    { seq: 5, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第二句' }] } },
  ]
  const out = collectUserMessages(events)
  assert.deepEqual(out.map((m) => m.seq), [1, 5])
})

test('selectMessages 预算内返回全部', () => {
  const all = [
    { seq: 1, text: 'a' },
    { seq: 2, text: 'b' },
  ]
  assert.deepEqual(selectMessages(all, 100000), all)
})

test('selectMessages 超预算时保留首条 + 最近窗口', () => {
  const all = [
    { seq: 1, text: 'FIRST' },
    { seq: 2, text: 'x'.repeat(2000) },
    { seq: 3, text: 'y'.repeat(2000) },
  ]
  const out = selectMessages(all, 3000)
  assert.equal(out[0].seq, 1) // 首条锚点保留
  assert.ok(Buffer.byteLength(JSON.stringify(out), 'utf8') <= 3000 + 200) // 近似
  assert.ok(out.length >= 1)
})

test('selectMessages 空数组返回空', () => {
  assert.deepEqual(selectMessages([], 100), [])
})

test('DEFAULTS 有稳定默认', () => {
  assert.equal(DEFAULTS.maxChars, 20)
  assert.equal(DEFAULTS.provider, 'magpie')
})
