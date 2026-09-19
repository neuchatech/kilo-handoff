// Literal-search subset of rg: -F, -i, -n and -C semantics; no shell or regex engine.
export function transcriptLines(records) {
  const lines = [];
  for (const record of records) {
    const chunks = [`MESSAGE ${record.index} | ${record.id} | ${record.role}`];
    for (const line of record.text.split(/\r?\n/)) {
      let part;
      try { part = JSON.parse(line); } catch { /* Ordinary transcript text. */ }
      if (part?.type === "tool") {
        chunks.push(`TOOL ${part.tool} (${part.state?.status ?? "unknown"})`);
        for (const [key, value] of Object.entries(part.state?.input ?? {}))
          chunks.push(`INPUT ${key}:`, typeof value === "string" ? value : JSON.stringify(value));
        for (const key of ["output", "error"])
          if (part.state?.[key] !== undefined) chunks.push(key.toUpperCase() + ":", typeof part.state[key] === "string" ? part.state[key] : JSON.stringify(part.state[key]));
      } else chunks.push(line);
    }
    for (const text of chunks.join("\n").split(/\r?\n/))
      lines.push({ line: lines.length + 1, index: record.index, id: record.id, role: record.role, text });
  }
  return lines;
}

export function rgTranscript(lines, args) {
  if (typeof args.pattern !== "string" || !args.pattern.length) throw new Error("pattern must be a nonempty literal string");
  const context = args.context ?? 2;
  const startLine = args.start_line ?? 1;
  if (!Number.isInteger(context) || context < 0 || context > 5) throw new Error("context must be 0..5");
  if (!Number.isInteger(startLine) || startLine < 1) throw new Error("start_line must be a positive line number");
  const insensitive = args.ignore_case !== false;
  const pattern = insensitive ? args.pattern.toLowerCase() : args.pattern;
  const matches = [];
  let nextLine = null;
  let chars = 0;
  for (let i = startLine - 1; i < lines.length; i++) {
    const item = lines[i];
    if (args.role && item.role !== args.role) continue;
    const text = insensitive ? item.text.toLowerCase() : item.text;
    if (!text.includes(pattern)) continue;
    if (matches.length >= 12 || chars >= 14000) { nextLine = item.line; break; }
    const block = lines.slice(Math.max(0, i - context), i + context + 1).filter(l => l.id === item.id).map(l => {
      const matchOffset = l.line === item.line ? text.indexOf(pattern) : 0;
      const columnStart = Math.max(0, matchOffset - 150);
      return { ...l, text: l.text.slice(columnStart, columnStart + 800), columnStart, truncated: columnStart > 0 || l.text.length > 800, match: l.line === item.line };
    });
    chars += JSON.stringify(block).length;
    matches.push({ index: item.index, id: item.id, line: item.line, lines: block });
  }
  return { mode: "literal (rg -F -n -C equivalent, not full rg)", matches, next_line: nextLine };
}
