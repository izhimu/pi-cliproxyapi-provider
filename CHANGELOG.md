# Changelog

## [1.4.25-1] - 2026-11-17

### Changed

- Sync upstream 1.4.25 Codex module resolution for Pi 1.5, managed installations, subagents, and flat dist layouts.
- Include the underlying protocol loading error when the Codex stream is unavailable.

### Fixed

- Handle OMP `session_stop` settlement for elapsed/TPS reporting and proactive compaction cleanup.
- Suppress duplicate OMP thinking labels and read public session auto-compaction state when patching the footer.
