# Cheap wrap-up agent options (#209, child of map #197)

Researched 2026-10-10. Local versions: Claude Code `2.1.296`; machine Apple M4, 24 GB unified memory; Ollama and llama.cpp not installed. Sources are vendor docs, pricing pages and model cards unless marked **[non-primary]**.

## What the agent has to do

The wrap-up prompt in `docs/agents/git-workflow.md` ("Landing a spec") is a fixed eight-step procedure: check clean trees, ask the developer three model-fit questions and count `git diff --stat`, merge each branch with a fixed commit title, run `npm run tsc` / `npm test` / `npm run lint`, add and trim a row in the outcome log of `docs/agents/model-fit.md`, push, delete branches, `gh issue close` with a comment, then check the parent with `gh api`. It needs shell access to git, npm and `gh`, one small Markdown table edit, and exact-order discipline ("stopping at the first failure"). It does no design or code writing.

## Summary

- **Claude Haiku 5.5** (`claude-haiku-5-5`, released 2026-10-07) runs headless today: `claude -p --model haiku` resolved to `claude-haiku-5-5` on the Max login in a local test. It uses the same harness, hooks, CLAUDE.md/AGENTS.md and permission rules as every other run here. It draws on the **same shared Max limit**; Anthropic publishes no per-model weighting.
- **Free-tier APIs** are either too tight for an agent harness or have unpublished quotas. Groq's published table has 8K tokens per minute, smaller than one agent turn's prompt. OpenRouter `:free` models allow 50 requests a day without a $10 top-up. The Gemini API and Mistral publish free-tier numbers only inside the account console. Google's Antigravity CLI (`agy -p`) is the one free option with a real headless agent harness, but its free quota is "meaningful, refreshed weekly" with no numbers.
- **Local open-weight models** cost nothing per run and touch no limit. Claude Code itself can point at a local Ollama server, so the harness stays the same, though Anthropic says it doesn't support routing Claude Code to non-Claude models. On a 24 GB M4 the realistic model is `gpt-oss:20b` (14 GB). There is no public evidence on how reliably it follows a multi-step git/`gh` procedure inside Claude Code.
- **Recommendation:** Haiku 5.5 via `claude -p --model haiku --effort high`. Trial it on the next few wrap-ups and read the run's `total_cost_usd` and `/usage` to size its weekly-limit share. Keep `claude -p` against a local Ollama `gpt-oss:20b` as the fallback if the limit impact turns out to matter.

---

## 1. Claude Haiku via `claude -p`

