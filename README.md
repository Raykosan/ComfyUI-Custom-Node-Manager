
# 🦊 ComfyUI Custom Node Manager

An alternative manager for `custom_nodes` that bypasses the restrictions of the official ComfyUI Manager. Built for users and node developers who are affected by false-positive security flags from Comfy Registry.

[![License: MIT](https://img.shields.io/badge/License-APACHE2.0-yellow.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/downloads/)
[![ComfyUI](https://img.shields.io/badge/ComfyUI-custom--node-orange)](https://github.com/comfyanonymous/ComfyUI)

<img width="893" height="895" alt="Screenshot_1" src="https://github.com/user-attachments/assets/245d4876-03c5-4e5b-993a-53ae0a0ae0a2" />

---

## Why this exists

In 2024–2025, Comfy Registry introduced automated YARA-based security scanning for custom nodes. The scanner frequently produces **false positives** — legitimate production code (e.g., `subprocess` for ffmpeg, `aiohttp` routes for widget APIs, `huggingface_hub.snapshot_download`) gets flagged as suspicious.

When a node version is flagged:

- It receives the `NodeVersionStatusFlagged` status.
- The version is **hidden from "Select Version"** in the official ComfyUI Manager.
- Users remain stuck on outdated versions even when authors release critical fixes.
- The best node developers suffer, while the Comfy.org team refuses to change the policy.

**This extension gives users control back.** It manages `custom_nodes` directly through `git` and the GitHub REST API — bypassing Registry entirely. No flags, no hidden versions, no artificial restrictions.

---

## Features

### 🔍 Full node overview
- Scans every folder in `custom_nodes` across all configured search paths.
- Shows git branch, commit hash, version, dirty state, stash count, and requirements presence.
- Detects non-git installs and folders that aren't nodes at all.

### 📥 Install
- Install any node from a Git URL (HTTPS or SSH).
- Optionally pin to a specific tag, branch, or commit.
- Automatically runs `pip install -r requirements.txt` when present.

### 🔀 Switch Version
- Browse up to 15 most recent tags of a node.
- Tag list is fetched from the GitHub REST API (with local git fallback).
- **Nothing is hidden** — including versions flagged by Comfy Registry.
- Click any version to check it out instantly. Or pull the latest on the current branch.
- Auto-stash: local uncommitted changes are preserved before switching.

### 🔄 Update checking
- Uses `git ls-remote` (git protocol, **no API rate limits**).
- Parallel checks via a thread pool — 200 nodes in ~10–30 seconds.
- Cached for 6 hours.
- Filter by "has update" with one click.

### 📦 Batch updates
- Select multiple outdated nodes with checkboxes.
- One-click `Update N selected` runs `git fetch + git pull --ff-only` sequentially.
- Progress log shows `[2/5] node-name: git fetch` in real time.
- Failures don't block the rest — summary at the end.

### 🗂️ Stash management
- Every destructive operation (`Switch Version`, `Update`) auto-stashes uncommitted changes.
- View stash details: files with statuses, insertions/deletions, base commit.
- **Restore** or **Drop** any stash individually.

### 🔗 Attach Git Remote
- If a node was installed via zip (no `.git`), you can attach a GitHub remote.
- Detects the repository URL from `pyproject.toml`, `metadata.json`, or `README.md`.
- Runs `git init` + `remote add` + `fetch` + `reset --soft` — **existing files are never overwritten**.
- After attaching, `Switch Version` and update checking work normally.

### 🧩 Version detection
Checks in priority order:
1. Git tag (`git describe --tags --exact-match`)
2. `metadata.json`
3. `pyproject.toml` (via `tomllib` / `tomli`)
4. `__init__.py` → `__version__`
5. `version.py`, `_version.py`
6. `setup.py`
7. `package.json`
8. `git describe` (fallback)

Version badge shows source (e.g. `v7.5 · tag`) with tooltip explaining conflicts.

### 🌐 Localization
UI messages available in **English**, **中文**, and **Русский** — auto-detected from ComfyUI settings.

---

## Installation

### Via ComfyUI Manager
Search for `Custom Node Manager` in the Install Custom Nodes dialog.

### Manual
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/YOUR-USERNAME/ComfyUI-Custom-Node-Manager
```

No additional setup required. Dependencies (`requests`, `tomli`) are installed automatically on first launch.

### Requirements

- **Python 3.10+**
- **git** available in `PATH` (already required by ComfyUI Manager itself)
- Internet access to `api.github.com` and `raw.githubusercontent.com`

---

## Usage

### Opening the manager

Three ways:

1. **Top bar icon** — enable `Show icon in top menu` in Settings → Custom Node Manager.
2. **Settings panel** — Settings → Custom Node Manager → `Open Custom Node Manager`.
3. **Direct API** — `http://127.0.0.1:8188/custom_node_manager/ping`

### Typical workflow

1. Open the manager → `🔄 Rescan` to index `custom_nodes`.
2. Click `⬆ Check updates` to see which nodes have new commits upstream.
3. Click the green `⬆ N updates` chip to filter to outdated nodes only.
4. For single-node version switching: `Switch Version` → pick a tag.
5. For bulk updates: tick checkboxes → `Update N selected`.
6. When the task finishes, click `🔄 Restart ComfyUI` — the page reloads automatically.

### GitHub Token (optional but recommended)

Without a token, GitHub API is limited to **60 requests/hour**. Since we cache responses for 1 hour, this covers ~60 unique `Switch Version` dialogs. With a token: **5000 requests/hour**.

To set up:

1. Go to GitHub → Settings → Developer settings → Personal access tokens → **Tokens (classic)**.
2. Generate new token with **no scopes** (public read is enough).
3. In ComfyUI: Settings → Custom Node Manager → `GitHub Token (optional, not used yet)` — paste the token.
4. Restart ComfyUI.

Or set the `GITHUB_TOKEN` environment variable — it takes priority.

---

## What makes this different from ComfyUI Manager

| Feature | ComfyUI Manager | Custom Node Manager |
|---|---|---|
| Version list source | `api.comfy.org` (Registry) | Git tags + GitHub API |
| Flagged versions | **Hidden** | **All visible** |
| Update detection | Registry metadata | `git ls-remote` (free) |
| Node cache | Central JSON | Local per-installation |
| Batch update | Limited | Full support |
| Stash management | No | Yes |
| Attach git to zip installs | No | Yes |
| Works when Registry is down | Partially | Yes |

**This extension does not contact `api.comfy.org` at all.** It works with pure git and GitHub.

---

## Troubleshooting

### "git was not found in the PATH"
Install git: [git-scm.com/downloads](https://git-scm.com/downloads). On Windows, make sure "Add to PATH" is checked during installation.

### "GitHub API rate limit has been reached"
You've hit the 60 req/hour limit. Options:
1. Wait until the reset (visible in the error tooltip).
2. Set a `GITHUB_TOKEN` (see above).
3. The extension automatically falls back to local tags.

### Node shows "no git remote"
The node was installed via zip (not `git clone`). Click `Attach Git Remote` — the extension will try to detect the repository URL from metadata. If not found, you can paste it manually.

### Node shows "not a node"
The folder doesn't look like a ComfyUI extension (no `NODE_CLASS_MAPPINGS`, no `PromptServer` routes, no `import comfy`). If you're sure it's a valid extension, please [open an issue](https://github.com/YOUR-USERNAME/ComfyUI-Custom-Node-Manager/issues) with the folder's `__init__.py` contents.

### Stash conflicts on Restore
If you switch versions, then Restore a stash made against a different version, git may produce merge conflicts. The stash is **not deleted** in this case — you can resolve conflicts manually via `git stash pop` in a terminal.

---

## Roadmap

- [x] Scanner with git metadata
- [x] Task queue with progress
- [x] Install / Switch Version / Remove
- [x] Custom dialogs (no native browser popups)
- [x] i18n (EN / ZH / RU)
- [x] Auto-stash + stash UI
- [x] Update checking via `git ls-remote`
- [x] Batch updates with checkboxes
- [x] GitHub API for remote tags
- [x] Attach Git Remote for zip installs
- [x] Extended version detection
- [ ] Sidebar tab in the "Other" category
- [ ] Fuzzy search
- [ ] Diff preview before switching

---

## Contributing

Issues and pull requests are welcome. For major changes, please open an issue first to discuss.

Special thanks to the ComfyUI community for the continuous stream of reports about false-positive flags from Comfy Registry.

---

## License

[APACHE 2.0](LICENSE)
