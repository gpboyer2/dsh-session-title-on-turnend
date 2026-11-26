# dsh-session-title-on-turnend

> 一句话：每回合答完，用指定的模型把整段对话压成一条限定字数的标题，写回会话。

[简体中文](README.md) · [English](README.en.md)

![DSH](https://img.shields.io/badge/DSH-DeepSeek%20Harness-1F6FEB?style=flat-square)
![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=node.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ESM-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![Cordis](https://img.shields.io/badge/Cordis-plugin-FF6B6B?style=flat-square)
![tests](https://img.shields.io/badge/tests-17-brightgreen?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-brightgreen?style=flat-square)

一个 DeepSeek Harness（DSH）插件。每个回合答完，取该会话的全部人类消息，交给指定模型（本地 Ollama / LM Studio，或局域网那台 Qwen）总结，按字符数截断，写回会话标题。

官方的两种自动标题，时机和模型都不可配：出厂只在首条消息之后用主模型起一次标题；实验性插件每收到一条新提示就重调主模型。本插件把触发点、模型、长度拆成三个配置项。

## 工作方式

```
turn/end ──▶ 取本会话全部人类消息 ──▶ 按字节预算选「首条 + 最近窗口」
                                             │
                                             ▼
                                   配置的模型（关思考）+ 256 token
                                             │
                                             ▼
                              按字符数截断（默认 20）──▶ sessionTitle.rename()
```

- 标题仍写在 DSH 自带的 `session-title` 服务的日志事件里，列表、回放、恢复后都还在，与官方标题行为一致。
- `cordis.patch.yml` 禁用出厂的 `first-prompt` provider。若还装了实验性 `all-prompts` bundle，一并停用——服务只认一个 provider。
- 监听 `session/event` 的 `turn/end`，取该会话全部 `source.kind === 'user'` 的消息，在字节预算内按「首条锚点 + 最近窗口」选取，交给配置的模型总结。
- 标题调用请求关思考（路由支持 `off` 档时），256 token 的预算不会被推理吞光。
- 默认跳过子代理会话，只给顶层会话起标题。同一会话若上一轮还在生成，新一轮会取消旧的。

## 快速开始

```sh
# 直接从 GitHub 安装（命令行管理的 profile，如 web / main）
dsh plugin --profile <你的profile> add github:gpboyer2/dsh-session-title-on-turnend

# 本地开发：克隆到 ~/.dsh/plugins/dsh-session-title-on-turnend，改用本地软链安装
git clone https://github.com/gpboyer2/dsh-session-title-on-turnend.git ~/.dsh/plugins/dsh-session-title-on-turnend
dsh plugin --profile <你的profile> add link:$HOME/.dsh/plugins/dsh-session-title-on-turnend

# 重启 DSH
```

`desktop` profile 由 DeepSeek Harness.app 独占，命令行会被拒。桌面版在应用内「插件」页安装，或手动改 profile 的 `dependencies` 加软链后重启。

包内的 `cordis.patch.yml` 会禁用出厂的 `first-prompt` 标题提供方并插入本插件，不用手改 profile 的 patch 文件。

验证：重启后开个会话问一轮，答完几秒，看侧栏标题是否被改成一条总结；同时看 `~/.dsh/logs/session-title-on-turnend.log` 有没有新增行。

## 核心功能

| 能力 | 说明 |
| --- | --- |
| 回合结束才改 | 每个 `turn/end` 之后触发一次，不在会话中途插一脚。 |
| 模型可指定 | `provider` + `model` 指向任意 DSH 路由，默认局域网 `local-31-99/qwen3.8-27b`。 |
| 字数可控 | `maxChars` 按 Unicode 码点截断（汉字算 1），默认 20；emoji 不会被截成半个。 |
| 输入有预算 | `maxInputBytes` 限制送给模型的负载，超了按「首条 + 最近窗口」取舍。 |
| 关思考 | 路由支持 `off` 档时请求关闭推理，输出预算留给标题。 |
| 失败不改坏 | 模型没起、路由不存在、超时，只在日志记一行，保留原标题。 |
| 跳过子代理 | 默认只给顶层会话起标题。 |
| 抢占旧请求 | 同一会话新一轮开始时取消上一轮未完成的标题生成。 |

## 配置

默认值（`lib/index.js` 的 `DEFAULTS`）：

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关。 |
| `provider` | `magpie` | 标题模型所在路由。 |
| `model` | `local-31-99/qwen3.8-27b` | 标题模型，默认局域网 31.99 的 Qwen3.8 27B。 |
| `maxChars` | `20` | 标题最多多少个字符（按 Unicode 码点，汉字算 1）。 |
| `maxInputBytes` | `16384` | 送给模型的消息负载字节上限。 |
| `maxOutputTokens` | `256` | 输出 token 上限，防思考 / 跑飞。 |
| `timeoutMs` | `60000` | 单次生成端到端超时。 |
| `skipSubagents` | `true` | 跳过子代理会话。 |
| `debug` | `true` | 写一行诊断到日志。 |
| `logFile` | `~/.dsh/logs/session-title-on-turnend.log` | 日志位置。 |
| `systemPrompt` | `null` | 自定义系统提示；`null` 用内置中文提示。 |

在 profile 的 `cordis.patch.yml` 里覆盖插件行：

```yaml
- id: session-title-on-turnend
  name: dsh-session-title-on-turnend
  config:
    provider: magpie
    model: local-31-99/qwen3.8-27b
    maxChars: 20
```

**字数上限**：`session-title` 服务本身有 `maxTitleBytes` 硬上限（出厂 80 字节）。20 个汉字是 60 字节，安全；想要 30 个汉字就得同时把服务那一行的 `maxTitleBytes` 放宽到约 90 字节，否则落库时会被服务再截一次。

## 日志与诊断

`~/.dsh/logs/session-title-on-turnend.log` 每回合写一行：触发、选取多少条消息、模型返回、截断前后长度，失败时带原因。

标题没变，先看：

| 现象 | 先看 |
| --- | --- |
| 日志没有新增行 | 插件没加载：profile 的 `dsh.profile.bundles` 是否含它，重启是否完整。 |
| 日志有「skip subagent」 | 当前是子代理会话，按设计跳过。 |
| 日志有模型错误 | 本地模型没起、路由名写错、超时；原标题会保留。 |
| 标题被改短了一截 | 撞上服务的 80 字节硬上限，放宽 `maxTitleBytes` 或调小 `maxChars`。 |

## 架构

```
lib/index.js           插件全部逻辑：turn/end 监听、消息筛选、预算取舍、模型调用、截断、改名
cordis.patch.yml       bundle patch：停用出厂 first-prompt provider，插入本插件
test/                  17 条纯逻辑与整链路冒烟测试
```

标题写回只走 `ctx.sessionTitle` 公开服务，模型调用只走 `ctx.llm` 路由；不碰 UI，不读数据库。

## 测试

```sh
npm test
node --test test/*.test.mjs
```

17 条：消息筛选（只收 `source.kind === 'user'` 且有文本）、20 字符 / emoji 安全截断、控制符清洗、超预算取「首条 + 最近窗口」；以及整链路冒烟——假宿主触发 `turn/end` 走完生成 → 截断 → 改名，校验请求消息的 v4 `source` 形态、子代理跳过、模型报错时不乱写。

## 边界

- 只在回合结束触发。`turn/end` 之后才动，会话进行到一半不会改标题；回合中途按停止也算一次结束。
- 本地模型没起就只写日志。请求失败（服务没开、路由不存在、超时）时保留原标题，不会把标题写坏。
- 服务硬上限。超过 80 字节会被服务再截一次。
- 依赖两个接缝：`ctx.sessionTitle` 服务与 `ctx.llm` 路由；上游改这两个接缝就得跟着改。
- 必须重启才生效。Host 半是进程内模块。

## 许可证

[MIT](LICENSE)
