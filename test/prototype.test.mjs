import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import plugin from "../src/plugin.mjs";
import { runAgent, validateEndpoint } from "../src/agent.mjs";
import { atomicWrite, normalizeMessages, sessionDirectory } from "../src/storage.mjs";
import { history, handoff, message, scriptedModel } from "./fixtures.mjs";
import { loadConfig } from "../src/config.mjs";
import { createServer } from "node:http";
import { transcriptLines, rgTranscript } from "../src/search.mjs";
import { formatToolOutput } from "../src/tool-output.mjs";

test("plain-text search output deduplicates overlapping lines while retaining citations and cursor", () => {
  const lines = transcriptLines(normalizeMessages([message("source", "user", "before\nneedle one\nneedle two\nafter")]));
  const result = rgTranscript(lines, { pattern: "needle", context: 1 });
  const text = formatToolOutput(result);
  assert.equal(text.split("needle one").length - 1, 1);
  assert.equal(text.split("needle two").length - 1, 1);
  assert.match(text, /MESSAGE 0 \| source/);
  assert.match(text, /next_line: none/);
  assert.ok(text.length < JSON.stringify(result).length);
});

test("read_message delivers decoded tool text without internal metadata; original remains archived", async () => {
  const dir = await temp();
  const snapshotPath = path.join(dir, "transcript.json");
  const records = normalizeMessages([{ info: { id: "tool-source", role: "assistant" }, parts: [{ type: "tool", tool: "read", state: { status: "completed", input: { filePath: "D:\\app space\\main.c" }, output: "line one\nline two", metadata: { duplicatePatch: "UNNEEDED_METADATA" } } }] }]);
  await atomicWrite(snapshotPath, JSON.stringify(records));
  let requestCount = 0;
  await runAgent({ snapshotPath, workDirectory: dir, config, fetchImpl: async (_, request) => {
    const body = JSON.parse(request.body);
    if (++requestCount === 2) {
      const content = body.messages.at(-1).content;
      assert.match(content, /line one\nline two/);
      assert.ok(content.includes("D:\\app space\\main.c"));
      assert.doesNotMatch(content, /UNNEEDED_METADATA/);
    }
    const name = requestCount === 1 ? "read_message" : "write_handoff";
    return Response.json({ choices: [{ message: { role: "assistant", tool_calls: [{ id: String(requestCount), function: { name, arguments: JSON.stringify(requestCount === 1 ? { index: 0 } : { text: handoff }) } }] } }] });
  } });
  assert.match(await readFile(snapshotPath, "utf8"), /UNNEEDED_METADATA/);
});

test("rg-style literal search finds tool-output lines with context and source IDs", () => {
  const records = normalizeMessages([{ info: { id: "source", role: "assistant" }, parts: [{ type: "tool", tool: "bash", state: { status: "completed", input: { command: "ctest" }, output: "before\nAll tests passed\nafter" } }] }]);
  const lines = transcriptLines(records);
  const result = rgTranscript(lines, { pattern: "TESTS PASSED", context: 1 });
  assert.equal(result.matches[0].id, "source");
  assert.deepEqual(result.matches[0].lines.map(l => l.text), ["before", "All tests passed", "after"]);
  assert.equal(lines[result.matches[0].line - 1].text, "All tests passed");
  assert.equal(rgTranscript(lines, { pattern: "tests.*passed" }).matches.length, 0);
});

test("rg-style pagination covers matches without losing late results", () => {
  const lines = transcriptLines(normalizeMessages(Array.from({ length: 15 }, (_, i) => message(`m${i}`, "user", "Build command"))));
  const first = rgTranscript(lines, { pattern: "Build command", context: 0 });
  const next = rgTranscript(lines, { pattern: "Build command", start_line: first.next_line, context: 0 });
  assert.equal(first.matches.length + next.matches.length, 15);
  assert.equal(next.matches.at(-1).id, "m14");
  assert.equal(next.next_line, null);
});

