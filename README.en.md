# dsh-session-title-on-turnend

> After every turn ends, a configured model compresses the whole conversation into a title of a bounded length and writes it back to the session.

[English](README.en.md) · [简体中文](README.md)

![DSH](https://img.shields.io/badge/DSH-DeepSeek%20Harness-1F6FEB?style=flat-square)
![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=node.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ESM-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![Cordis](https://img.shields.io/badge/Cordis-plugin-FF6B6B?style=flat-square)
![tests](https://img.shields.io/badge/tests-17-brightgreen?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-brightgreen?style=flat-square)

A DeepSeek Harness (DSH) plugin. After every turn ends, it takes all human messages in that session, hands them to a configured model (local Ollama / LM Studio, or the Qwen box on the LAN) to summarize, truncates the result by character count, and writes it back as the session title.

Both built-in automatic title schemes hard-code the timing and the model: the shipped one sets a title once after the first message, using the main model; the experimental plugin calls the main model again on every new prompt. This plugin exposes the trigger point, the model, and the length as three config options.

## How it works

```
turn/end ──▶ collect all human messages in this session ──▶ pick "first + recent window" under a byte budget
                                                                     │
                                                                     ▼
                                                    configured model (thinking off) + 256 tokens
                                                                     │
                                                                     ▼
                                               truncate by character count (default 20) ──▶ sessionTitle.rename()
```

- Titles are still written as log events by DSH's built-in `session-title` service, so they survive listing, replay, and resume, matching official title behavior.
- `cordis.patch.yml` disables the shipped `first-prompt` provider. If the experimental `all-prompts` bundle is also installed, disable it as well: the service accepts only one provider.
- The plugin listens for `turn/end` on `session/event`, takes all messages in that session with `source.kind === 'user'`, selects them within a byte budget by "first anchor + recent window", and hands them to the configured model to summarize.
- The title call requests thinking off when the route supports an `off` level, so the 256-token budget is not consumed by reasoning.
- Subagent sessions are skipped by default; only top-level sessions get titles. If the previous round of the same session is still generating, a new round cancels it.

## Quick start

```sh
# Install straight from GitHub (a CLI-managed profile such as web / main)
dsh plugin --profile <your-profile> add github:gpboyer2/dsh-session-title-on-turnend

# Local development: clone to ~/.dsh/plugins/dsh-session-title-on-turnend and install through a local link
git clone https://github.com/gpboyer2/dsh-session-title-on-turnend.git ~/.dsh/plugins/dsh-session-title-on-turnend
dsh plugin --profile <your-profile> add link:$HOME/.dsh/plugins/dsh-session-title-on-turnend

# Restart DSH
```

The `desktop` profile is owned exclusively by DeepSeek Harness.app, and the CLI rejects it. On the desktop app, install from the in-app Plugins page, or add a symlink to the profile's `dependencies` by hand and restart.

The bundled `cordis.patch.yml` disables the shipped `first-prompt` title provider and inserts this plugin. No manual edit of the profile's patch file is needed.

To verify: after the restart, open a session and ask one question. A few seconds after the answer, check whether the sidebar title was replaced with a summary, and whether `~/.dsh/logs/session-title-on-turnend.log` gained a new line.

## Core features

| Capability | Description |
| --- | --- |
| Only at turn end | Fires once after every `turn/end`; it does not act mid-conversation. |
| Model is configurable | `provider` + `model` point at any DSH route; default is the LAN `local-31-99/qwen3.8-27b`. |
| Length is bounded | `maxChars` truncates by Unicode code point (a Han character counts as 1), default 20; emoji are not cut in half. |
| Input has a budget | `maxInputBytes` caps the payload sent to the model; over budget, it selects by "first + recent window". |
| Thinking off | When the route supports an `off` level, the request turns reasoning off, leaving the output budget to the title. |
| Failures do not corrupt | Model not running, route missing, timeout: one log line only; the old title is kept. |
| Skips subagents | Only top-level sessions get titles by default. |
| Preempts stale requests | A new round in the same session cancels the previous round's unfinished title generation. |

## Configuration

Defaults (`DEFAULTS` in `lib/index.js`):

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Master switch. |
| `provider` | `magpie` | Route that hosts the title model. |
| `model` | `local-31-99/qwen3.8-27b` | Title model; default is Qwen3.8 27B on LAN 31.99. |
| `maxChars` | `20` | Maximum number of characters in the title (by Unicode code point, a Han character counts as 1). |
| `maxInputBytes` | `16384` | Byte cap on the message payload sent to the model. |
| `maxOutputTokens` | `256` | Output token cap; guards against thinking / runaway output. |
| `timeoutMs` | `60000` | End-to-end timeout for one generation. |
| `skipSubagents` | `true` | Skip subagent sessions. |
| `debug` | `true` | Write one diagnostic line to the log. |
| `logFile` | `~/.dsh/logs/session-title-on-turnend.log` | Log location. |
| `systemPrompt` | `null` | Custom system prompt; `null` uses the built-in Chinese prompt. |

Override the plugin entry in the profile's `cordis.patch.yml`:

```yaml
- id: session-title-on-turnend
  name: dsh-session-title-on-turnend
  config:
    provider: magpie
    model: local-31-99/qwen3.8-27b
    maxChars: 20
```

**Character cap**: the `session-title` service itself has a hard `maxTitleBytes` cap (80 bytes out of the box). 20 Han characters is 60 bytes, which is safe; for 30 Han characters, widen `maxTitleBytes` on that service line to about 90 bytes as well, otherwise the service truncates the title again on write.

## Logs and diagnostics

`~/.dsh/logs/session-title-on-turnend.log` gets one line per turn: the trigger, how many messages were selected, the model response, the lengths before and after truncation, and the reason on failure.

If the title did not change, check these first:

| Symptom | Check first |
| --- | --- |
| No new log line | Plugin not loaded: whether the profile's `dsh.profile.bundles` contains it, and whether the restart completed. |
| Log says "skip subagent" | This is a subagent session; skipped by design. |
| Log has a model error | Local model not running, wrong route name, timeout; the old title is kept. |
| Title came out shorter | Hit the service's 80-byte hard cap; widen `maxTitleBytes` or lower `maxChars`. |

## Architecture

```
lib/index.js           all plugin logic: turn/end listener, message filtering, budget selection, model call, truncation, rename
cordis.patch.yml       bundle patch: disable the shipped first-prompt provider, insert this plugin
test/                  17 pure-logic and full-chain smoke tests
```

Titles are written back only through the public `ctx.sessionTitle` service, and model calls go only through `ctx.llm` routes. The plugin does not touch the UI and does not read the database.

## Tests

```sh
npm test
node --test test/*.test.mjs
```

17 tests: message filtering (only `source.kind === 'user'` with text), 20-character / emoji-safe truncation, control-character cleanup, over-budget selection by "first + recent window"; plus a full-chain smoke test where a fake host fires `turn/end` through generate → truncate → rename, verifying the v4 `source` shape of request messages, subagent skipping, and that a model error writes nothing.

## Limits

- Only fires at turn end. It acts after `turn/end`; a session in progress is not renamed. Pressing stop mid-turn also counts as one end.
- If the local model is not running, it only writes a log line. On request failure (service off, route missing, timeout) the old title is kept; the title is never corrupted.
- Service hard cap. Anything over 80 bytes is truncated again by the service.
- Depends on two seams: the `ctx.sessionTitle` service and the `ctx.llm` routes; if upstream changes either seam, this plugin must change with it.
- Requires a restart to take effect. The host half is an in-process module.

## License

[MIT](LICENSE)
