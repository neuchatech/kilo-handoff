import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadConfig, root } from "../src/config.mjs";
import { atomicWrite, normalizeMessages } from "../src/storage.mjs";
import { runAgent } from "../src/agent.mjs";
import { history, scriptedModel } from "./fixtures.mjs";

const live = process.argv.includes("--live");
const example = JSON.parse(await readFile(path.join(root, "config.openrouter.example.json"), "utf8"));
const { config: configured, environment } = await loadConfig();
const config = live ? { ...example, ...configured, mode: "agentic" } : {
  mode: "agentic", endpoint: "http://127.0.0.1:8080/v1/chat/completions", model: "scripted",
};
// The runner always uses synthetic data, never Kilo's actual session archive.
const workDirectory = path.join(root, ".kilo", "compaction", "demo", randomUUID());
await mkdir(workDirectory, { recursive: true });
const snapshotPath = path.join(workDirectory, "transcript.json");
await atomicWrite(snapshotPath, JSON.stringify(normalizeMessages(history), null, 2));
try {
  const started = Date.now();
  const result = await runAgent({ snapshotPath, workDirectory, config, environment, operatingRules: config.operatingRules, ...(live ? {} : { fetchImpl: scriptedModel() }) });
  const report = {
    mode: live ? "real model, synthetic transcript" : "scripted model, synthetic transcript",
    model: config.model, durationMs: Date.now() - started, toolCalls: result.trace.length,
    nativeKiloCompactionTested: false,
    checks: {
      mentionsManualBuild: /Visual Studio/i.test(result.handoff),
      mentionsCurrentTask: /retry/i.test(result.handoff),
      preservesPathConvention: /LiteralPath/.test(result.handoff),
      retainsEvidenceIDs: /m09/.test(result.handoff),
    },
    note: "These string checks are diagnostics, not a semantic correctness score. Inspect handoff.md and test continuation in Kilo.",
  };
  await atomicWrite(path.join(workDirectory, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Artifacts: ${workDirectory}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