const base = path.resolve(".state/tests");
async function temp() { await mkdir(base, { recursive: true }); return mkdtemp(path.join(base, "run-")); }
const config = { mode: "agentic", endpoint: "http://127.0.0.1:8080/v1/chat/completions", model: "synthetic", operatingRules: "Ask user for Visual Studio builds." };

test("debug records provider HTTP error details", async () => {
  const dir = await temp();
  const snapshotPath = path.join(dir, "transcript.json");
  await atomicWrite(snapshotPath, JSON.stringify(normalizeMessages(history)));
  await assert.rejects(runAgent({ snapshotPath, workDirectory: dir, config: { ...config, debugReasoning: true },
    fetchImpl: async () => Response.json({ error: { code: "context_length_exceeded", message: "Synthetic context error" } }, { status: 400 }),
  }), /HTTP 400/);
  const log = JSON.parse((await readFile(path.join(dir, "debug.jsonl"), "utf8")).trim());
  assert.equal(log.type, "api_error");
  assert.equal(log.detail.code, "context_length_exceeded");
});

test("opt-in debug saves returned reasoning even on output-limit failure and redacts API key", async () => {
  const dir = await temp();
  const snapshotPath = path.join(dir, "transcript.json");
  await atomicWrite(snapshotPath, JSON.stringify(normalizeMessages(history)));
  await assert.rejects(runAgent({ snapshotPath, workDirectory: dir,
    config: { ...config, debugReasoning: true, apiKeyEnv: "KEY" }, environment: { KEY: "fake-secret-123" },
    fetchImpl: async () => Response.json({ choices: [{ finish_reason: "length", message: { role: "assistant", content: null, reasoning: "Synthetic reasoning fake-secret-123" } }] }),
  }), /output limit/);
  for (const file of ["debug.md", "debug.jsonl"]) {
    const text = await readFile(path.join(dir, file), "utf8");
    assert.match(text, /Synthetic reasoning/);
    assert.doesNotMatch(text, /fake-secret-123/);
  }
});

test("reasoning debugging is disabled by default", async () => {
  const dir = await temp();
  const snapshotPath = path.join(dir, "transcript.json");
  await atomicWrite(snapshotPath, JSON.stringify(normalizeMessages(history)));
  await runAgent({ snapshotPath, workDirectory: dir, config, fetchImpl: scriptedModel() });
  assert.equal((await readdir(dir)).includes("debug.md"), false);
});

test("default permits accumulated context beyond the former 220000 character cap", async () => {
  const dir = await temp();
  const snapshotPath = path.join(dir, "transcript.json");
  await atomicWrite(snapshotPath, JSON.stringify(normalizeMessages(Array.from({ length: 32 }, (_, i) => message(`large${i}`, "user", "evidence ".repeat(1500))))));
  let requests = 0;
  const result = await runAgent({ snapshotPath, workDirectory: dir, config, fetchImpl: async (_, request) => {
    const body = JSON.parse(request.body);
    assert.equal(body.tool_choice, undefined);
    requests++;
    if (requests === 3) {
      assert.ok(JSON.stringify(body.messages).length > 350000);
      assert.ok(body.messages.filter(m => m.role === "tool").every(m => !m.content.startsWith("ERROR:")));
      return Response.json({ choices: [{ message: { role: "assistant", tool_calls: [{ id: "final", function: { name: "write_handoff", arguments: JSON.stringify({ text: handoff }) } }] } }] });
    }
    return Response.json({ choices: [{ message: { role: "assistant", tool_calls: Array.from({ length: 16 }, (_, i) => ({ id: `r${requests}-${i}`, function: { name: "read_message", arguments: JSON.stringify({ index: (requests - 1) * 16 + i }) } })) } }] });
  } });
  assert.equal(result.handoff, handoff);
  const status = JSON.parse(await readFile(path.join(dir, "status.json"), "utf8"));
  assert.equal(status.maxContextChars, null);
  assert.equal(status.finalizing, false);
});

