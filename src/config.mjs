import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readJSON } from "./storage.mjs";

export const root = fileURLToPath(new URL("../", import.meta.url));

async function envFile(file, optional) {
  try { return parseEnv(await readFile(file, "utf8")); }
  catch (error) { if (optional && error.code === "ENOENT") return {}; throw error; }
}

export async function loadConfig(override) {
  const local = await envFile(path.join(root, ".env"), true);
  const initial = { ...local, ...process.env };
  const configPath = initial.KILO_HANDOFF_CONFIG ?? path.join(root, "config.local.json");
  const config = override ?? await readJSON(configPath) ?? { mode: "prompt" };
  const sharedPath = initial.KILO_HANDOFF_ENV_FILE ?? config.envFile;
  if (sharedPath && !path.isAbsolute(sharedPath)) throw new Error("Shared envFile must be an absolute path");
  const shared = sharedPath ? await envFile(sharedPath, false) : {};
  // Central file overrides repo-local values; process environment wins over both.
  // Never copy credentials into config, snapshots, summaries, or global process.env.
  return { config, environment: { ...local, ...shared, ...process.env } };
}
