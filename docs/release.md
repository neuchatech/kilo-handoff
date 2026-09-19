# Private release and future public distribution

## Current status

The repository is named `kilo-handoff`, version 1.1.0, with `private: true` and `license: UNLICENSED`. No remote publication or hosting is configured by this preparation. The tested V1 baseline is commit `07eab69`; see the changelog for the subsequent native prompt refinement and its validation status.

## Create/install a private package

Run `npm test`, `npm run demo`, then `npm pack --pack-destination dist` after creating `dist/`. The package uses an explicit file allowlist. Extract it to a permanent directory and run `npm run setup` there; the setup writes a Kilo plugin URL for that location. No dependency installation is required. Enter credentials locally, choose the endpoint/model, and reload Kilo.

For another workspace, add the printed file URL to its `kilo.json` (or supported `.kilo/kilo.json`) plugin array. Set `compaction.tail_turns: 0` if testing full handoff-based retention. Add `.kilo/compaction/` to that workspace's ignore rules. Configure Kilo's ordinary chat and native compaction providers independently: the plugin config controls only the separate agentic compactor.

Before using an internal codebase, point both Kilo and this plugin at approved internal providers. An OpenRouter test configuration is not an internal deployment configuration. Confirm DICA's full chat-completions URL, model ID, authentication and reasoning options; those have not yet been tested here.

The env-file path can be central and shared across workspaces using `KILO_HANDOFF_ENV_FILE` or `envFile`. Process environment overrides the shared file. Keys need not be duplicated in every project. Existing Kilo/VS Code credentials are not automatically read; the inspected plugin interface offers no confirmed generic credential getter.

## What is included

- Git: plugin source, synthetic tests, setup script, documentation and configuration examples. The local C demo project is ignored and absent from the branch history.
- Plugin tarball: runtime source, tests, setup script, docs and examples. The C exercise is excluded.
- Excluded: `.env`, local configuration, Kilo runtime config, `.kilo/compaction`, `.state`, build products, editor settings and release tarballs.

## Naming and licensing

The display name is **Kilo Handoff** and repository/package name is `kilo-handoff`. Package-name availability and trademark suitability have not been checked. Settings use the `KILO_HANDOFF_` prefix. Reload Kilo after changing an installation path or plugin configuration.

The project is closed-source for now: `private: true` and `license: UNLICENSED`. No open-source license is granted. Before any future public release, the owner must explicitly choose distribution/license terms and verify package-name availability. GitHub repository visibility is configured separately; no GitHub remote has been created here.