test("API error leaves transcript and notes on disk without retrying identical request", async () => {
  const dir = await temp();
  const snapshotPath = path.join(dir, "transcript.json");
  await atomicWrite(snapshotPath, JSON.stringify(normalizeMessages(history)));
  let requests = 0;
  await assert.rejects(runAgent({ snapshotPath, workDirectory: dir, config, fetchImpl: async () => {
    requests++;
    if (requests > 1) return Response.json({ error: { code: "context_length_exceeded" } }, { status: 400 });
    return Response.json({ choices: [{ message: { role: "assistant", tool_calls: [{ id: "notes", function: { name: "append_notes", arguments: JSON.stringify({ text: "Retain observed workflow." }) } }] } }] });
  } }), /HTTP 400/);
  assert.equal(requests, 2);
  assert.match(await readFile(path.join(dir, "notes.md"), "utf8"), /Retain observed workflow/);
  assert.equal(JSON.parse(await readFile(snapshotPath, "utf8")).length, history.length);
  assert.equal(JSON.parse(await readFile(path.join(dir, "status.json"), "utf8")).status, "failed");
});

test("explicit opt-in context cap switches exploration to final handoff", async () => {
  const dir = await temp();
  const snapshotPath = path.join(dir, "transcript.json");
  const records = normalizeMessages(Array.from({ length: 90 }, (_, i) => message(`large${i}`, "user", "Evidence ".repeat(1500))));
  await atomicWrite(snapshotPath, JSON.stringify(records));
  let requests = 0, forced = false;
  const result = await runAgent({ snapshotPath, workDirectory: dir, config: { ...config, maxContextChars: 220000 }, fetchImpl: async (_, request) => {
    const body = JSON.parse(request.body);
    assert.ok(JSON.stringify(body.messages).length < 220000);
    requests++;
    if (body.tool_choice) {
      forced = true;
      assert.equal(body.tool_choice.function.name, "write_handoff");
      assert.deepEqual(body.tools.map(t => t.function.name), ["write_handoff"]);
      return Response.json({ choices: [{ message: { role: "assistant", tool_calls: [{ id: "done", function: { name: "write_handoff", arguments: JSON.stringify({ text: handoff }) } }] } }] });
    }
    return Response.json({ choices: [{ message: { role: "assistant", tool_calls: Array.from({ length: 16 }, (_, i) => ({ id: `read${requests}-${i}`, function: { name: "read_message", arguments: JSON.stringify({ index: i }) } })) } }] });
  } });
  assert.equal(result.handoff, handoff);
  assert.ok(forced);
  assert.ok(requests < 24);
  const status = JSON.parse(await readFile(path.join(dir, "status.json"), "utf8"));
  assert.equal(status.status, "completed");
  assert.equal(status.transcriptMessages, 90);
});

test("request count and elapsed time do not stop exploration", async () => {
  const dir = await temp();
  const snapshotPath = path.join(dir, "transcript.json");
  await atomicWrite(snapshotPath, JSON.stringify(normalizeMessages(history)));
  let requests = 0;
  const result = await runAgent({ snapshotPath, workDirectory: dir, config: { ...config, maxSteps: 2, timeoutMs: 1 }, now: () => requests * 200000, fetchImpl: async (_, request) => {
    const body = JSON.parse(request.body);
    requests++;
    const name = requests < 27 ? "list_messages" : "write_handoff";
    assert.equal(body.tool_choice, undefined);
    assert.equal(request.signal, undefined);
    if (requests === 27) assert.equal(body.messages.filter(m => m.role === "user" && m.content.startsWith("Elapsed-time advisory")).length, 1);
    return Response.json({ choices: [{ message: { role: "assistant", tool_calls: [{ id: String(requests), function: { name, arguments: JSON.stringify(name === "write_handoff" ? { text: handoff } : {}) } }] } }] });
  } });
  assert.equal(result.handoff, handoff);
  assert.equal(requests, 27);
});

