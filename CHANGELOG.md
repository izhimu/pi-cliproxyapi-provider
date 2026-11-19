# Changelog

## [1.5.0-1] - 2026-11-19

### Changed

- Sync upstream 1.4.26 GPT Responses prompt-cache preservation and 1.5.0 Ultra Fast mode, including service-tier selection, footer labels, configuration parsing, commands, and documentation.
- Preserve the dual-host provider registration, Bun compatibility, model cache, and bounded recovery behavior while merging upstream changes.

### Fixed

- Normalize retry errors before OMP's read-only `message_end` notification instead of returning an ignored message replacement.
- Use OMP's final `agent_end` for TPS settlement and proactive-compaction cleanup; `session_stop` can precede the last usage or trigger a continuation.
- Pass the active model to Pi's current `getCompactionSettings(model)` API while retaining OMP settings compatibility.

### Testing

- TypeScript, Biome, and all 233 Vitest tests pass, including prompt-cache, Ultra Fast, OMP stream normalization, final settlement, and model-specific compaction regressions.

## [1.4.25-1] - 2026-11-17

### Changed

- Sync upstream 1.4.25 Codex module resolution for Pi 1.5, managed installations, subagents, and flat dist layouts.
- Include the underlying protocol loading error when the Codex stream is unavailable.

### Fixed

- Handle OMP `session_stop` settlement for elapsed/TPS reporting and proactive compaction cleanup.
- Suppress duplicate OMP thinking labels and read public session auto-compaction state when patching the footer.
