# kilo-handoff

**V1 (1.0.0): first successful real Kilo session compaction validated on 2026-09-19.** The user reported immediate continuation of interrupted C development; local artifacts and session inspection confirm handoff activation and resumed implementation. See [validation, metrics and follow-up experiments](docs/v1-validation.md).

Plugin-first experiment for preserving task state and learned working procedures across Kilo compaction. No Kilo fork and no runtime dependencies. Node 22+ runs the tests; Kilo loads the plugin in its own runtime.

## Install and try it

Requires Node 22+ for setup/tests. Kilo loads the plugin in its own runtime. Validated with Kilo VS Code 7.7.5; experimental hook compatibility with other releases must be checked.

1. Clone or extract the plugin into a permanent directory.
2. Run `npm run setup`. It creates `.env`, `config.local.json` and `kilo.json` for the actual installation path, preserving existing local settings.
3. Enter `OPENROUTER_API_KEY` in `.env`, or configure the shared env file described below. Configure your chosen endpoint/model in `config.local.json`.
4. Run `npm test` and `npm run demo` for offline checks. `npm run test:live` makes billable requests using only the synthetic fixture.
5. Open the project in VS Code. Configure Kilo's normal chat/native compaction provider separately. Use **Developer: Reload Window** after changing plugin code, settings or credentials.
6. Test compaction in a disposable conversation. Inspect `.kilo/compaction/` for the handoff, readable transcript and diagnostics. See [testing](docs/testing.md) and [recorded V1 validation](docs/v1-validation.md).

For deployment to an internal codebase, configure approved internal endpoints in both Kilo and this plugin before opening real work. The OpenRouter example is for external-provider testing. See [private deployment and release instructions](docs/release.md).

## Two modes

**1.1 continuation refinement (live comparison pending).** Agentic mode now replaces the native compaction prompt with an instruction to reproduce the already-completed handoff, rather than asking it to summarize again. The compactor itself still sees earlier summaries through the full SDK snapshot. Prompt-only mode retains the original `output.context` behavior. The coding agent receives a separate continuation instruction only after native summary success; pending compaction calls do not receive it. A user-requested stop/review takes precedence over inferred next work. This is a prompt-level pass-through, not a deterministic replacement of Kilo's summary call; fidelity and reduced redundant reasoning still need live verification. V1 commit `07eab69` remains the validated baseline.

Tool results sent to the compactor are plain text: source IDs, offsets/cursors and text, with no nested JSON envelope. Search output deduplicates overlapping context lines. `read_message` uses the readable transcript view, omitting internal tool metadata and duplicate patch metadata while retaining command/input content, output and errors. The original structured snapshot is untouched. These changes reduce payload size; they do not prune accumulated conversation history or impose a context cap. Debug JSON remains structured for analysis. The OpenRouter example now allows 16,384 completion tokens because returned reasoning shares that allowance with the final answer/tool call; this is distinct from the input context window.

The compactor has an `rg_transcript` tool implementing a literal-search subset of `rg -F -n -C`: case control, surrounding lines, message-role filtering and pagination. It executes JavaScript over the archived transcript, not a shell command or the real rg binary. `transcript.txt` provides a readable line-oriented archive alongside the structured JSON, and the resumed agent is given its path for later retrieval using its ordinary tools. The prompt prioritizes current task, workflow and verification over reconstructing implementation details. It explicitly permits incomplete interrupted edits and asks the compactor to leave references for details that can be retrieved later.

This project's `kilo.json` sets `compaction.tail_turns: 0`, disabling automatic recent-turn retention. The handoff prompt assumes no original messages survive and asks the compactor to select exact excerpts from anywhere in the transcript, labelled by message ID and role. These excerpts stay inside the handoff file; they are not reinserted as native user/assistant turns. Kilo can still replay a pending request through its separate overflow-recovery path.

- `prompt`: adds working-procedure instructions and recent-message orientation through `output.context`. Does not replace `output.prompt`, so Kilo retains its previous-summary assembly. Archives the SDK-visible transcript locally. Makes no extra model requests.
- `agentic`: additionally runs a separate compactor against the configured OpenAI-compatible endpoint. Its only tools are transcript indexing, literal search, bounded reads, draft notes, and replacement of the final handoff file. It preserves returned reasoning fields through tool turns, then sets `output.prompt` to pass through the completed handoff. Once Kilo produces a successful native summary, the handoff becomes persistent context for subsequent calls.

The native compaction call still runs in agentic mode. This is intentionally an additive prototype: it does not replace Kilo's summary message, fabricate tool history, or force the resumed model to read a file. The plugin reads the handoff and injects it directly as labelled historical context through the system hook. This costs extra context and an additional native compaction call, but avoids relying on a second model to accurately reproduce all details in the handoff.

Configured `operatingRules` are supplied on every model request, including before the first compaction. Latest explicit user changes take precedence. Model-generated handoff facts are labelled fallible historical evidence, not higher-priority instructions.

## Credentials shared across projects

There are no credentials in JSON config or the repository. The plugin supports:

