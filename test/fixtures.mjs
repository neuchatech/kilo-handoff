import { sections } from "../src/prompts.mjs";

export function message(id, role, text, extra = {}) {
  return { info: { id, role, ...extra }, parts: [{ type: "text", text }] };
}
export const history = [
  message("m01", "user", "Investigate the timeout in the synthetic motor demo. Try a shell build if needed."),
  message("m02", "assistant", "Investigating timeout and build setup."),
  { info: { id: "m03", role: "assistant" }, parts: [{ type: "tool", tool: "bash", state: { status: "error", input: { command: "msbuild Demo.sln" }, error: "MSBuild not found in this shell" } }] },
  message("m04", "user", "Correction: never build yourself. Ask me to build in Visual Studio and wait for my output. Do not investigate shell builds again unless I ask. We use PowerShell; use -LiteralPath and Windows paths."),
  message("m05", "assistant", "The timeout investigation is finished; its fix was already built successfully by the user."),
  message("m06", "assistant", "Previous checkpoint: manual Visual Studio builds only. Timeout fixed and verified. Start retry-limit investigation.", { summary: true, finish: "stop" }),
  { info: { id: "m07", role: "assistant" }, parts: [{ type: "tool", tool: "read", state: { status: "completed", input: { command: "Get-Content -LiteralPath 'D:\\demo app\\src\\retry.c'" }, output: "retry_limit = 3; // synthetic fixture only" } }] },
  message("m08", "assistant", "The retry-limit comparison has been changed; it has NOT been built. Hypothesis: off-by-one caused the fourth attempt."),
  message("m09", "user", "Latest correction: timeout is done. Focus on the retry-limit change. Before anything else, ask me to run the Visual Studio build; I have not tested this change yet."),
];
const values = [
  "Continue retry-limit change; timeout is finished (m09).",
  "Ask user to build in Visual Studio; never shell-build unless explicitly requested (m04). PowerShell, Windows paths, -LiteralPath. Successful read: Get-Content -LiteralPath 'D:\\demo app\\src\\retry.c' (m07).",
  "Timeout fix built successfully by user (m05).",
  "Retry-limit comparison edited but not built (m08). Off-by-one remains a hypothesis.",
  "User superseded initial shell-build permission (m04).",
  "Ask user to run Visual Studio build and await output (m09).",
  "m04 workflow; m07 exact command; m08 unverified edit; m09 latest request.",
  'm04 (user): "Correction: never build yourself."\n\nm09 (user): "Before anything else, ask me to run the Visual Studio build; I have not tested this change yet."',
];
export const handoff = sections.map((s, i) => `## ${s}\n${values[i]}`).join("\n\n");

export function scriptedModel(assertRequest = () => {}) {
  let round = 0;
  return async (_url, request) => {
    const body = JSON.parse(request.body);
    assertRequest(body, round);
    const call = (name, args, id) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
    const calls = [
      [call("list_messages", { role: "user" }, "c1"), call("read_message", { index: 8 }, "c2")],
      [call("search_messages", { query: "LiteralPath" }, "c3"), call("read_message", { index: 6 }, "c4")],
      [call("append_notes", { text: "Manual build and latest task override earlier instructions." }, "c5"), call("write_handoff", { text: handoff }, "c6")],
    ];
    const tool_calls = calls[round++];
    return Response.json({ choices: [{ finish_reason: tool_calls ? "tool_calls" : "stop", message: { role: "assistant", content: tool_calls ? null : "Ready", reasoning_content: "Synthetic reasoning fixture", reasoning_details: [{ type: "reasoning.text", text: "Synthetic structured reasoning" }], ...(tool_calls ? { tool_calls } : {}) } }] });
  };
}
