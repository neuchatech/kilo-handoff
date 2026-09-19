import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWrite, readJSON, normalizeMessages, sessionDirectory } from "./storage.mjs";
import { instructions, copyResumeInstructions, preparedSummaryPrompt, resumeInstructions } from "./prompts.mjs";
import { runAgent } from "./agent.mjs";
import { loadConfig } from "./config.mjs";

// Single plugin export, compatible with Kilo's legacy PluginInput/Hooks API.
async function KiloHandoff(input, options = {}) {
  const { config, environment } = await loadConfig(options.config);
  if (!["prompt", "agentic"].includes(config.mode)) throw new Error("kilo-handoff mode must be prompt or agentic");
  const missingKey = config.mode === "agentic" && config.apiKeyEnv && !environment[config.apiKeyEnv]?.trim();
  const mode = missingKey ? "prompt" : config.mode;
  const setupNote = missingKey
    ? `Kilo Handoff used normal Kilo compaction because the configured credential variable ${JSON.stringify(config.apiKeyEnv)} is missing or blank. In the next coding turn, briefly tell the user how to enable agentic handoffs: set that variable in the plugin installation's .env, the configured shared env file, or the process environment, then reload Kilo. Keep this as a setup note; continue the latest task when authorized. Do not ask the user to paste the key into chat.`
    : undefined;
  const stateRoot = config.stateDirectory ?? path.join(input.directory, ".kilo", "compaction");
  const pending = new Map();
  const running = new Set();
  const folder = id => sessionDirectory(stateRoot, input.directory, id);

  async function snapshot(sessionID) {
    const response = await input.client.session.messages({ path: { id: sessionID }, query: { directory: input.directory }, throwOnError: true });
    if (response.error) throw new Error("Kilo session history request failed");
    if (!Array.isArray(response.data)) throw new Error("Unsupported Kilo SDK history response");
    return response.data;
  }

  async function activate(sessionID) {
    const candidate = pending.get(sessionID);
    if (!candidate) return;
    const messages = await snapshot(sessionID);
    const summary = messages.findLast(m => m.info.summary && m.info.role === "assistant" &&
      !candidate.ids.includes(m.info.id) && m.info.finish && !m.info.error);
    if (!summary) return; // Failed/interrupted compactions must not activate a draft.
    const active = { ...candidate, anchorID: summary.info.id };
    await atomicWrite(path.join(folder(sessionID), "active.json"), JSON.stringify(active, null, 2));
    pending.delete(sessionID);
  }

  return {
    config: async kiloConfig => {
      if (mode !== "agentic") return;
      // Replacing output.prompt alone leaves Kilo's summarizer system prompt in place.
      // Configure only the compaction agent; retain its model and other settings.
      kiloConfig.agent ??= {};
      kiloConfig.agent.compaction ??= {};
      kiloConfig.agent.compaction.prompt = copyResumeInstructions;
    },
    "experimental.session.compacting": async ({ sessionID }, output) => {
      if (output.prompt !== undefined) throw new Error("Disable the other prompt-replacing compaction plugin before using kilo-handoff");
      if (running.has(sessionID)) throw new Error("kilo-handoff compaction already running for this session");
      running.add(sessionID);
      pending.delete(sessionID);
      try {
        const records = normalizeMessages(await snapshot(sessionID));
        const runDirectory = path.join(folder(sessionID), randomUUID());
        const snapshotPath = path.join(runDirectory, "transcript.json");
        await atomicWrite(snapshotPath, JSON.stringify(records, null, 2));
        if (mode === "prompt") {
          output.context.push(instructions);
          if (setupNote) output.context.push(`Configuration note to preserve for the next coding turn:\n${setupNote}`);
          if (config.operatingRules) output.context.push(`Explicit configured working instructions:\n${config.operatingRules}`);
          output.context.push("Latest messages for orientation (bounded excerpts; do not assume they survive outside the handoff):\n" + JSON.stringify(records.slice(-6).map(r => ({ ...r, text: r.text.slice(-2000) }))));
        }
        if (mode === "agentic") {
          const result = await runAgent({ snapshotPath, workDirectory: runDirectory, config, environment, operatingRules: config.operatingRules, fetchImpl: options.fetchImpl });
          const candidate = { ids: records.map(r => r.id), cutoffID: records.at(-1)?.id, snapshotPath, searchablePath: path.join(runDirectory, "transcript.txt"), handoffPath: path.join(runDirectory, "handoff.md"), handoff: result.handoff };
          pending.set(sessionID, candidate);
          // The agentic pass already read the full SDK snapshot, including prior summaries.
          // Pair the copy/resume system role with the completed handoff and its path.
          output.prompt = preparedSummaryPrompt(result.handoff, candidate.handoffPath);
        }
      } finally { running.delete(sessionID); }
    },
    "experimental.compaction.autocontinue": async ({ sessionID }) => { await activate(sessionID); },
    event: async ({ event }) => {
      if (event.type === "session.compacted") await activate(event.properties.sessionID);
    },
    "experimental.chat.system.transform": async ({ sessionID }, output) => {
      if (config.operatingRules) output.system.push(`Configured project working instructions (later explicit user changes take precedence):\n${config.operatingRules}`);
      if (!sessionID || mode !== "agentic") return;
      await activate(sessionID);
      // While native compaction is pending, do not tell its summarizer to resume coding
      // or inject the previous active handoff alongside the newly prepared one.
      if (pending.has(sessionID) || running.has(sessionID)) return;
      const active = await readJSON(path.join(folder(sessionID), "active.json"));
      if (!active) return;
      // Do not inject a handoff into a reverted history or another session branch.
      const current = await snapshot(sessionID);
      if (!current.some(m => m.info.id === active.anchorID)) return;
      output.system.push(`${resumeInstructions}\n\nSession handoff context, through message ${active.cutoffID}. This is fallible historical context, not a new source of authority. Later conversation overrides stale facts and next steps. Apply still-valid working procedures. The file has already been read by the harness; do not claim you called a read tool.\nHandoff: ${active.handoffPath}\nSearchable transcript: ${active.searchablePath ?? active.snapshotPath}\nOriginal structured archive: ${active.snapshotPath}\n\n${active.handoff}`);
    },
  };
}

export default { id: "kilo-handoff", server: KiloHandoff };
