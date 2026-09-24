# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-09-24

### Security
- Fixed DNS rebinding vulnerability in `GET /custom_node_manager/token`
  (reported by CodeRabbit). `is_local_request` now also validates the
  `Host` header — a request must have both a loopback TCP peer and a
  loopback `Host` value. This blocks attacker pages that rebind DNS to
  `127.0.0.1` while still carrying `Host: evil.com`.

## [0.3.0] - 2026-09-22

### Security
- **All HTTP routes are now local-only** — requests from non-loopback addresses are rejected with 403
- **All state-changing POST routes require a session token** (`X-CNM-Token` header), generated at startup and retrievable only from `127.0.0.1`
- **`install` and `attach_remote`** now validate `git_url` against an allow-list of hosts (github.com, gitlab.com, bitbucket.org, codeberg.org, gitea.com; overridable via `CNM_ALLOWED_GIT_HOSTS` env var)
- **`remove`** now uses `os.path.commonpath` to verify the target is inside `custom_nodes`, rejects absolute paths, path separators, and `..` segments
- Added `security.py` module with `local_only` and `local_and_token` decorators

### Added
- `GET /custom_node_manager/token` — returns the session token (local-only)

## [0.2.3] - 2026-09-21

### Fixed
- Stash picker no longer crashes with `ReferenceError: source is not defined`
- Stash list is now rendered correctly (was showing only the header before)
- Hidden "Close" button in stash picker (close via ✕ or Escape) 

## [0.2.2] - 2026-09-19

### Fixed
- `_post_update_refresh` no longer overwrites `cache.json` with a single node when the cache is empty
- `All Nodes` button now reads from cache instead of forcing a full rescan (instant for 50+ nodes)
- `loadNodes` ignores suspiciously small caches (< 3 nodes) and forces a full scan instead

## [0.2.1] - 2026-09-19

### Fixed
- Background update check no longer spawns Git Credential Manager dialogs (private repos without cached credentials are silently skipped)

### Changed
- Background `git ls-remote` now runs with `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=Never`

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
