# Changelog

## 1.1.1 — packaged Kilo plugin release — 2026-09-19

- Enabled agentic reasoning diagnostics by default; `debugReasoning: false` disables them. Configuration examples and regression tests cover the default and opt-out.
- Added explicit root and `./server` package exports, repository metadata, and `npm run pack:release` for an installable `kilo-handoff-1.1.1.tgz` archive.
- Updated the README to describe the existing prepared-handoff pass-through fix accurately: the redundant summarization instruction is replaced, while Kilo's native model call remains. Targeted live validation of that refinement is still pending.
- Removed obsolete pre-squash commit references and documented versioned package installation. The original `V1` tag is retained; this release uses `v1.1.1`.

## 1.1.0 — private release — 2026-09-19

- Native compaction prompt now requests pass-through of the prepared handoff; coding continuation instructions are supplied separately after summary success. This refinement is covered by tests but not yet independently confirmed by a targeted live comparison.
- Portable setup creates local configuration using the installation's actual path and preserves existing credentials/settings.
- Explicit package allowlist excludes local credentials, conversation archives, generated builds and editor configuration.
- Fictional C validation work remains local and ignored; the repository contains only the plugin, its synthetic test fixtures and documentation.
- Updated installation, private deployment, validation and public-release notes.

## 1.0.0 — validated baseline — 2026-09-19

First successful real Kilo/Laguna session compaction with immediate task continuation. Added readable tool outputs, file-backed handoffs and transcript retrieval, optional reasoning diagnostics, and a larger completion allowance. Removed default accumulated-context, request-count and elapsed-time cutoffs. See `docs/v1-validation.md` for evidence and limitations. The 1.0.0 and 1.1.0 development history was later combined into the single `V1` release commit.
