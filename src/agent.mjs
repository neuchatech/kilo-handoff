import { readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "./storage.mjs";
import { agentInstructions, sections } from "./prompts.mjs";
import { createDebugLog } from "./debug.mjs";
import { transcriptLines, rgTranscript } from "./search.mjs";
import { formatToolOutput } from "./tool-output.mjs";

function integer(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Expected integer ${min}..${max}`);
  return value;
}

function tool(name, description, properties) {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, additionalProperties: false } } };
}
const number = { type: "integer" };
const string = { type: "string" };
export const tools = [
  tool("rg_transcript", "Search the archived transcript like rg -F -n -C: literal pattern, line numbers, surrounding lines. Default case-insensitive. Not a shell; regex and shell syntax are not supported. Follow next_line with start_line. Use message index for read_message if more detail is needed.", { pattern: string, context: number, ignore_case: { type: "boolean" }, start_line: number, role: string }),
  tool("list_messages", "Paginated index. Filter role=user to review directives; summary=true for earlier summaries.", { start: number, role: string, summary: { type: "boolean" } }),
  tool("read_message", "Read one message by index, with character offset for long content.", { index: number, offset: number }),
  tool("search_messages", "Literal case-insensitive search, paginated. Returns indices for read_message.", { query: string, start: number }),
  tool("append_notes", "Append working notes; these are not the final handoff.", { text: string }),
  tool("write_handoff", "Replace the complete final handoff with all required headings.", { text: string }),
];

export function validateEndpoint(config) {
  const url = new URL(config.endpoint);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.search)
    throw new Error("Use an HTTP(S) endpoint without embedded credentials, query, or fragment");
  const allowed = config.allowedHosts ?? ["127.0.0.1", "localhost", "[::1]"];
  if (!allowed.includes(url.hostname)) throw new Error("Endpoint hostname is not in allowedHosts");
  if (!config.model || config.model.startsWith("REPLACE_")) throw new Error("Configure the compaction model ID");
  return url.href;
}

export async function runAgent({ snapshotPath, workDirectory, config, environment = process.env, operatingRules = "", fetchImpl = fetch, now = Date.now }) {
  const endpoint = validateEndpoint(config);
  const warnAfterMs = integer(config.warnAfterMs, 180000, 1, 86400000);
  const started = now();
  let warned = false;
  const maxHandoffChars = integer(config.maxHandoffChars, 18000, 1000, 60000);
  // Disabled by default: character counts are not the provider's token budget.
  // Retain opt-in support for experiments that explicitly request a local cap.
  const maxContextChars = config.maxContextChars == null ? null : integer(config.maxContextChars, undefined, 80000, 2000000);
  const explorationLimit = maxContextChars === null ? Infinity : maxContextChars - maxHandoffChars - 42000;
  const records = JSON.parse(await readFile(snapshotPath, "utf8"));
  // Search/read a readable view; the complete original structured snapshot stays on disk.
  const readableRecords = records.map(r => ({ ...r, text: transcriptLines([r]).slice(1).map(l => l.text).join("\n") }));
  const lines = transcriptLines(records);
  await atomicWrite(path.join(workDirectory, "transcript.txt"), lines.map(l => l.text).join("\n"));
  const messages = [
    { role: "system", content: agentInstructions },
    { role: "user", content: JSON.stringify({ messageCount: records.length, latestIndices: records.slice(-6).map(r => r.index), operatingRules, maxHandoffChars }) },
  ];
  const trace = [];
  const debug = createDebugLog(workDirectory, config.debugReasoning === true, config.apiKeyEnv && environment[config.apiKeyEnv]);
  let notes = "", handoff;
  let finalizing = false;
  let status = "running";
  let step = 0;

  async function execute(name, args) {
    if (name === "rg_transcript") return rgTranscript(lines, args);
    if (name === "list_messages" || name === "search_messages") {
      const start = integer(args.start, 0, 0, records.length);
      if (name === "search_messages" && (typeof args.query !== "string" || !args.query)) throw new Error("query is required");
      const matches = readableRecords.filter(r => r.index >= start &&
        (name !== "list_messages" || ((!args.role || r.role === args.role) && (args.summary === undefined || r.summary === args.summary))) &&
        (name !== "search_messages" || r.text.toLowerCase().includes(args.query.toLowerCase())));
      const page = matches.slice(0, 12);
      return { items: page.map(r => {
        const offset = name === "search_messages" ? Math.max(0, r.text.toLowerCase().indexOf(args.query.toLowerCase()) - 150) : 0;
        return { index: r.index, id: r.id, role: r.role, summary: r.summary, chars: r.text.length, offset, preview: r.text.slice(offset, offset + 600) };
      }), next: matches.length > 12 ? page.at(-1).index + 1 : null };
    }
    if (name === "read_message") {
      const index = integer(args.index, undefined, 0, records.length - 1);
      const r = readableRecords[index];
      if (!r) throw new Error("Unknown message index");
      const offset = integer(args.offset, 0, 0, r.text.length);
      return { ...r, text: r.text.slice(offset, offset + 12000), offset, nextOffset: offset + 12000 < r.text.length ? offset + 12000 : null };
    }
    if (name === "append_notes") {
      if (typeof args.text !== "string" || notes.length + args.text.length > 60000) throw new Error("Notes limit exceeded or text missing");
      notes += args.text + "\n";
      await atomicWrite(path.join(workDirectory, "notes.md"), notes);
      return { written: true };
    }
    if (name === "write_handoff") {
      if (typeof args.text !== "string" || args.text.length > maxHandoffChars || !sections.every(s => args.text.split(/\r?\n/).includes(`## ${s}`)))
        throw new Error("Handoff must fit character budget and contain all required headings");
      handoff = args.text;
      await atomicWrite(path.join(workDirectory, "handoff.md"), handoff);
      return { written: true, chars: handoff.length };
    }
    throw new Error(`Unknown tool: ${name}`);
  }

  try {
    for (step = 0; ; step++) {
      if (!warned && now() - started >= warnAfterMs) {
        warned = true;
        messages.push({ role: "user", content: "Elapsed-time advisory: compaction has taken longer than expected. Continue gathering evidence if necessary, save useful notes, and write the handoff when ready. This is not a deadline or a request to stop." });
      }
      if (!finalizing && JSON.stringify(messages).length >= explorationLimit) {
        finalizing = true;
        messages.push({ role: "user", content: "Your exploration budget is now exhausted. Write the final handoff using write_handoff now. Use the evidence already collected; mark unresolved or uninspected details explicitly. Do not invent missing facts. Preserve the latest objective and working procedures. This is your final request." });
      }
      const key = config.apiKeyEnv && environment[config.apiKeyEnv];
      if (config.apiKeyEnv && !key) throw new Error(`Missing credential environment variable: ${config.apiKeyEnv}`);
      const response = await fetchImpl(endpoint, {
        method: "POST", redirect: "error",
        headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ ...config.requestOptions, model: config.model, messages,
          tools: finalizing ? tools.filter(t => t.function.name === "write_handoff") : tools,
          ...(finalizing ? { tool_choice: { type: "function", function: { name: "write_handoff" } } } : {}), stream: false }),
      });
      if (!response.ok) {
        // Capture provider diagnostics locally when debugging; never log request headers.
        const raw = await response.text();
        let detail;
        try {
          const parsed = JSON.parse(raw);
          detail = { code: parsed.error?.code, message: parsed.error?.message ?? parsed.message };
        } catch { detail = { message: raw.slice(0, 8000) }; }
        await debug({ type: "api_error", request: step + 1, httpStatus: response.status, detail });
        throw new Error(`Compactor HTTP ${response.status}`);
      }
      const completion = await response.json();
      const choice = completion.choices?.[0];
      const reply = choice?.message;
      if (!reply || reply.role !== "assistant") throw new Error("Invalid OpenAI-compatible response");
      // Persist before checking finish_reason so output-limit failures remain inspectable.
      await debug({ type: "model_response", request: step + 1, finishReason: choice.finish_reason, usage: completion.usage,
        message: { role: reply.role, content: reply.content, reasoning: reply.reasoning, reasoning_content: reply.reasoning_content,
          reasoning_details: reply.reasoning_details, tool_calls: reply.tool_calls } });
      if (choice.finish_reason === "length") throw new Error("Compactor response hit its output limit");
      const assistant = { role: "assistant", content: reply.content ?? null };
      // Preserve real reasoning fields for subsequent requests. Never fabricate reasoning.
      for (const field of ["reasoning_content", "reasoning"]) if (typeof reply[field] === "string") assistant[field] = reply[field];
      if (Array.isArray(reply.reasoning_details)) {
        assistant.reasoning_details = reply.reasoning_details;
        delete assistant.reasoning; // OpenRouter's structured form supersedes the duplicate text.
      }
      if (reply.tool_calls?.length) assistant.tool_calls = reply.tool_calls;
      messages.push(assistant);
      if (!assistant.tool_calls) {
        if (!handoff) throw new Error("Compactor finished without writing a handoff");
        status = "completed";
        return { handoff, trace };
      }
      if (assistant.tool_calls.length > 16) throw new Error("Too many tool calls in one response");
      for (const call of assistant.tool_calls) {
        let result;
        try {
          if (finalizing && call.function.name !== "write_handoff") throw new Error("Exploration ended; write_handoff is the only available tool");
          result = await execute(call.function.name, JSON.parse(call.function.arguments));
          if (["read_message", "list_messages", "search_messages", "rg_transcript"].includes(call.function.name) &&
              JSON.stringify(messages).length + formatToolOutput(result).length > explorationLimit) {
            result = { error: "Exploration context budget reached. This result was withheld. Write the handoff from the evidence already collected; mark remaining gaps explicitly." };
            // Leave enough room for all responses to this tool-call batch and a final write.
            finalizing = true;
          }
        }
        catch (error) { result = { error: error.message }; }
        const content = formatToolOutput(result);
        trace.push({ step, tool: call.function.name, ok: !result.error, outputChars: content.length });
        await debug({ type: "tool_result", request: step + 1, callID: call.id, tool: call.function.name, result });
        messages.push({ role: "tool", tool_call_id: call.id, content });
      }
      if (handoff) {
        // The completed write is the result; an extra acknowledgement request is unnecessary.
        status = "completed";
        return { handoff, trace };
      }
      if (finalizing && !messages.some(m => m.role === "user" && m.content.startsWith("Your exploration budget"))) {
        messages.push({ role: "user", content: "Your exploration budget is now exhausted. Use write_handoff now to record the evidence collected. Mark uninspected details as unknown. Do not call read or search tools again." });
      }
      if (maxContextChars !== null && JSON.stringify(messages).length > maxContextChars) throw new Error("Compactor context budget exceeded despite reserved finalization space");
    }
  } catch (error) {
    status = "failed";
    throw error;
  } finally {
    // No credentials, model reasoning, or raw HTTP bodies in the diagnostic trace.
    await atomicWrite(path.join(workDirectory, "trace.json"), JSON.stringify(trace, null, 2));
    await atomicWrite(path.join(workDirectory, "status.json"), JSON.stringify({ status, requests: step + 1, warned, elapsedMs: now() - started, finalizing, contextChars: JSON.stringify(messages).length, maxContextChars, transcriptMessages: records.length }, null, 2));
  }
}
