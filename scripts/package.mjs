import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { root } from "../src/config.mjs";

if (!process.env.npm_execpath) throw new Error("Run this script with npm run pack:release");
await mkdir(path.join(root, "dist"), { recursive: true });
const result = spawnSync(process.execPath, [process.env.npm_execpath, "pack", "--pack-destination", "dist"], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
