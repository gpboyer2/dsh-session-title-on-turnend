# dsh-session-title-on-turnend

中文 → [README.md](README.md)

## Is this for you?

DeepSeek Harness titles itself from two automatic sources: the shipped one names the session once, right after the first prompt, using the main model you are already talking to; the experimental "title that updates as you chat" re-calls the main model on every new prompt. Both miss on timing and model for me.

- You want every turn, once it finishes, to be summarized into one length-capped title by **a model you pick** — a local Ollama / LM Studio, or the Qwen on your LAN. Install it.
- You want a small local / LAN model doing this, saving main-model tokens, and staying out of every message. Install it.
- You are fine with the shipped behaviour: one title after the first prompt, from the main model. Skip it.
- You never want the title changed automatically at all. Do not install it.

In one line: this plugin hands the three decisions back to you — when the title changes, which model changes it, and how long it may be.

## Quick start

Three steps. Then restart.

```sh
# 1. clone into ~/.dsh/plugins/dsh-session-title-on-turnend
git clone https://github.com/gpboyer2/dsh-session-title-on-turnend.git ~/.dsh/plugins/dsh-session-title-on-turnend

# 2. register it in a CLI-managed profile (web / main / your own)
dsh plugin --profile <your-profile> add link:$HOME/.dsh/plugins/dsh-session-title-on-turnend

# 3. restart DSH
```

The `desktop` profile is owned exclusively by DeepSeek Harness.app, so `dsh plugin --profile desktop …` is refused. On the desktop app, pick one:

- install from the in-app **Plugins** page; or
- do it by hand: add `"dsh-session-title-on-turnend": "link:/absolute/path"` to `dependencies`, append `"dsh-session-title-on-turnend"` to `dsh.profile.bundles`, symlink the plugin directory into `node_modules/`, then restart.

The bundled `cordis.patch.yml` does two things for you: it disables the shipped `first-prompt` title provider and inserts this plugin. There is no profile patch to edit by hand.

To verify, restart, open any session, run one turn, and a few seconds after it finishes check whether the sidebar title became a summary; look for a new line in `~/.dsh/logs/session-title-on-turnend.log`.

## How it works

1. Titles are still written as log events by the built-in `session-title` service, so they survive listing, replay and resume exactly like official titles.
2. `cordis.patch.yml` disables the shipped `first-prompt` provider (which names once after the first prompt, with the main model). If you also installed the experimental `all-prompts` bundle (the "updates as you chat" toggle), turn it off too — the service accepts a single provider.
3. The plugin listens for `session/event` with `turn/end`: after each turn finishes it reads **all human user messages** of the session (`source.kind === 'user'`), picks them within a byte budget by "first anchor + most recent window", and hands them to the configured model. The returned title is truncated by **character count** (default 20, one CJK character counts as 1) and written back with `ctx.sessionTitle.rename()`.
4. The title call **requests thinking off** (when the route supports an `off` effort), so the 256-token budget is not eaten by reasoning.
5. Subagent sessions are skipped by default; only top-level sessions get a title. If the previous turn of a session is still generating, a newer turn cancels it and the latest conversation wins.

## Configuration

Defaults (`DEFAULTS` in `lib/index.js`):

| Field | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | Master switch |
| `provider` | `magpie` | Route that holds the title model |
| `model` | `local-31-99/qwen3.8-27b` | Title model (default: Qwen3.8 27B on LAN 31.99) |
| `maxChars` | `20` | Max title length in characters (Unicode code points; one CJK char = 1) |
| `maxInputBytes` | `16384` | Byte cap on the message payload sent to the model |
| `maxOutputTokens` | `256` | Output token cap, against runaway reasoning |
| `timeoutMs` | `60000` | End-to-end timeout per generation |
| `skipSubagents` | `true` | Skip subagent sessions |
| `debug` | `true` | Write one diagnostic line to the log |
| `logFile` | `~/.dsh/logs/session-title-on-turnend.log` | Log path |
| `systemPrompt` | `null` | Custom system prompt; `null` uses the built-in Chinese prompt |

To change it, override the plugin row in your profile's `cordis.patch.yml`:

```yaml
- id: session-title-on-turnend
  name: dsh-session-title-on-turnend
  config:
    provider: magpie
    model: local-31-99/qwen3.8-27b
    maxChars: 20
```

**The length cap trap**: the `session-title` service has its own `maxTitleBytes` hard limit (80 bytes shipped). 20 CJK characters is 60 bytes, safe; for 30 CJK characters you must also widen `maxTitleBytes` on that service row (about 90 bytes), or the service truncates again on write.

## Tests

```sh
npm test
node --test test/*.test.mjs
```

17 tests: message selection (only `source.kind === 'user'` with text), 20-character / emoji-safe truncation, control-character cleanup, and "first anchor + recent window" under a byte budget; plus an end-to-end smoke that drives a fake host through `turn/end` → generate → truncate → rename, checking the request message's v4 `source` shape, subagent skipping, and that a model error writes nothing.

## Known limits

- **Only on turn end**: it acts after `turn/end`. A session that is still mid-way does not get renamed; stopping a turn also counts as one end.
- **A dead local model only logs**: if the model request fails (service down, unknown route, timeout) it writes one log line, keeps the old title, and never corrupts it.
- **Service hard cap**: see above; anything past 80 bytes is truncated again by the service.
- **Two seams**: depends on the `ctx.sessionTitle` service and the `ctx.llm` route; upstream changes there mean changes here.
- **Restart to take effect**: the host half is an in-process module.

## License

MIT. Full text: [LICENSE](LICENSE).