test("default storage writes and activates handoff inside the supplied workspace .kilo directory", async () => {
  const directory = await temp();
  let messages = structuredClone(history);
  const hooks = await plugin.server({ directory, client: { session: { messages: async () => ({ data: messages }) } } },
    { config, fetchImpl: scriptedModel() });
  await hooks["experimental.session.compacting"]({ sessionID: "workspace-test" }, { context: [] });
  const folder = sessionDirectory(path.join(directory, ".kilo", "compaction"), directory, "workspace-test");
  const runs = await readdir(folder);
  assert.equal(runs.length, 1);
  assert.equal(await readFile(path.join(folder, runs[0], "handoff.md"), "utf8"), handoff);
  const snapshot = JSON.parse(await readFile(path.join(folder, runs[0], "transcript.json"), "utf8"));
  assert.equal(snapshot.at(-1).id, "m09");
  messages.push(message("new-summary", "assistant", "Native summary", { summary: true, finish: "stop" }));
  await hooks["experimental.compaction.autocontinue"]({ sessionID: "workspace-test" });
  const active = JSON.parse(await readFile(path.join(folder, "active.json"), "utf8"));
  assert.equal(active.handoffPath, path.join(folder, runs[0], "handoff.md"));
});
async function setup(overrides = {}, fetchImpl = scriptedModel()) {
  const stateDirectory = await temp();
  let messages = structuredClone(history);
  const input = { directory: "D:\\synthetic", client: { session: { messages: async args => {
    assert.equal(args.path.id, "s1"); assert.equal(args.query.directory, input.directory);
    return { data: messages };
  } } } };
  const options = { config: { ...config, stateDirectory, ...overrides }, fetchImpl };
  const hooks = await plugin.server(input, options);
  return { hooks, input, options, stateDirectory, set: x => { messages = x; } };
}

test("agent loop reads transcript, writes handoff, preserves real reasoning and tool results", async () => {
  const dir = await temp();
  const snapshotPath = path.join(dir, "transcript.json");
  await atomicWrite(snapshotPath, JSON.stringify(normalizeMessages(history)));
  const result = await runAgent({ snapshotPath, workDirectory: dir, config, fetchImpl: scriptedModel((body, round) => {
    assert.equal(body.stream, false);
    if (round) {
      const assistant = body.messages.find(m => m.role === "assistant");
      assert.equal(assistant.reasoning_content, "Synthetic reasoning fixture");
      assert.equal(assistant.reasoning_details[0].type, "reasoning.text");
      assert.ok(body.messages.some(m => m.role === "tool"));
    }
  }) });
  assert.equal(result.handoff, handoff);
  assert.equal(await readFile(path.join(dir, "handoff.md"), "utf8"), handoff);
  assert.equal(result.trace.length, 6);
});

test("plugin leaves output.prompt untouched and includes latest retained messages", async () => {
  const { hooks } = await setup({ mode: "prompt" }, () => { throw new Error("Network must not be called"); });
  const output = { context: [] };
  await hooks["experimental.session.compacting"]({ sessionID: "s1" }, output);
  assert.equal(output.prompt, undefined);
  assert.match(output.context.join("\n"), /Latest correction/);
});

test("agentic mode passes through a completed handoff and resumes only after native summary succeeds", async () => {
  const t = await setup();
  const output = { context: [] };
  await t.hooks["experimental.session.compacting"]({ sessionID: "s1" }, output);
  assert.ok(output.prompt.includes(handoff));
  assert.match(output.prompt, /Output the text.*verbatim/);
  assert.doesNotMatch(output.prompt, /Prepare a handoff for another instance/);
  assert.deepEqual(output.context, []);
  const during = { system: [] };
  await t.hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, during);
  assert.doesNotMatch(during.system.join("\n"), /Compaction is complete/);
  t.set([...history, message("native", "assistant", handoff, { summary: true, finish: "stop" })]);
  await t.hooks["experimental.compaction.autocontinue"]({ sessionID: "s1" });
  const after = { system: [] };
  await t.hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, after);
  assert.match(after.system.join("\n"), /Compaction is complete/);
  assert.match(after.system.join("\n"), /stopping for review/);
  // Next compaction must not inject the prior resume instruction into its native summarizer.
  const nextHooks = await plugin.server(t.input, { ...t.options, fetchImpl: scriptedModel() });
  await nextHooks["experimental.session.compacting"]({ sessionID: "s1" }, { context: [] });
  const nextNative = { system: [] };
  await nextHooks["experimental.chat.system.transform"]({ sessionID: "s1" }, nextNative);
  assert.doesNotMatch(nextNative.system.join("\n"), /Compaction is complete/);
});

