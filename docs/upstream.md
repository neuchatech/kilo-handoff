# Upstream findings and possible minimal changes

Inspected Kilo commit `a85ae672a318b7ce4a6c5b61fd3a542e7d61b9b4` (extension source manifest 7.7.5). Installed release may differ. No upstream files changed and no remote fork or PR created.

## Verified constraints

1. Native compaction supplies `tools: {}` in [`compaction-payload-recovery.ts`](https://github.com/Kilo-Org/kilocode/blob/a85ae672a318b7ce4a6c5b61fd3a542e7d61b9b4/packages/opencode/src/kilocode/session/compaction-payload-recovery.ts). This is a tool-availability constraint, not merely a filesystem permission problem. Our plugin's own read/search/write executor avoids it.
2. The [`compacting` hook](https://github.com/Kilo-Org/kilocode/blob/a85ae672a318b7ce4a6c5b61fd3a542e7d61b9b4/packages/plugin/src/index.ts) accepts session ID and allows context/prompt changes. It does not return a finished summary or replace the native compaction transaction. Our prototype adds its handoff and lets native compaction finish.
3. [`compaction.ts`](https://github.com/Kilo-Org/kilocode/blob/a85ae672a318b7ce4a6c5b61fd3a542e7d61b9b4/packages/opencode/src/session/compaction.ts) uses `compacting.prompt ?? buildPrompt(...)`; replacing the prompt skips the built-in previous-summary wrapping. Prompt-only mode uses context augmentation. Agentic mode now deliberately replaces the prompt with a pass-through instruction after its own compactor has read the full SDK snapshot, including prior summaries.
4. The plugin SDK has `session.messages`, and the HTTP handler returns the session's messages without applying the compactor's tail selection. We archive this SDK view. This cannot restore data already pruned from storage.
5. `experimental.chat.system.transform` provides a place to supply explicit project procedures and labelled handoff context. This does not require forged assistant reasoning or tool results.
6. Replacing `compacting.prompt` only replaces the final user instruction. [`request.ts`](https://github.com/Kilo-Org/kilocode/blob/a85ae672a318b7ce4a6c5b61fd3a542e7d61b9b4/packages/opencode/src/session/llm/request.ts) also supplies the compaction agent's system prompt. The plugin's configuration hook now sets `agent.compaction.prompt` to a copy/resume role in effective agentic mode; [`agent.ts`](https://github.com/Kilo-Org/kilocode/blob/a85ae672a318b7ce4a6c5b61fd3a542e7d61b9b4/packages/opencode/src/agent/agent.ts) applies that configured prompt over the built-in summarizer prompt. Missing credentials select prompt-only fallback before that override is applied.

## Candidate PRs, after integration tests

- Extend the compaction hook input with a snapshot cutoff, previous summary, and retained-tail orientation. This avoids each plugin querying history and guessing boundaries.
- Add an explicit completed-handoff/result hook, with cancellation and atomic activation. This would let a plugin return a handoff directly without an extra native summarization call.
- Optionally enable a tightly scoped read-only transcript tool interface for native compaction. Keep coding tools separate.
- Expose a supported model-invocation service to plugins that resolves provider credentials internally. This could reuse Kilo's configured backend without exposing raw keys or copying HTTP integration logic.

The current public PluginInput exposes a client, directory, worktree, project and server URL, but no general resolved-provider credential getter. The auth loader hook is an extension point for authentication providers, not proof of generic credential access. We use a central env file until a supported integration is confirmed.

## Reasoning and backend references

- [OpenRouter Laguna S 2.1 model](https://openrouter.ai/poolside/laguna-s-2.1): model ID `poolside/laguna-s-2.1`.
- [OpenRouter reasoning documentation](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens): structured reasoning_details are preserved on tool turns; reasoning can consume the completion budget.

The runner preserves returned reasoning_content, or OpenRouter's structured reasoning_details (without duplicating its text reasoning field). It never manufactures reasoning. This applies to the separate compactor's loop; it does not fix or replace Kilo's normal message conversion.
