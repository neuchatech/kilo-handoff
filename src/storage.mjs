import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

export function sessionDirectory(root, directory, sessionID) {
  // Hash both values: session identifiers never become filesystem path components.
  const key = createHash("sha256").update(JSON.stringify([directory, sessionID])).digest("hex");
  return path.join(root, key);
}

export async function atomicWrite(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, value, "utf8");
  await rename(temp, file);
}

export async function readJSON(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

export function normalizeMessages(messages) {
  if (!Array.isArray(messages)) throw new Error("Kilo session.messages did not return an array");
  return messages.map((message, index) => {
    const info = message.info;
    if (!info?.id || !info.role || !Array.isArray(message.parts)) throw new Error("Unsupported Kilo message shape");
    return {
      index, id: info.id, role: info.role, summary: info.summary === true,
      // Exclude private reasoning and media bytes. Preserve available tool input/output exactly.
      text: message.parts.filter(p => p.type !== "reasoning").map(p => {
        if (p.type === "text") return p.text;
        if (p.type === "tool") return JSON.stringify({ type: p.type, tool: p.tool, state: p.state });
        if (p.type === "file") return JSON.stringify({ type: p.type, filename: p.filename, mime: p.mime });
        return JSON.stringify({ type: p.type });
      }).join("\n"),
    };
  });
}
