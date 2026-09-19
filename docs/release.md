# Kilo plugin package release

## Current status

The repository is [`neuchatech/kilo-handoff`](https://github.com/neuchatech/kilo-handoff), version 1.1.1, tagged `v1.1.1`. The release artifact is `kilo-handoff-1.1.1.tgz`. The earlier `V1` tag is preserved. `private: true` prevents accidental npm publication; `license: UNLICENSED` retains the existing distribution terms.

The package exposes `kilo-handoff/server` and the root entrypoint as the same default `{ id: "kilo-handoff", server }` descriptor. The `./server` export identifies it as a server plugin under [Kilo's documented package format](https://kilo.ai/docs/automate/extending/plugins). No build step or runtime dependency installation is required. Compatibility was originally exercised with Kilo VS Code 7.7.5; the experimental compaction hooks must be checked on other versions.

## Create/install a private package

Run `npm test`, `npm run demo`, then `npm run pack:release`. The last command creates `dist/` and packs the explicit file allowlist into `dist/kilo-handoff-1.1.1.tgz`.

Extract the archive to a permanent directory with `tar -xzf kilo-handoff-1.1.1.tgz`, enter the extracted `package/` folder, and run `npm run setup`. Setup creates local configuration and writes a Kilo plugin URL for that installation path, preserving existing settings. Enter credentials locally, choose the endpoint/model, and reload Kilo. Agentic reasoning diagnostics are enabled unless `debugReasoning` is explicitly `false`.

For a GitHub release, push the release commit and `v1.1.1` tag, then attach the tarball to the matching release. A local tag and tarball do not publish a GitHub release or an npm package.

For another workspace, add the printed file URL to its `kilo.json` (or supported `.kilo/kilo.json`) plugin array. Set `compaction.tail_turns: 0` if testing full handoff-based retention. Add `.kilo/compaction/` to that workspace's ignore rules. Configure Kilo's ordinary chat and native compaction providers independently: the plugin config controls only the separate agentic compactor.

Before using an internal codebase, point both Kilo and this plugin at approved internal providers. An OpenRouter test configuration is not an internal deployment configuration. Confirm DICA's full chat-completions URL, model ID, authentication and reasoning options; those have not yet been tested here.

The env-file path can be central and shared across workspaces using `KILO_HANDOFF_ENV_FILE` or `envFile`. Process environment overrides the shared file. Keys need not be duplicated in every project. Existing Kilo/VS Code credentials are not automatically read; the inspected plugin interface offers no confirmed generic credential getter.

## What is included

- Git: plugin source, synthetic tests, setup script, documentation and configuration examples. The local C demo project is ignored and absent from the branch history.
- Plugin tarball: runtime source, tests, setup script, docs and examples. The C exercise is excluded.
- Excluded: `.env`, local configuration, Kilo runtime config, `.kilo/compaction`, `.state`, build products, editor settings and release tarballs.

## Naming and licensing

The display name is **Kilo Handoff** and repository/package name is `kilo-handoff`. Package-name availability and trademark suitability have not been checked. Settings use the `KILO_HANDOFF_` prefix. Reload Kilo after changing an installation path or plugin configuration.

The package retains `private: true` and `license: UNLICENSED`; no open-source license is granted. GitHub repository visibility is configured separately. Publishing to an npm registry would require removing `private`, choosing distribution/license terms, and verifying package-name availability.
