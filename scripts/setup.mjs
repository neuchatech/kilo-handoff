import { copyFile, constants } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "../src/config.mjs";
import { atomicWrite, readJSON } from "../src/storage.mjs";

// Run after cloning/extracting: register this checkout's actual absolute path.
for (const [source, target] of [[".env.example", ".env"], ["config.openrouter.example.json", "config.local.json"]]) {
  try { await copyFile(path.join(root, source), path.join(root, target), constants.COPYFILE_EXCL); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
}
const file = path.join(root, "kilo.json");
const config = await readJSON(file) ?? {};
const entry = pathToFileURL(path.join(root, "src", "plugin.mjs")).href;
config.plugin ??= [];
if (!Array.isArray(config.plugin)) throw new Error("Existing kilo.json plugin setting must be an array");
if (!config.plugin.some(p => (Array.isArray(p) ? p[0] : p) === entry)) config.plugin.push(entry);
config.compaction ??= {};
config.compaction.tail_turns ??= 0;
await atomicWrite(file, JSON.stringify(config, null, 2) + "\n");
console.log("Setup complete. Existing .env and config.local.json were preserved.");
console.log(`Kilo plugin entry: ${entry}`);
console.log("Configure credentials locally, then reload Kilo. No model request was made.");
