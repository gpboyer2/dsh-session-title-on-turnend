# dsh-session-title-on-turnend

> **标题什么时候改、用哪个模型改、改多长，都拿回你手里。**

[简体中文](README.md) · [English](README.en.md)

![DSH](https://img.shields.io/badge/DSH-DeepSeek%20Harness-1F6FEB?style=flat-square)
![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=node.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ESM-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![Cordis](https://img.shields.io/badge/Cordis-plugin-FF6B6B?style=flat-square)
![tests](https://img.shields.io/badge/tests-17-brightgreen?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-brightgreen?style=flat-square)

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件。每回合答完之后，用你指定的模型（本地 Ollama / LM Studio，或局域网那台 Qwen）把整段对话读一遍，压成一条限定字数的标题，写回会话。

## 它解决什么问题

官方有两套自动标题，时机和模型都不太对：

- 出厂方案：首条消息之后出一次标题，用你正在用的主模型。
- 插件市场里的「随对话更新（实验性）」：每收到一条新提示就重新调一次主模型改标题。

两种都把标题交给主模型，而且改得太早或太勤。本插件换一种做法：

- 想让**每回合答完**之后，用**你指定的模型**总结整段对话、压成一条限定字数的标题。装。
- 想用本地 / 局域网小模型干这活，省主模型 token，也不想让它每条消息都插一脚。装。
- 只想要出厂那样首条起个标题，主模型随手给一个就行。不用装。
- 压根不希望标题被自动改，全部自己手动。别装。

## 工作原理

```
turn/end ──▶ 取本会话全部人类消息 ──▶ 按字节预算选「首条 + 最近窗口」
                                             │
                                             ▼
                                   配置的模型（关思考）+ 256 token
                                             │
                                             ▼
                              按字符数截断（默认 20）──▶ sessionTitle.rename()
```

- 标题仍写在 DSH 自带的 `session-title` 服务的日志事件里，所以列表、回放、恢复后都还在，跟官方标题行为一致。
- `cordis.patch.yml` 禁用出厂的 `first-prompt` provider。若你还装了实验性 `all-prompts` bundle，一并停用——服务只认一个 provider。
- 插件监听 `session/event` 的 `turn/end`：每个回合答完，取该会话**全部人类用户消息**（`source.kind === 'user'`），在字节预算内按「首条锚点 + 最近窗口」选取，交给配置的模型总结。
- 标题调用**请求关思考**（路由支持 `off` 档时），256 token 的预算不会被推理吞光。
- 默认跳过子代理会话，只给顶层会话起标题。同一会话若上一轮还在生成，新一轮会取消旧的，以最新对话为准。

## 快速开始

```sh
# 1. 克隆到 ~/.dsh/plugins/dsh-session-title-on-turnend
git clone https://github.com/gpboyer2/dsh-session-title-on-turnend.git ~/.dsh/plugins/dsh-session-title-on-turnend

# 2. 注册到 profile（命令行管理的 profile，如 web / main）
dsh plugin --profile <你的profile> add link:$HOME/.dsh/plugins/dsh-session-title-on-turnend

# 3. 重启 DSH
```

> `desktop` profile 由 DeepSeek Harness.app 独占，命令行 `dsh plugin --profile desktop …` 会被拒。桌面版在应用内「插件」页安装，或手动改 profile 的 `dependencies` + 软链后重启。

包内的 `cordis.patch.yml` 会自动做两件事：禁用出厂的 `first-prompt` 标题提供方，插入本插件。不用手改 profile 的 patch 文件。

**验证**：重启后随便开个会话问一轮，等它答完几秒，看侧栏标题是否被改成一条总结；同时看 `~/.dsh/logs/session-title-on-turnend.log` 有没有新增行。

## 核心功能

| 能力 | 说明 |
| --- | --- |
| **回合结束才改** | 每个 `turn/end` 之后触发一次，不在会话中途插一脚。 |
| **模型可指定** | `provider` + `model` 指向任意 DSH 路由，默认局域网 `local-31-99/qwen3.8-27b`。 |
| **字数可控** | `maxChars` 按 Unicode 码点截断（汉字算 1），默认 20；emoji 不会被截成半个。 |
| **输入有预算** | `maxInputBytes` 限制送给模型的负载，超了按「首条 + 最近窗口」取舍，不会随会话变长无限膨胀。 |
| **关思考** | 路由支持 `off` 档时请求关闭推理，256 token 输出预算留给标题本身。 |
| **失败不改坏** | 模型没起、路由不存在、超时，只在日志记一行，保留原标题。 |
| **跳过子代理** | 默认只给顶层会话起标题，子代理会话不动。 |
| **抢占旧请求** | 同一会话新一轮开始时取消上一轮未完成的标题生成。 |

## 配置

默认值（`lib/index.js` 的 `DEFAULTS`）：

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关。 |
| `provider` | `magpie` | 标题模型所在路由。 |
| `model` | `local-31-99/qwen3.8-27b` | 标题模型，默认局域网 31.99 的 Qwen3.8 27B。 |
| `maxChars` | `20` | 标题最多多少个字符（按 Unicode 码点，汉字算 1）。 |
| `maxInputBytes` | `16384` | 送给模型的消息负载字节上限。 |
| `maxOutputTokens` | `256` | 输出 token 上限，防思考/跑飞。 |
| `timeoutMs` | `60000` | 单次生成端到端超时。 |
| `skipSubagents` | `true` | 跳过子代理会话。 |
| `debug` | `true` | 写一行诊断到日志。 |
| `logFile` | `~/.dsh/logs/session-title-on-turnend.log` | 日志位置。 |
| `systemPrompt` | `null` | 自定义系统提示；`null` 用内置中文提示。 |

要改就在 profile 的 `cordis.patch.yml` 里覆盖插件行：

```yaml
- id: session-title-on-turnend
  name: dsh-session-title-on-turnend
  config:
    provider: magpie
    model: local-31-99/qwen3.8-27b
    maxChars: 20
```

**字数上限的坑**：`session-title` 服务本身有 `maxTitleBytes` 硬上限（出厂 80 字节）。20 个汉字是 60 字节，安全；想要 30 个汉字就得同时把服务那一行的 `maxTitleBytes` 也放宽（约 90 字节），否则落库时会被服务再截一次。

## 日志与诊断

`~/.dsh/logs/session-title-on-turnend.log` 每回合写一行：触发、选取多少条消息、模型返回、截断前后长度，失败时带原因。

标题没变，先确认：

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

设计约束：标题写回只走 `ctx.sessionTitle` 公开服务，模型调用只走 `ctx.llm` 路由；不碰 UI，不读数据库。

## 开发与测试

```sh
npm test
node --test test/*.test.mjs
```

17 条：消息筛选（只收 `source.kind === 'user'` 且有文本）、20 字符 / emoji 安全截断、控制符清洗、超预算取「首条 + 最近窗口」；以及整链路冒烟——假宿主触发 `turn/end` 走完 生成 → 截断 → 改名，校验请求消息的 v4 `source` 形态、子代理跳过、模型报错时不乱写。

## 已知边界

- **只在回合结束触发**：`turn/end` 之后才动，会话进行到一半不会改标题；回合中途按停止也算一次结束。
- **本地模型没起就只写日志**：请求失败（服务没开、路由不存在、超时）时保留原标题，不会把标题写坏。
- **服务硬上限**：超过 80 字节会被服务再截一次。
- **依赖两个接缝**：`ctx.sessionTitle` 服务与 `ctx.llm` 路由；上游改这两个接缝就得跟着改。
- **必须重启才生效**：host 半是进程内模块。

## 许可证

[MIT](LICENSE)
