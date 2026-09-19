# Changelog

## 1.1.0 — private release — 2026-09-19

- Native compaction prompt now requests pass-through of the prepared handoff; coding continuation instructions are supplied separately after summary success. This refinement is covered by tests but not yet independently confirmed by a targeted live comparison.
- Portable setup creates local configuration using the installation's actual path and preserves existing credentials/settings.
- Explicit package allowlist excludes local credentials, conversation archives, generated builds and editor configuration.
- Fictional C validation work remains local and ignored; the repository contains only the plugin, its synthetic test fixtures and documentation.
- Updated installation, private deployment, validation and public-release notes.

## 1.0.0 — validated baseline — 2026-09-19

Commit `07eab69`: first successful real Kilo/Laguna session compaction with immediate task continuation. Added readable tool outputs, file-backed handoffs and transcript retrieval, optional reasoning diagnostics, and a larger completion allowance. Removed default accumulated-context, request-count and elapsed-time cutoffs. See `docs/v1-validation.md` for evidence and limitations.