test("handoff activates only after successful native summary, persists, and respects reverted history", async () => {
  const t = await setup();
  await t.hooks["experimental.session.compacting"]({ sessionID: "s1" }, { context: [] });
  const before = { system: [] };
  await t.hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, before);
  assert.equal(before.system.length, 1); // Configured rule only; draft not active.
  t.set([...history, message("failed", "assistant", "bad", { summary: true, finish: "stop", error: { name: "APIError" } })]);
  await t.hooks.event({ event: { type: "session.compacted", properties: { sessionID: "s1" } } });
  t.set([...history, message("ok", "assistant", "Native summary", { summary: true, finish: "stop" })]);
  await t.hooks["experimental.compaction.autocontinue"]({ sessionID: "s1" });
  const restarted = await plugin.server(t.input, t.options);
  const after = { system: [] };
  await restarted["experimental.chat.system.transform"]({ sessionID: "s1" }, after);
  assert.match(after.system.join("\n"), /Retry-limit comparison edited but not built/);
  t.set(history);
  const reverted = { system: [] };
  await restarted["experimental.chat.system.transform"]({ sessionID: "s1" }, reverted);
  assert.equal(reverted.system.length, 1);
});

test("compactor errors propagate instead of activating an incomplete handoff", async () => {
  const { hooks } = await setup({}, async () => Response.json({}, { status: 503 }));
  await assert.rejects(hooks["experimental.session.compacting"]({ sessionID: "s1" }, { context: [] }), /HTTP 503/);
  const out = { system: [] };
  await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, out);
  assert.equal(out.system.length, 1);
});

test("rejects competing prompt replacement", async () => {
  const { hooks } = await setup({ mode: "prompt" });
  await assert.rejects(hooks["experimental.session.compacting"]({ sessionID: "s1" }, { context: [], prompt: "other" }), /prompt-replacing/);
});

test("network destination and path isolation", () => {
  assert.throws(() => validateEndpoint({ ...config, endpoint: "https://example.com/v1" }), /allowedHosts/);
  assert.equal(validateEndpoint({ ...config, endpoint: "https://openrouter.ai/api/v1/chat/completions", allowedHosts: ["openrouter.ai"] }), "https://openrouter.ai/api/v1/chat/completions");
  assert.throws(() => validateEndpoint({ ...config, endpoint: "http://user:secret@127.0.0.1/v1" }), /credentials/);
  const a = sessionDirectory(base, "projectA", "../../escape");
  assert.equal(path.dirname(a), base);
  assert.notEqual(a, sessionDirectory(base, "projectB", "../../escape"));
});

test("archive omits reasoning and media bytes without losing exact tool output", () => {
  const record = normalizeMessages([{ info: { id: "x", role: "assistant" }, parts: [
    { type: "reasoning", text: "PRIVATE" }, { type: "file", url: "data:SECRET", filename: "pic.png", mime: "image/png" },
    { type: "tool", tool: "read", state: { output: "Exact 'D:\\demo app'" } },
  ] }])[0];
  assert.doesNotMatch(record.text, /PRIVATE|SECRET/);
  assert.match(record.text, /demo app/);
});