1. Process environment (highest precedence).
2. A shared env file selected by `KILO_HANDOFF_ENV_FILE` or the JSON `envFile` absolute path.
3. This repository's `.env` (lowest precedence).

For example, create a central `C:/Users/YOUR_NAME/.config/kilo/handoff.env` containing `DICA_API_KEY=...`, then set this in `config.local.json`:

```json
{
  "mode": "agentic",
  "envFile": "C:/Users/YOUR_NAME/.config/kilo/handoff.env",
  "endpoint": "https://YOUR-DICA-HOST/v1/chat/completions",
  "allowedHosts": ["YOUR-DICA-HOST"],
  "model": "YOUR-DICA-MODEL-ID",
  "apiKeyEnv": "DICA_API_KEY",
  "requestOptions": { "max_tokens": 4096 }
}
```

This path is a convention you choose, not an assumption about Kilo's platform-specific config location. Point all plugin instances to the same JSON using `KILO_HANDOFF_CONFIG` if desired. Files are loaded when the plugin initializes. The plugin does not mutate process-wide environment variables. Remove `apiKeyEnv` for an endpoint that requires no key.

`endpoint` must be the complete chat-completions URL. Only explicitly allowed hostnames are accepted; redirects are rejected. `requestOptions` can carry backend-specific reasoning options, but cannot override the model, messages, tools, or streaming mode. OpenRouter's example enables reasoning; DICA's exact options remain to be confirmed.

Automatic reuse of a key stored in VS Code/Kilo settings is **not implemented**. The inspected public plugin input does not expose a general credential getter. Auth-provider hooks are for implementing providers, not a supported way to read arbitrary existing credentials. We do not scrape VS Code secret storage or private Kilo files.

## Installing in another project

Add this entry to that project's existing `kilo.json` plugin array, preserving other settings:

```json
{
  "plugin": ["file:///D:/data/code/kilo-handoff/src/plugin.mjs"]
}
```

Current upstream uses the default `{ id, server }` export in `plugin.mjs`. `src/legacy.mjs` is a function-export adapter for older loaders; use it only if the installed version requires that format. Disable the earlier prompt-replacing compaction plugin during this experiment. A replacement plugin loaded after this one can still bypass Kilo's `output.context` handling.

## Limits and data

### Inspect compactor reasoning

Set `debugReasoning: true` in the plugin configuration and reload Kilo. It is disabled by default. Each compaction run then writes `debug.md` (readable) and `debug.jsonl` (structured) next to its transcript and handoff. They include provider-returned reasoning, response text, tool arguments/results, and finish reasons; output-limit responses are saved before the error is raised. Logs update after each non-streaming model response, not token by token, and are not displayed inside Kilo's conversation UI. Missing or opaque reasoning cannot be reconstructed. OpenRouter reasoning is already requested by the example config.

These optional logs may contain conversation details and code, like the transcript itself. Request headers are not logged and the configured API key is redacted if echoed. The existing compaction-folder Git ignore applies. To watch from PowerShell after the file appears, use `Get-Content -LiteralPath '<run-directory>/debug.md' -Tail 80 -Wait`.

- `<workspace>/.kilo/compaction/<session-hash>/<run-id>/` holds transcript snapshots, notes, handoffs, and tool-name traces. `active.json` lives in the session directory. The workspace is Kilo's supplied `directory`, not the plugin installation directory. An explicit `stateDirectory` can override this default. Add `.kilo/compaction/` to each project's Git ignore rules (already done here). Snapshots may contain source code and tool output. Reasoning parts and media bytes are omitted. There is no retention cleanup yet. Older prototype artifacts in `.state/` are left untouched; they are not migrated.
- We archive all messages returned by Kilo's session SDK, including the recent tail, not the original database bytes. Already-pruned tool content cannot be recovered. Earlier summaries are available to the compactor in this snapshot.
- A snapshot has a fixed message cutoff. Later messages remain in native history; the plugin does not delete/rewrite messages. Drafts activate only after a new successful summary appears. A crash before activation leaves the draft inactive. Reverted histories without the summary anchor do not receive it. Forked sessions do not inherit it automatically.
- No request-count limit or plugin execution timeout. After 180 seconds (`warnAfterMs`), the next model request receives a one-time elapsed-time advisory that explicitly permits continued work. An in-flight request is not interrupted. Legacy `maxSteps` and `timeoutMs` settings are ignored. There is no accumulated-context cap by default (`maxContextChars` absent or null); a numeric value explicitly opts into local context limiting. Output limits remain: 18,000 handoff characters and 12,000 characters per message read, with offsets for reading further. API/network errors can still end a run. Files already written remain on disk; automatic resume is not implemented. `status.json` records elapsed time, advisory delivery, request count and context size without credentials or raw reasoning.
- Prompt-only mode provides a bounded six-message orientation excerpt; agentic mode can inspect every SDK-visible message through pagination.
- No guarantee that a model will obey a preserved rule. Test actual continuation behavior. This does not change Kilo's cross-model reasoning conversion or native summary roles.

See [upstream findings](docs/upstream.md) for potential small PRs after the prototype has been tested.
