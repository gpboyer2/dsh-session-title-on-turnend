# dsh-session-title-on-turnend

English → [README.en.md](README.en.md)

## 适合你吗？

官方的会话标题有两套自动来源：出厂「首条消息出一次标题」，用的是你正在用的主模型；插件市场里那个「随对话更新的标题（实验性）」，每收到一条新提示就重新调一次主模型改标题。我跟你一样不满意它们——主要是时机和模型都不对。

- 想让**每回合答完**（你问、它答完）之后，用**你指定的模型**——本地 Ollama / LM Studio，或局域网那台 Qwen——把整段对话读一遍，压成一条限定字数的标题。装。
- 想用本地 / 局域网小模型干这活，省主模型的 token，也不想让它每条消息都插一脚。装。
- 你只想要出厂那样首条起个标题，主模型随手给一个就行。不用装。
- 你压根不希望标题被自动改，全部自己手动。别装。

一句话：本插件把「标题什么时候改、用哪个模型改、改多长」这三件事都拿回到你手里。

## 快速开始

三步装好，然后重启。

```sh
# 1. 克隆到 ~/.dsh/plugins/dsh-session-title-on-turnend
git clone https://github.com/gpboyer2/dsh-session-title-on-turnend.git ~/.dsh/plugins/dsh-session-title-on-turnend

# 2. 注册到 profile（命令行管理的 profile，如 web / main）
dsh plugin --profile <你的profile> add link:$HOME/.dsh/plugins/dsh-session-title-on-turnend

# 3. 重启 DSH
```

`desktop` profile 由 DeepSeek Harness.app 独占，命令行 `dsh plugin --profile desktop …` 会被拒。桌面版二选一：

- 在应用内左侧「插件」页安装；
- 或手动三步：`package.json` 的 `dependencies` 加 `"dsh-session-title-on-turnend": "link:/绝对路径"`、`dsh.profile.bundles` 末尾加 `"dsh-session-title-on-turnend"`、在 `node_modules/` 下建同名软链指向插件目录，然后重启。

包内的 `cordis.patch.yml` 会自动做两件事：禁用出厂的 `first-prompt` 标题提供方，插入本插件。不用手改 profile 的 patch 文件。

验证：重启后随便开个会话问一轮，等它答完几秒，看侧栏标题是否被改成一条总结；同时看 `~/.dsh/logs/session-title-on-turnend.log` 有没有新增行。

## 它怎么工作

1. 标题仍写在 DSH 自带的 `session-title` 服务的日志事件里，所以列表、回放、恢复后都还在，跟官方标题行为一致。
2. `cordis.patch.yml` 禁用出厂的 `first-prompt` provider（出厂只在首条消息后出一次标题，用主模型）。若你还装了实验性 `all-prompts` bundle（截图那个「随对话更新」），一并停用——服务只认一个 provider。
3. 插件监听 `session/event` 的 `turn/end`：每个回合答完，取该会话**全部人类用户消息**（`source.kind === 'user'`），在字节预算内按「首条锚点 + 最近窗口」选取，交给配置的模型总结；得到的标题按**字符数**（默认 20，汉字算 1）截断，再 `ctx.sessionTitle.rename()` 写回。
4. 标题调用**请求关思考**（路由支持 `off` 档时），256 token 的预算不会被推理吞光。
5. 默认跳过子代理会话，只给顶层会话起标题。同一会话若上一轮还在生成，新的一轮会取消旧的，以最新对话为准。

## 配置

默认值（`lib/index.js` 的 `DEFAULTS`）：

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `provider` | `magpie` | 标题模型所在路由 |
| `model` | `local-31-99/qwen3.8-27b` | 标题模型（默认局域网 31.99 的 Qwen3.8 27B） |
| `maxChars` | `20` | 标题最多多少个字符（按 Unicode 码点，汉字算 1） |
| `maxInputBytes` | `16384` | 送给模型的消息负载字节上限 |
| `maxOutputTokens` | `256` | 输出 token 上限，防思考/跑飞 |
| `timeoutMs` | `60000` | 单次生成端到端超时 |
| `skipSubagents` | `true` | 跳过子代理会话 |
| `debug` | `true` | 写一行诊断到日志 |
| `logFile` | `~/.dsh/logs/session-title-on-turnend.log` | 日志位置 |
| `systemPrompt` | `null` | 自定义系统提示；`null` 用内置中文提示 |

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

## 测试

```sh
npm test
node --test test/*.test.mjs
```

17 条：消息筛选（只收 `source.kind === 'user'` 且有文本）、20 字符 / emoji 安全截断、控制符清洗、超预算取「首条 + 最近窗口」；以及整链路冒烟——假宿主触发 `turn/end` 走完 生成 → 截断 → 改名，校验请求消息的 v4 `source` 形态、子代理跳过、模型报错时不乱写。

## 已知边界

- **只在回合结束触发**：`turn/end` 之后才动。会话进行到一半不会改标题；回合中途按停止也算一次结束。
- **本地模型没起就只写日志**：模型请求失败（服务没开、路由不存在、超时）时只在日志里记一行，保留原标题，不会把标题写坏。
- **服务硬上限**：见上，超过 80 字节会被服务再截一次。
- **依赖两个接缝**：`ctx.sessionTitle` 服务与 `ctx.llm` 路由；上游改这两个接缝就得跟着改。
- **必须重启才生效**：host 半是进程内模块。

## 许可证

MIT。全文见 [LICENSE](LICENSE)。
