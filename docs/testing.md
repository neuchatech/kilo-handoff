# Validation and first integration test

The first successful real-session run is documented in [V1 validation](v1-validation.md). That development exercise used an automatically discovered local toolchain. The manual-build scenario below remains a separate optional test of workflows that require user-run builds.

## Automated

`npm test` covers transcript access, reasoning-field replay, default reasoning diagnostics and explicit opt-out, API-key redaction, recent-tail orientation, unchanged `output.prompt` in prompt mode, prepared-handoff pass-through in agentic mode, activation only after a successful summary, persistence across plugin restarts, revert isolation, error propagation, unknown tools, network allowlisting, transcript filtering, and session path isolation.

`npm run demo` uses a scripted model and synthetic SDK-format history. Its output is an implementation smoke test, not evidence that Laguna can produce a good handoff.

`npm run test:live` sends only the synthetic fixture to the configured model. It tests agentic transcript exploration and handoff generation, not the real Kilo lifecycle. Its string checks are diagnostic. Read the generated handoff; a passing string check does not establish correctness.

## Real Kilo scenario

Use a disposable conversation in this repository. Disable other compaction plugins. Start in prompt mode first if isolating loader compatibility, then enable agentic mode. The project sets `compaction.tail_turns` to `0`; the handoff must therefore preserve the latest request itself. For an A/B comparison, repeat with `tail_turns: 2`.

1. Ask it to investigate a fictitious timeout and allow a shell build initially. State that this is a conversation-only test and no commands should actually execute.
2. Correct it: builds require you to run Visual Studio; it should ask and wait. Establish an exact PowerShell command with a Windows path and spaces.
3. Tell it the timeout is finished and verified, and the new task is a retry-limit fix. Tell it that edit is complete but unbuilt.
4. In the latest user message say: "Before anything else, ask me to build the retry-limit change in Visual Studio. Do not return to the timeout investigation."
5. Trigger Kilo's manual compaction action.
6. Inspect the workspace's `.kilo/compaction/` for `transcript.json`, `handoff.md`, and `trace.json`. Confirm the latest correction is in the snapshot, all final headings exist, selected excerpts have source IDs and roles, and a new `active.json` appears after native compaction succeeds. Check that quotes match the source and superseded instructions are not presented as current.
7. Ask it to continue. It should request the build, not call a build command, investigate shell setup, or restart the timeout work. Check that it still uses the established path convention.
8. Add another explicit correction and compact a second time. The newest correction should win while the still-applicable older working procedures survive.

Compare prompt mode with agentic mode using the same scenario and model. Record the exact extension version, backend, compaction duration, handoff size, next action, and any unwanted tool calls. Do not judge quality solely by summary prose.

If plugin loading fails, collect the Kilo plugin-load error, without credentials. Current source supports an object export (`plugin.mjs`); older releases may require the function-export adapter (`legacy.mjs`). If compaction fails before the model call, verify the SDK response shape and installed hook availability before considering a fork.

## What has not been established yet

- Generalization beyond the first successful real Kilo/Laguna session.
- Repeated-compaction behavior over longer sessions.
- DICA authentication, reasoning options, and tool-call compatibility.
- Whether keeping a persistent handoff materially improves over prompt-only compaction.
- Exact handoff reproduction by the native pass-through model and reduced redundant reasoning in a targeted live comparison. Agentic mode replaces the summarization instruction, but retains Kilo's native call and summary storage.