test("a model cannot run a shell; unknown tools get errors and API failures propagate", async () => {
  const dir = await temp();
  const snapshotPath = path.join(dir, "transcript.json");
  await atomicWrite(snapshotPath, JSON.stringify(normalizeMessages(history)));
  let lastBody;
  let calls = 0;
  await assert.rejects(runAgent({ snapshotPath, workDirectory: dir, config: { ...config, maxSteps: 2 }, fetchImpl: async (_, request) => {
    lastBody = JSON.parse(request.body);
    if (++calls === 2) return Response.json({}, { status: 503 });
    return Response.json({ choices: [{ message: { role: "assistant", tool_calls: [{ id: "bad", function: { name: "shell", arguments: '{"command":"build"}' } }] } }] });
  } }), /HTTP 503/);
  assert.match(lastBody.messages.find(m => m.role === "tool").content, /Unknown tool: shell/);
});

test("shared env file loads credentials without modifying process environment", async () => {
  const dir = await temp();
  const envFile = path.join(dir, "shared.env");
  await atomicWrite(envFile, 'KILO_HANDOFF_TEST_KEY="synthetic-key"\n');
  const loaded = await loadConfig({ envFile, mode: "prompt" });
  assert.equal(loaded.environment.KILO_HANDOFF_TEST_KEY, "synthetic-key");
  assert.equal(process.env.KILO_HANDOFF_TEST_KEY, undefined);
  assert.equal(JSON.stringify(loaded.config).includes("synthetic-key"), false);
});

test("actual HTTP request sends credentials only in headers and rejects redirects", async t => {
  const dir = await temp();
  const snapshotPath = path.join(dir, "transcript.json");
  await atomicWrite(snapshotPath, JSON.stringify(normalizeMessages(history)));
  let captured;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    captured = { auth: req.headers.authorization, body };
    res.writeHead(302, { Location: "http://127.0.0.1:1/never-follow" });
    res.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  await assert.rejects(runAgent({ snapshotPath, workDirectory: dir,
    config: { ...config, endpoint: `http://127.0.0.1:${server.address().port}/v1/chat/completions`, apiKeyEnv: "KEY" },
    environment: { KEY: "synthetic-secret" },
  }));
  assert.equal(captured.auth, "Bearer synthetic-secret");
  assert.equal(captured.body.includes("synthetic-secret"), false);
  assert.equal((await readFile(path.join(dir, "trace.json"), "utf8")).includes("synthetic-secret"), false);
});

test("reasoning-only output at completion limit fails without activating a handoff", async () => {
  const dir = await temp();
  const snapshotPath = path.join(dir, "transcript.json");
  await atomicWrite(snapshotPath, JSON.stringify(normalizeMessages(history)));
  await assert.rejects(runAgent({ snapshotPath, workDirectory: dir, config, fetchImpl: async () =>
    Response.json({ choices: [{ finish_reason: "length", message: { role: "assistant", content: null, reasoning: "still thinking" } }] })
  }), /output limit/);
});

test("message index pagination and long-message offsets expose late corrections", async () => {
  const dir = await temp();
  const records = normalizeMessages(Array.from({ length: 14 }, (_, i) => message(`u${i}`, "user", i === 13 ? "x".repeat(12000) + "LATEST CORRECTION" : `request ${i}`)));
  const snapshotPath = path.join(dir, "transcript.json");
  await atomicWrite(snapshotPath, JSON.stringify(records));
  let step = 0;
  const actions = [["list_messages", { role: "user" }], ["list_messages", { role: "user", start: 12 }], ["read_message", { index: 13, offset: 12000 }], ["write_handoff", { text: handoff }]];
  await runAgent({ snapshotPath, workDirectory: dir, config, fetchImpl: async (_, request) => {
    const body = JSON.parse(request.body);
    if (step === 1) assert.match(body.messages.at(-1).content, /next: 12/);
    if (step === 2) assert.match(body.messages.at(-1).content, /MESSAGE 13 \| u13/);
    if (step === 3) assert.ok(body.messages.at(-1).content.endsWith("LATEST CORRECTION"));
    const action = actions[step++];
    return Response.json({ choices: [{ message: action ? { role: "assistant", tool_calls: [{ id: `c${step}`, function: { name: action[0], arguments: JSON.stringify(action[1]) } }] } : { role: "assistant", content: "Done" } }] });
  } });
});