| Fact | Value | Source |
| --- | --- | --- |
| Current version | Claude Haiku 5.5, API ID and alias `claude-haiku-5-5`, released October 7, 2026, retirement not before October 7, 2027 | [Haiku 5.5 overview](https://platform.claude.com/docs/en/models/haiku-5-5/overview), [models overview](https://platform.claude.com/docs/en/about-claude/models/overview) |
| API price | $0.10 / $0.50 per MTok in/out for prompts up to 100K tokens; $0.50 / $2.50 above 100K; cache read $0.01 (≤100K) | [Haiku 5.5 overview](https://platform.claude.com/docs/en/models/haiku-5-5/overview) |
| Context, effort | 1M context, 128K max output, adaptive thinking, default effort `medium`; first Haiku with effort levels | same; [prompting Haiku 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5) |
| Headless launch | `claude -p --model haiku` works. A local run on 2026-10-10 reported `modelUsage` key `claude-haiku-5-5` and `total_cost_usd` 0.0024 for a one-word reply (API-equivalent figure, not a charge on the Max login). | local test; `--model` aliases in [CLI reference](https://code.claude.com/docs/en/cli-reference) |

**Shared limit and weighting.** Usage from all Claude products "counts towards the same usage limit", with a 5-hour session limit plus weekly limits. Usage depends on "which Claude model you're chatting with" and effort, but no rate per model is given ([how limits work](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work)). The Claude Code article says Opus "uses meaningfully more of your quota", that "Opus costs several times more per turn than Sonnet, and Sonnet more than Haiku", and recommends Haiku for "quick lookups, simple edits, or high-volume scripted runs". It doesn't say how much less quota Haiku draws ([models, usage and limits in Claude Code](https://support.claude.com/en/articles/14552983-models-usage-and-limits-in-claude-code)). That quota tracks API price is an inference from these lines, not a published rule. #200 found that signed-in `-p` runs count against Max's 5-hour and weekly limits, and that Max's monthly API credits don't cover Claude Code ([#200 findings](https://github.com/byronbroughten/byro-repo/blob/research/headless-execution-mechanics/docs/research/headless-execution-mechanics.md)).

**Fit for a fixed procedure.**
- Anthropic positions Haiku 5.5 for "classification, routing, extraction, and subagent tasks" and says it "pairs well with Opus 5.5 and Sonnet 5.5 as a subagent on coding work". It also says "Sonnet 5.5 and Opus 5.5 remain better choices for complex agentic coding tasks" ([announcement](https://www.anthropic.com/claude-haiku-5-5)).
- Agentic scores, Haiku 5.5 / Haiku 4.5 / Sonnet 5.5: Terminal-Bench 4.0 39.2% / 0.0% / 70.6%; OSWorld 2.1 (offline subset) 72.4% / 15.7% / 83.9%; FrontierCode 1.1 46.4% / — / 52.1% (Sonnet at xhigh) ([announcement](https://www.anthropic.com/claude-haiku-5-5)). No SWE-bench, tau-bench, IFEval or IFBench score is published.
- Effort guidance: `medium` for most work including agentic coding; "`high` suits knowledge work, longer agent tasks, and strict instruction following"; at `low` "in long agent prompts, the model is more likely to skip a search, stop early, or skip a check". With a long coding-agent system prompt at `low` it "sometimes stops early and hands the task back". At `low` and `medium` it "sometimes reports a code change as done without running a check" ([prompting Haiku 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5)). Claude Code's system prompt plus this repo's CLAUDE.md/AGENTS.md is a long agent prompt, so `high` is the matching setting.
- Haiku 5.5 adds safety-classifier refusals (`stop_reason: "refusal"`) with no server-side fallback (same page). A git/`gh` procedure is unlikely to trip them, but the runner should treat a refusal as a failed run.

## 2. Free-tier APIs

| Provider | Free limits (as published) | Headless agent harness with shell | Notes |
| --- | --- | --- | --- |
| **Google Antigravity CLI** (`agy`) | Free/individual plan: "a meaningful quota, refreshed weekly", weekly rate limit, no numbers ([plans](https://antigravity.google/docs/plans)). Free models: Gemini 3.8/3.7/3.6 Flash, Gemini 3.1 Pro, Claude Sonnet 4.6 and Opus 4.6 (Thinking), GPT-OSS 120B; the Claude 4.6 and GPT-OSS entries "will be removed on November 2, 2026" ([models](https://antigravity.google/docs/models/)) | Yes. `agy -p` / `--print`, `--model`, `--effort low\|medium\|high`, `--output-format text\|json\|stream-json`. Shell commands "default to Ask and are soft-denied in headless mode unless you grant them" via `permissions.allow` rules such as `command(git)`, or `--dangerously-skip-permissions`. Exit 0 on success, unknown `--model` exits non-zero ([headless](https://antigravity.google/docs/cli/headless/)). Reads `AGENTS.md`, `GEMINI.md`, `.agents/rules/*.md` ([rules](https://antigravity.google/docs/rules/)) | Replaced Gemini CLI for unpaid users on June 18, 2026 ([Gemini CLI quotas](https://geminicli.com/docs/resources/quota-and-pricing/)). Free quota numbers reported by third parties disagree (about 20 agent requests/day vs other figures) **[non-primary]**. Would not load this repo's `.claude/` hooks or permission rules. |
| **Gemini API** (AI Studio key) | Flash and Flash-Lite models (e.g. `gemini-3.8-flash`, `gemini-3.5-flash-lite`) are "Free of charge" on the free tier. Free-tier content is used to improve Google's products, paid is not ([pricing](https://ai.google.dev/gemini-api/docs/pricing)). The rate-limits page gives no free-tier RPM/RPD and points to the AI Studio limits page ([rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)). The old Gemini CLI page lists 250 requests/day, Flash only, for an unpaid API key ([Gemini CLI quotas](https://geminicli.com/docs/resources/quota-and-pricing/)). | Through a third-party harness such as opencode (below) | A wrap-up is tens of requests, so 250/day would be enough if that figure still holds. |
| **Groq** | The table on the rate-limits page: `openai/gpt-oss-120b`, `gpt-oss-20b`, `qwen/qwen3.8-27b` at 30 RPM, 1K RPD, **8K TPM**, 200K TPD. The extracted page text calls these "the base limits for the Developer plan" and puts the Free plan behind a toggle that didn't render ([rate limits](https://console.groq.com/docs/rate-limits)). Third parties quote the same figures as the free plan **[non-primary]**. | Through opencode or similar | 8K TPM is smaller than one agent turn: an agent harness's system prompt plus tool definitions plus AGENTS.md exceeds it. 200K TPD is a handful of turns. Not workable. |
| **OpenRouter `:free` models** | 20 RPM; 50 requests/day with under 10 credits purchased all time, 1,000/day with at least 10 ([limits](https://openrouter.ai/docs/api-reference/limits)) | Through opencode or similar | 50/day might cover one wrap-up. A one-time $10 top-up raises it to 1,000/day. Which free models exist and how they handle tool calls changes over time; not checked. |
| **Mistral** (Free mode / "Experiment" plan) | Free mode exists for "evaluation and prototyping". Limits (requests per second, tokens per minute, tokens per month) appear only in the console's Limits page ([usage and limits](https://docs.mistral.ai/admin/user-management-finops/tier)). Free API usage remains on the Experiment plan, and Devstral 2 is free there ([Vibe 2.0](https://mistral.ai/news/mistral-vibe-2-0/)). Third parties report about 1–2 requests per second/minute and an opt-in to training **[non-primary]**. | Mistral Vibe is listed for Le Chat Pro and Team; no headless mode documented on the page read. opencode otherwise. | Numbers unverifiable without an account. |

**opencode** is the generic harness for these APIs: `opencode run "<prompt>"` runs non-interactively, `-m provider/model` picks the model, `--format json` emits JSON events, and `--auto` auto-approves permissions that aren't explicitly denied ([CLI](https://opencode.ai/docs/cli/)). It reads `AGENTS.md` and falls back to `CLAUDE.md` only when there's no `AGENTS.md` ([rules](https://opencode.ai/docs/rules/)). This repo's `.claude/settings.json` hooks and permission rules would not apply.

## 3. Local open-weight models on Apple Silicon

**Harness: Claude Code against Ollama.** Ollama documents running Claude Code on local models: set `ANTHROPIC_AUTH_TOKEN=ollama`, `ANTHROPIC_API_KEY=""`, `ANTHROPIC_BASE_URL=http://localhost:11434`, then `claude --model <local model>`, or use `ollama launch claude`. It advises a 64K or larger context window ([Ollama: Claude Code](https://docs.ollama.com/integrations/claude-code)). Ollama's Anthropic-compatible API supports messages, streaming, tool calls and thinking blocks. It does not support `tool_choice`, token counting, prompt caching or batches ([Anthropic compatibility](https://docs.ollama.com/api/anthropic-compatibility)).
- With a gateway credential set, "the subscription's usage limits don't apply" to those requests. Anthropic "doesn't support routing Claude Code to non-Claude models through any gateway" ([LLM gateways](https://code.claude.com/docs/en/llm-gateway)). It works per Ollama's docs but is unsupported by Anthropic.
- The advantage is that hooks, skills, CLAUDE.md/AGENTS.md, permission rules and `-p` flags from #200 all stay the same. Only env vars change.
- opencode (above) also supports Ollama as a provider, which avoids the unsupported configuration but drops the repo's hooks.

**Models that fit 24 GB:**

| Model | Download | Context | Notes |
| --- | --- | --- | --- |
| `gpt-oss:20b` | 14 GB | 128K | Tools and thinking. OpenAI says it runs "within 16GB of memory" in MXFP4 ([Ollama](https://ollama.com/library/gpt-oss), [model card](https://huggingface.co/openai/gpt-oss-20b)). Model card lists IFStruct 91.95 and no SWE-bench or tau-bench (Hugging Face page). Ollama recommends it as a general-purpose model for its Anthropic API. |
| `qwen3.5:9b` | 6.6–7.6 GB | 256K | Tools, thinking, vision. The model Ollama's Claude Code page uses as its example ([Ollama](https://ollama.com/library/qwen3.5)). |
| `qwen3.5:27b` | 17–20 GB | 256K | Same family; leaves little room on 24 GB for the OS plus a 64K KV cache (inference, not tested). |
| `qwen3-coder:30b` | 19 GB | 256K | Ollama's recommended coding model for its Anthropic API ([Ollama](https://ollama.com/library/qwen3-coder)); same 24 GB concern. |

llama.cpp (`llama-server`) is the alternative backend. It wasn't researched further here because Ollama documents the Claude Code path directly.

## Recommendation

**Recommendation: Haiku 5.5 via `claude -p --model haiku --effort high`.**

- It is the only option that runs the wrap-up in the exact harness the rest of the runner uses: same `-p` flags, hooks, permission rules and transcript format for peak-context reads. That leaves nothing new to build or validate except the model.
- The wrap-up is a short, scripted shell procedure, which matches Anthropic's stated Haiku use ("high-volume scripted runs", subagent work). Its Terminal-Bench 4.0 score jumped from 0.0% (Haiku 4.5) to 39.2%. `high` effort follows the vendor guidance for strict instruction following inside a long agent prompt.
- It costs weekly-limit share, by an unpublished amount. Measure it: record `total_cost_usd` from `--output-format json` for each trial wrap-up (an API-equivalent size, not a bill) and compare `/usage` before and after.
- **Fallback, if the limit share matters:** the same `claude -p` pointed at a local Ollama `gpt-oss:20b`. It's free, touches no limit, and keeps hooks and rules, but Anthropic doesn't support it and it's unproven on tool-heavy procedures. Antigravity's free tier is second choice: it has a real headless harness and reads AGENTS.md, but the quota is unpublished and the repo's hooks don't apply.
- Not recommended: Groq (8K TPM), OpenRouter free without a top-up (50/day), Mistral (limits unpublished).

**Observation for #204:** most wrap-up steps (1, 3, 5, 6, 7, 8) are deterministic shell commands that a runner script could run itself. Only step 2's questions and step 4's log row need a model, and even the row could be templated from the answers. If the runner does that, the agent's choice matters much less.

## Unknowns

- How much of the weekly limit a Haiku 5.5 `-p` run draws compared with Opus or Sonnet; Anthropic publishes no weighting.
- Haiku 5.5 instruction-following scores (IFEval/IFBench) and any tau-bench-style tool-use benchmark; none published.
- Free-tier numbers for the Gemini API (current), Antigravity, Groq's Free plan toggle and Mistral; all are only in account consoles.
- Whether `gpt-oss:20b` or `qwen3.5:9b` reliably follows an eight-step git/`gh` procedure inside Claude Code's long system prompt, and how slow prompt processing is on an M4 without prompt caching on Ollama's Anthropic endpoint.
- Whether `qwen3.5:27b` or `qwen3-coder:30b` fits with a 64K context in 24 GB under macOS's GPU memory limit; not tested.
- Whether the Antigravity free tier's terms use content for training (the Gemini API free tier does).
