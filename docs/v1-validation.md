# V1: first successful real-session compaction

Validated on 2026-09-19 with Kilo VS Code 7.7.5 and OpenRouter `poolside/laguna-s-2.1`. This is an internal experimental V1, not a claim of general production readiness or DICA validation.

## Scenario and observed outcome

The user developed a fictional C motor-controller diagnostic application in Kilo, allowing it to discover and use the local Windows toolchain. Requirements changed after the first implementation: payload size, parser reset/counters, constant naming, and a project path containing spaces. The user interrupted the second implementation phase and attempted compaction after approximately 200K tokens of original conversation context (user estimate).

Several earlier attempts failed. After the V1 payload/output-budget fixes, the user reported that Kilo continued directly from the interrupted work without needing a manual continuation prompt, understood the prior compaction failures, and retained conversational continuity.

Local evidence independently confirms:

- A completed compactor run and an activated handoff anchored to a new native Kilo summary.
- The handoff identifies simulator implementation as the next task, preserves the discovered clang/CMake/Ninja workflow and Windows paths, and distinguishes verified protocol/parser work from the interrupted simulator write.
- A read-only inspection of the session after the summary shows Kilo immediately writing the simulator source, inspecting test/CMake integration, discovering the missing simulator header and creating it. It continued implementation rather than restarting toolchain discovery.

This does not mean the resumed code was flawless: the continuation still encountered an edit error and corrected a missing header. The demonstrated result is task and workflow continuity.

## Recorded metrics

| Metric | Value |
|---|---:|
| Archived messages | 122 |
| Compactor model requests | 29 |
| Compactor elapsed time | 132,675 ms |
| Final request input tokens (provider-reported) | 116,283 |
| Final response completion tokens | 4,061 |
| Final response reasoning tokens | 908 |
| Handoff size | 11,913 characters |
| Tool calls | 6 index, 88 read, 5 search, 1 handoff write |

These are compactor metrics, not the original thread's token count or the duration of Kilo's subsequent native compaction. The successful model chose ordinary message search/read tools; it did not use `rg_transcript` in this run. We cannot attribute the success specifically to the new rg-style tool.

Raw transcripts, reasoning, credentials, local configuration and live-run artifacts remain outside Git. This report records the outcome without embedding the full conversation.

## Changes that preceded success

1. Removed the default accumulated-context character cap. Character counts were an unreliable proxy for the model's context capacity.
2. Removed request-count and plugin execution timeouts. At 180 seconds, the model receives a one-time advisory on its next request, not cancellation.
3. Replaced nested JSON tool responses with plain text, including source IDs and retrieval cursors.
4. Deduplicated overlapping search context and omitted internal tool/duplicate patch metadata from readable messages. Full structured snapshots remain available on disk.
5. Increased OpenRouter completion allowance from 4,096 to 16,384 tokens. In the preceding failure, the provider reported 164,143 input tokens and spent all 4,096 completion tokens on reasoning, returning `finish_reason: length` and null content. That was output exhaustion, not an established input-context overflow.
6. Added provider-returned reasoning, tool activity and API-error debug logs to make failure diagnosis possible.
7. Focused the prompt on continuation state, learned working procedures and evidence references rather than reconstructing every implementation detail.

Reformatting the preceding failed run's same saved tool results reduced their content from approximately 422K to 204K characters. This is a character comparison, not an exact token reduction or a controlled model-quality comparison.

## V1 design boundaries

The plugin runs its own OpenAI-compatible compactor through existing Kilo hooks. It archives the full SDK-visible history in workspace `.kilo/compaction`, supports selective retrieval and real file writes, then lets native Kilo compaction complete. It supplies the activated handoff as labelled historical context on later requests. No Kilo fork is required for this additive implementation.

`tail_turns: 0` disables automatic recent-turn retention in this project. Selected historical excerpts are part of the handoff, not fabricated native conversation turns. Existing Kilo recovery/continuation behavior remains in place.

The native compaction call still runs after the plugin's compactor. API failures can still end a run; persisted files are not an automatic resume implementation. Backend output limits and handoff/read-page sizes remain configurable. Model-authored handoff claims are fallible: for example, a workaround encountered once should not become a universal prohibition in future prompts.

## Follow-up experiments after this checkpoint

- Repeat compaction later in the same task and measure whether previous instructions survive successive handoffs.
- Compare prompt-only and agentic modes on the same recorded scenario.
- Measure token usage and repeated reads; test retrieval deduplication without silently removing necessary evidence.
- Separate confirmed environment constraints from one-off workarounds in the handoff.
- Validate DICA's authentication, tool-call format, reasoning fields and effective context/output limits.
- Investigate an upstream completed-handoff hook to remove the extra native summarization call.

The V1 commit freezes current behavior before these experiments.
