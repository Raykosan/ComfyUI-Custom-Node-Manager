# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-09-19

### Fixed
- `_post_update_refresh` no longer overwrites `cache.json` with a single node when the cache is empty
- `All Nodes` button now reads from cache instead of forcing a full rescan (instant for 50+ nodes)
- `loadNodes` ignores suspiciously small caches (< 3 nodes) and forces a full scan instead

## [0.2.0] - 2026-09-18

### Added
- Update checking via `git ls-remote` (no API rate limits, ~10–30s for 200 nodes)
- Batch updates with checkboxes and progress log (`2/5 — git fetch`)
- GitHub API integration for accurate tag listing (optional `GITHUB_TOKEN`)
- Auto-stash before destructive operations + stash management UI (restore/drop)
- Attach Git Remote for nodes installed from zip archives
- Extended version detection (`metadata.json`, `pyproject.toml`, `__version__`, `version.py`, `setup.py`, `package.json`, git tags)
- Version badge shows source (e.g. `v7.5 · tag`) with conflict tooltips
- Filter chip for "has update" nodes with selection panel
- i18n: English, 中文, Русский (auto-detected from ComfyUI settings)
- Clear button in search field
- Close button (✕) in popup header
- Detached HEAD recovery: `Update` automatically switches to default branch before pulling

### Fixed
- Cache desync after successful updates — badges no longer reappear after restart
- Popup stuck when two dialogs overlapped
- Cross-backend communication between JS and Python for post-task cache refresh

### Changed
- `Update` + `Checkout version` merged into single `Switch Version` button
- `Latest on main` renamed to `Latest version` for clarity

## [0.1.1] - 2026-09-17

### Added
- Initial release
- Scanner for `custom_nodes` with git metadata
- Install from Git URL
- Switch Version dialog (tags only)
- Remove with path traversal protection
- Custom modal dialogs (no native browser popups)
- Cache between sessions (`cache.json`)
- Task queue with progress panel
