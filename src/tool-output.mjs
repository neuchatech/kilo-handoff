// Tool content is already a string in Chat Completions. Don't JSON-encode another
// transcript/rg result inside it. Keep structured results in the local debug log.
export function formatToolOutput(result) {
  if (result.error) return `ERROR: ${result.error}`;
  if (Array.isArray(result.matches)) {
    const seen = new Set();
    const output = [];
    for (const match of result.matches) {
      const fresh = match.lines.filter(l => {
        const key = `${l.line}:${l.columnStart}:${l.text}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (!fresh.length) continue;
      output.push(`MESSAGE ${match.index} | ${match.id}`);
      for (const line of fresh) output.push(`${line.line}${line.match ? ":" : "-"}${line.text}${line.truncated ? ` [excerpt at column ${line.columnStart}; use read_message for full text]` : ""}`);
    }
    return `${output.join("\n") || "No matches."}\nnext_line: ${result.next_line ?? "none"}`;
  }
  if (Array.isArray(result.items)) {
    return result.items.map(r => `MESSAGE ${r.index} | ${r.id} | ${r.role}${r.summary ? " | summary" : ""} | chars ${r.chars} | offset ${r.offset ?? 0}\n${r.preview}`).join("\n\n") + `\nnext: ${result.next ?? "none"}`;
  }
  if (typeof result.text === "string") {
    return `MESSAGE ${result.index} | ${result.id} | ${result.role}\noffset: ${result.offset}\nnextOffset: ${result.nextOffset ?? "none"}\n\n${result.text}`;
  }
  if (result.written) return `Written successfully.${result.chars === undefined ? "" : ` Characters: ${result.chars}.`}`;
  return JSON.stringify(result);
}
