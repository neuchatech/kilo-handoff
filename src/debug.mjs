import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

// Only provider-returned reasoning is observable. Never synthesize missing reasoning.
export function createDebugLog(directory, enabled, secret) {
  return async (event) => {
    if (!enabled) return;
    const clean = text => secret ? text.split(secret).join("[REDACTED_API_KEY]") : text;
    await mkdir(directory, { recursive: true });
    const record = { time: new Date().toISOString(), ...event };
    await appendFile(path.join(directory, "debug.jsonl"), clean(JSON.stringify(record)) + "\n", "utf8");
    let text = `\n## ${event.type} — request ${event.request}\n\n`;
    if (event.type === "model_response") {
      const reply = event.message;
      const details = Array.isArray(reply.reasoning_details) ? reply.reasoning_details : [];
      const reasoning = reply.reasoning_content || reply.reasoning || details.map(d => d.text || d.summary || "").filter(Boolean).join("\n\n");
      text += `Finish reason: ${event.finishReason ?? "unspecified"}\n\n### Returned reasoning\n\n${reasoning || "[No readable reasoning returned by provider.]"}\n\n`;
      text += `### Response text\n\n${typeof reply.content === "string" ? reply.content : JSON.stringify(reply.content ?? null)}\n\n`;
      if (reply.tool_calls?.length) text += `### Requested tools\n\n${JSON.stringify(reply.tool_calls, null, 2)}\n`;
    } else {
      text += JSON.stringify(event, null, 2) + "\n";
    }
    await appendFile(path.join(directory, "debug.md"), clean(text), "utf8");
  };
}
