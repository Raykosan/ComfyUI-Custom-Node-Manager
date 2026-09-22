# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Raykosan (RaykoStudio)
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import os
import sys
import re
import json
import asyncio
import logging
import subprocess
import configparser
import datetime as _dt
from aiohttp import web
from server import PromptServer

try:
    from . import git_ops
    from . import task_queue
    from . import update_checker
    from . import github_client
    from . import security
except ImportError:
    _here = os.path.dirname(os.path.abspath(__file__))
    if _here not in sys.path:
        sys.path.insert(0, _here)
    import git_ops
    import task_queue
    import update_checker
    import github_client
    import security

logger = logging.getLogger("CustomNodeManager")

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
COMFYUI_ROOT = os.path.dirname(os.path.dirname(CURRENT_DIR))
CACHE_FILE = os.path.join(CURRENT_DIR, "cache.json")
WEB_DIR = os.path.join(CURRENT_DIR, "web")

_update_check_task = None

_gh_client = None
_gh_token_used = None


def _get_gh_client():
    global _gh_client, _gh_token_used
    token = github_client.resolve_token()
    if _gh_client is None or _gh_token_used != token:
        _gh_client = github_client.GitHubClient(token=token)
        _gh_token_used = token
        logger.info(f"GitHub client: {'with token' if token else 'without token (60 req/h)'}")
    return _gh_client


def _is_within(base: str, candidate: str) -> bool:
    base_abs = os.path.realpath(base)
    cand_abs = os.path.realpath(candidate)
    return cand_abs == base_abs or cand_abs.startswith(base_abs + os.sep)


def _safe_join(base: str, name: str):
    if not name or name in (".", ".."):
        return None
    if os.sep in name or "/" in name or "\\" in name or ".." in name:
        return None
    candidate = os.path.join(base, name)
    if not _is_within(base, candidate):
        return None
    return candidate


def _now_iso() -> str:
    return _dt.datetime.now().isoformat(timespec="seconds")


def get_custom_nodes_dirs() -> list:
    dirs = []
    try:
        import folder_paths
        dirs = list(folder_paths.get_folder_paths("custom_nodes"))
    except Exception as e:
        logger.warning(f"folder_paths недоступен: {e}")

    default_dir = os.path.join(COMFYUI_ROOT, "custom_nodes")
    if default_dir not in dirs and os.path.isdir(default_dir):
        dirs.append(default_dir)

    seen, result = set(), []
    for d in dirs:
        real = os.path.realpath(d)
        if real not in seen and os.path.isdir(real):
            seen.add(real)
            result.append(real)
    return result


def _normalize_git_url(url: str) -> str:
    m = re.match(r"^git@([^:]+):(.+?)(?:\.git)?$", url)
    if m:
        host, path = m.groups()
        return f"https://{host}/{path}"
    if url.endswith(".git"):
        url = url[:-4]
    return url


def _read_git_remote_url(node_dir: str):
    config_path = os.path.join(node_dir, ".git", "config")
    if not os.path.isfile(config_path):
        return None
    cp = configparser.ConfigParser()
    try:
        cp.read(config_path, encoding="utf-8")
    except Exception:
        return None
    for section in ('remote "origin"',):
        if cp.has_section(section):
            url = cp.get(section, "url", fallback=None)
            if url:
                return _normalize_git_url(url.strip())
    return None


def _git_run(node_dir: str, *args: str, timeout: float = 5.0):
    try:
        p = subprocess.run(
            ["git", "-C", node_dir, *args],
            capture_output=True, text=True, timeout=timeout, check=False,
        )
        if p.returncode != 0:
            return None
        return p.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None


def _git_info(node_dir: str) -> dict:
    info = {
        "git_url": None, "branch": None, "commit": None,
        "commit_short": None, "tag": None, "dirty": False,
        "stash_count": 0,
    }
    git_dir = os.path.join(node_dir, ".git")
    if not (os.path.isdir(git_dir) or os.path.isfile(git_dir)):
        return info

    info["git_url"] = _read_git_remote_url(node_dir)
    info["branch"] = _git_run(node_dir, "rev-parse", "--abbrev-ref", "HEAD")
    commit = _git_run(node_dir, "rev-parse", "HEAD")
    if commit:
        info["commit"] = commit
        info["commit_short"] = commit[:7]
    info["tag"] = _git_run(node_dir, "describe", "--tags", "--exact-match")
    status = _git_run(node_dir, "status", "--porcelain")
    info["dirty"] = bool(status)

    stash_list = _git_run(node_dir, "stash", "list")
    if stash_list:
        info["stash_count"] = sum(1 for line in stash_list.splitlines() if line.strip())
    return info


def _read_node_metadata(node_dir: str, tag: str = None) -> dict:
    meta = {
        "name": os.path.basename(node_dir),
        "description": None,
        "version": None,
        "version_source": None,
        "version_conflicts": [],
        "repository": None,
    }

    found = {}

    if tag:
        found["tag"] = tag

    meta_json = os.path.join(node_dir, "metadata.json")
    if os.path.isfile(meta_json):
        try:
            with open(meta_json, "r", encoding="utf-8") as f:
                data = json.load(f)
            meta["name"] = data.get("name") or meta["name"]
            meta["description"] = data.get("description")
            meta["repository"] = (
                data.get("repository")
                or data.get("repo")
                or data.get("source")
            )
            v = data.get("version")
            if v:
                found["metadata.json"] = str(v)
        except Exception:
            pass

    pyproj = os.path.join(node_dir, "pyproject.toml")
    if os.path.isfile(pyproj):
        try:
            tdata = None
            try:
                import tomllib as _toml
                with open(pyproj, "rb") as f:
                    tdata = _toml.load(f)
            except ImportError:
                tdata = None

            if tdata:
                proj = tdata.get("project", {}) or {}
                urls = proj.get("urls", {}) or {}
                repo = (
                    urls.get("Repository")
                    or urls.get("Source")
                    or urls.get("Homepage")
                    or urls.get("Issues")
                )
                if repo and not meta["repository"]:
                    meta["repository"] = repo
                if not meta["description"]:
                    meta["description"] = proj.get("description")
                v = proj.get("version")
                if v:
                    found["pyproject.toml"] = str(v)

                poetry = tdata.get("tool", {}).get("poetry", {}) or {}
                if poetry:
                    if not meta["repository"]:
                        meta["repository"] = poetry.get("repository")
                    if not meta["description"]:
                        meta["description"] = poetry.get("description")
                    v2 = poetry.get("version")
                    if v2 and "pyproject.toml" not in found:
                        found["pyproject.toml"] = str(v2)

            with open(pyproj, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            if not meta["repository"]:
                m = re.search(
                    r'(?:repository|source|homepage)\s*=\s*["\']'
                    r'(https?://github\.com/[^"\']+)["\']',
                    content, re.IGNORECASE,
                )
                if m:
                    meta["repository"] = m.group(1)
            if "pyproject.toml" not in found:
                m2 = re.search(
                    r'^\s*version\s*=\s*["\']([^"\']+)["\']',
                    content, re.MULTILINE,
                )
                if m2:
                    found["pyproject.toml"] = m2.group(1)
        except Exception:
            pass

    init_py = os.path.join(node_dir, "__init__.py")
    if os.path.isfile(init_py):
        try:
            with open(init_py, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read(500_000)
            m = re.search(
                r'^__version__\s*[:=]\s*["\']([^"\']+)["\']',
                content, re.MULTILINE,
            )
            if m:
                found["__init__.py"] = m.group(1)
        except Exception:
            pass

    for fname in ("version.py", "_version.py", "VERSION.py"):
        vpath = os.path.join(node_dir, fname)
        if not os.path.isfile(vpath):
            continue
        try:
            with open(vpath, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read(50_000)
            m = re.search(
                r'^__version__\s*[:=]\s*["\']([^"\']+)["\']',
                content, re.MULTILINE,
            )
            if m:
                found[fname] = m.group(1)
                break
            m = re.search(
                r'^VERSION\s*[:=]\s*["\']([^"\']+)["\']',
                content, re.MULTILINE,
            )
            if m:
                found[fname] = m.group(1)
                break
        except Exception:
            pass

    setup_py = os.path.join(node_dir, "setup.py")
    if os.path.isfile(setup_py):
        try:
            with open(setup_py, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read(100_000)
            m = re.search(r'version\s*=\s*["\']([^"\']+)["\']', content)
            if m:
                found["setup.py"] = m.group(1)
        except Exception:
            pass

    pkg_json = os.path.join(node_dir, "package.json")
    if os.path.isfile(pkg_json):
        try:
            with open(pkg_json, "r", encoding="utf-8") as f:
                data = json.load(f)
            v = data.get("version")
            if v:
                found["package.json"] = str(v)
        except Exception:
            pass

    priority = [
        "tag",
        "metadata.json",
        "pyproject.toml",
        "__init__.py",
        "version.py",
        "_version.py",
        "VERSION.py",
        "setup.py",
        "package.json",
    ]
    for src in priority:
        if src in found:
            meta["version"] = found[src]
            meta["version_source"] = src
            break

    for src, v in found.items():
        if src != meta["version_source"] and v != meta["version"]:
            meta["version_conflicts"].append({"source": src, "version": v})

    return meta


def _looks_like_node(node_dir: str) -> bool:
    init_py = os.path.join(node_dir, "__init__.py")
    if os.path.isfile(init_py):
        try:
            with open(init_py, "r", encoding="utf-8", errors="ignore") as f:
                head = f.read(500_000)

            strong_markers = (
                "NODE_CLASS_MAPPINGS",
                "NODE_DISPLAY_NAME_MAPPINGS",
                "WEB_DIRECTORY",
                "PromptServer",
            )
            for m in strong_markers:
                if m in head:
                    return True

            weak_markers = (
                "import comfy",
                "from comfy",
                "import nodes",
                "from nodes",
                "comfy.ldm",
                "comfy.sd",
                "folder_paths",
            )
            for m in weak_markers:
                if m in head:
                    return True

            if len(head) > 200:
                for marker in ("requirements.txt", "install.py", "pyproject.toml"):
                    if os.path.isfile(os.path.join(node_dir, marker)):
                        return True
        except Exception:
            pass

    for marker in ("pyproject.toml", "metadata.json", "install.py", "requirements.txt"):
        if os.path.isfile(os.path.join(node_dir, marker)):
            return True
    return False


def _scan_single_node(node_dir: str):
    try:
        if not os.path.isdir(node_dir):
            return None
        name = os.path.basename(node_dir)
        if name.startswith(".") or name.startswith("__") or name.endswith(".disabled"):
            return None

        is_node = _looks_like_node(node_dir)
        git_info = _git_info(node_dir)

        if not is_node and not git_info["git_url"]:
            return None

        meta = _read_node_metadata(node_dir, tag=git_info.get("tag"))

        if not meta["version"]:
            desc = _git_run(node_dir, "describe", "--tags")
            if desc:
                clean = re.sub(r"-\d+-g[0-9a-f]+$", "", desc)
                if clean:
                    meta["version"] = clean
                    meta["version_source"] = "git describe"

        detected_url = None
        if not git_info["git_url"] and meta.get("repository"):
            detected_url = _normalize_git_url(meta["repository"].strip())

        return {
            "folder": name,
            "path": node_dir,
            "is_node": is_node,
            "name": meta["name"],
            "description": meta["description"],
            "version": meta["version"],
            "version_source": meta["version_source"],
            "version_conflicts": meta["version_conflicts"],
            "git_url": git_info["git_url"],
            "detected_git_url": detected_url,
            "branch": git_info["branch"],
            "commit": git_info["commit"],
            "commit_short": git_info["commit_short"],
            "tag": git_info["tag"],
            "dirty": git_info["dirty"],
            "stash_count": git_info.get("stash_count", 0),
            "has_requirements": os.path.isfile(os.path.join(node_dir, "requirements.txt")),
            "has_install_py": os.path.isfile(os.path.join(node_dir, "install.py")),
        }
    except Exception:
        logger.exception(f"Ошибка сканирования {node_dir}")
        return None


def scan_all_nodes() -> list:
    nodes, seen = [], set()
    for base in get_custom_nodes_dirs():
        try:
            entries = sorted(os.listdir(base))
        except OSError as e:
            logger.warning(f"Не читается {base}: {e}")
            continue
        for entry in entries:
            node_dir = os.path.join(base, entry)
            real = os.path.realpath(node_dir)
            if real in seen:
                continue
            seen.add(real)
            info = _scan_single_node(node_dir)
            if info:
                info["base"] = base
                nodes.append(info)
    return nodes


def _load_cache() -> dict:
    if not os.path.isfile(CACHE_FILE):
        return {"nodes": {}, "updated": None}
    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"nodes": {}, "updated": None}


def _save_cache(cache: dict) -> None:
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.warning(f"Не удалось сохранить кэш: {e}")


def _find_node_dir(folder: str):
    for base in get_custom_nodes_dirs():
        safe = _safe_join(base, folder)
        if safe and os.path.isdir(safe):
            return safe
    return None


def _post_update_refresh(folders: list) -> None:
    cache = _load_cache()
    nodes = cache.get("nodes") or {}
    updates = cache.get("updates") or {}

    nodes_empty = (len(nodes) == 0)
    if nodes_empty:
        logger.info(
            "Post-refresh: node cache is empty, skipping node metadata update."
        )

    changed = False

    for folder in folders:
        if not folder:
            continue

        if not nodes_empty:
            node_dir = _find_node_dir(folder)
            if node_dir:
                info = _scan_single_node(node_dir)
                if info:
                    info["base"] = os.path.dirname(node_dir)
                    nodes[folder] = info
                    changed = True

        if folder in updates:
            del updates[folder]
            changed = True

    if changed:
        if not nodes_empty:
            cache["nodes"] = nodes
        cache["updates"] = updates
        _save_cache(cache)
        logger.info(f"Cache refreshed for: {', '.join(folders)}")


def _on_task_success(task) -> None:
    try:
        kind = task.kind
        if kind == "update":
            folders = [task.payload.get("folder")]
        elif kind == "batch_update":
            results = (task.result or {}).get("results") or []
            folders = [
                r.get("folder")
                for r in results
                if r.get("ok") and r.get("folder")
            ]
        elif kind == "install":
            folders = [task.payload.get("folder")]
        else:
            return

        folders = [f for f in folders if f]
        if folders:
            _post_update_refresh(folders)
    except Exception:
        logger.exception("post-success hook failed")


task_queue.set_post_success_hook(_on_task_success)


@PromptServer.instance.routes.get("/custom_node_manager/ping")
@security.local_only
async def api_ping(request):
    return web.json_response({"status": "ok", "module": "CustomNodeManager"})


@PromptServer.instance.routes.get("/custom_node_manager/token")
@security.local_only
async def api_token(request):
    return web.json_response({"token": security.get_session_token()})


@PromptServer.instance.routes.get("/custom_node_manager/scan")
@security.local_only
async def api_scan(request):
    loop = asyncio.get_running_loop()
    try:
        nodes = await loop.run_in_executor(None, scan_all_nodes)
    except Exception as e:
        logger.exception("Ошибка сканирования")
        return web.json_response({"error": str(e)}, status=500)

    cache = _load_cache()
    cache["nodes"] = {n["folder"]: n for n in nodes}
    cache["updated"] = _now_iso()
    _save_cache(cache)

    return web.json_response({
        "success": True,
        "count": len(nodes),
        "updated": cache["updated"],
        "nodes": nodes,
    })


@PromptServer.instance.routes.get("/custom_node_manager/cache")
@security.local_only
async def api_cache(request):
    return web.json_response({"success": True, **_load_cache()})


@PromptServer.instance.routes.post("/custom_node_manager/install")
@security.local_and_token
async def api_install(request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)

    git_url = (data.get("git_url") or "").strip()
    if not re.match(r"^(https?://|git@|ssh://)", git_url):
        return web.json_response({"error": "invalid git_url"}, status=400)

    ok, reason = security.validate_git_url(git_url)
    if not ok:
        return web.json_response({"error": f"git_url rejected: {reason}"}, status=400)

    if not git_ops.git_available():
        return web.json_response({"error": "git не найден в PATH"}, status=500)

    folder = (data.get("folder") or "").strip() or git_ops.derive_folder_name(git_url)
    folder = re.sub(r"[^A-Za-z0-9_.\-]", "_", folder).strip("._")
    if not folder:
        return web.json_response({"error": "invalid folder name"}, status=400)

    version = (data.get("version") or "").strip() or None

    roots = get_custom_nodes_dirs()
    if not roots:
        return web.json_response({"error": "custom_nodes не найдены"}, status=500)

    target_dir = os.path.join(roots[0], folder)
    if os.path.exists(target_dir):
        return web.json_response(
            {"error": f"Папка уже существует: {folder}"}, status=409
        )

    task = task_queue.submit("install", {
        "git_url": git_url,
        "version": version,
        "target_dir": target_dir,
        "folder": folder,
    })
    return web.json_response({
        "success": True, "task_id": task.id,
        "folder": folder, "target_dir": target_dir,
    })


@PromptServer.instance.routes.post("/custom_node_manager/update")
@security.local_and_token
async def api_update(request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)

    folder = (data.get("folder") or "").strip()
    if not folder:
        return web.json_response({"error": "folder обязателен"}, status=400)

    node_dir = _find_node_dir(folder)
    if not node_dir:
        return web.json_response({"error": f"Нода не найдена: {folder}"}, status=404)

    if not git_ops.git_available():
        return web.json_response({"error": "git не найден в PATH"}, status=500)

    version = (data.get("version") or "").strip() or None

    task = task_queue.submit("update", {
        "node_dir": node_dir,
        "folder": folder,
        "version": version,
    })
    return web.json_response({"success": True, "task_id": task.id})


@PromptServer.instance.routes.post("/custom_node_manager/remove")
@security.local_and_token
async def api_remove(request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)

    folder = (data.get("folder") or "").strip()
    if not folder:
        return web.json_response({"error": "folder обязателен"}, status=400)
    if os.path.isabs(folder):
        return web.json_response({"error": "absolute paths not allowed"}, status=400)
    if "/" in folder or "\\" in folder or os.sep in folder:
        return web.json_response({"error": "path separators not allowed"}, status=400)
    if ".." in folder:
        return web.json_response({"error": "parent traversal not allowed"}, status=400)

    node_dir = _find_node_dir(folder)
    if not node_dir:
        return web.json_response({"error": f"Нода не найдена: {folder}"}, status=404)

    roots = get_custom_nodes_dirs()
    if not roots:
        return web.json_response({"error": "custom_nodes не найдены"}, status=500)

    node_real = os.path.realpath(node_dir)
    inside = False
    for root in roots:
        root_real = os.path.realpath(root)
        try:
            if os.path.commonpath([root_real, node_real]) == root_real:
                inside = True
                break
        except ValueError:
            continue

    if not inside:
        return web.json_response(
            {"error": "target path is outside custom_nodes"}, status=403
        )

    for root in roots:
        if node_real == os.path.realpath(root):
            return web.json_response(
                {"error": "cannot remove custom_nodes root"}, status=403
            )

    task = task_queue.submit("remove", {
        "node_dir": node_dir,
        "roots": roots,
        "folder": folder,
    })
    return web.json_response({"success": True, "task_id": task.id})


@PromptServer.instance.routes.post("/custom_node_manager/batch_update")
@security.local_and_token
async def api_batch_update(request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)

    folders = data.get("folders") or []
    if not isinstance(folders, list) or not folders:
        return web.json_response({"error": "folders обязательны"}, status=400)

    if not git_ops.git_available():
        return web.json_response({"error": "git не найден в PATH"}, status=500)

    items = []
    for folder in folders:
        folder = str(folder).strip()
        if not folder:
            continue
        node_dir = _find_node_dir(folder)
        if not node_dir:
            continue
        items.append({"folder": folder, "node_dir": node_dir})

    if not items:
        return web.json_response({"error": "не найдено ни одной ноды"}, status=404)

    task = task_queue.submit("batch_update", {"items": items})
    return web.json_response({
        "success": True,
        "task_id": task.id,
        "total": len(items),
    })


@PromptServer.instance.routes.get("/custom_node_manager/versions/{folder}")
@security.local_only
async def api_versions(request):
    folder = request.match_info["folder"]
    node_dir = _find_node_dir(folder)
    if not node_dir:
        return web.json_response({"error": f"Нода не найдена: {folder}"}, status=404)
    if not git_ops.git_available():
        return web.json_response({"error": "git не найден в PATH"}, status=500)

    loop = asyncio.get_running_loop()
    try:
        data = await loop.run_in_executor(None, git_ops.list_versions, node_dir)
    except Exception as e:
        logger.exception(f"list_versions({folder}) упал")
        return web.json_response({"error": str(e)}, status=500)

    return web.json_response({"success": True, "folder": folder, **data})


@PromptServer.instance.routes.get("/custom_node_manager/versions_remote/{folder}")
@security.local_only
async def api_versions_remote(request):
    folder = request.match_info["folder"]
    node_dir = _find_node_dir(folder)
    if not node_dir:
        return web.json_response({"error": f"Нода не найдена: {folder}"}, status=404)

    git_url = _read_git_remote_url(node_dir)
    if not git_url:
        return web.json_response({"error": "no git remote"}, status=400)

    parsed = github_client.GitHubClient.parse_git_url(git_url)
    if not parsed:
        return web.json_response({"error": "not a github repo"}, status=400)

    owner, repo = parsed
    client = _get_gh_client()

    loop = asyncio.get_running_loop()
    tags_raw = await loop.run_in_executor(None, client.get_tags, owner, repo)

    if tags_raw is None:
        return web.json_response({
            "success": False,
            "error": client.last_error or "github api unavailable",
            "rate_limit_remaining": client.rate_limit_remaining,
        }, status=502)

    tags = []
    for t in tags_raw[:github_client.MAX_TAGS_RETURN]:
        commit = (t.get("commit") or {}).get("sha") or ""
        tags.append({
            "ref": t.get("name") or "",
            "commit": commit[:7] if commit else "",
        })

    return web.json_response({
        "success": True,
        "source": "github",
        "owner": owner,
        "repo": repo,
        "tags": tags,
        "rate_limit_remaining": client.rate_limit_remaining,
        "has_token": client.has_token,
    })


@PromptServer.instance.routes.get("/custom_node_manager/stashes/{folder}")
@security.local_only
async def api_stashes(request):
    folder = request.match_info["folder"]
    node_dir = _find_node_dir(folder)
    if not node_dir:
        return web.json_response({"error": f"Нода не найдена: {folder}"}, status=404)
    if not git_ops.git_available():
        return web.json_response({"error": "git не найден в PATH"}, status=500)

    loop = asyncio.get_running_loop()
    try:
        stashes = await loop.run_in_executor(None, git_ops.list_stashes, node_dir)
    except Exception as e:
        logger.exception(f"list_stashes({folder}) упал")
        return web.json_response({"error": str(e)}, status=500)

    return web.json_response({"success": True, "folder": folder, "stashes": stashes})


@PromptServer.instance.routes.post("/custom_node_manager/stash/pop")
@security.local_and_token
async def api_stash_pop(request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)

    folder = (data.get("folder") or "").strip()
    ref = (data.get("ref") or "").strip()
    if not folder or not ref:
        return web.json_response({"error": "folder и ref обязательны"}, status=400)

    node_dir = _find_node_dir(folder)
    if not node_dir:
        return web.json_response({"error": f"Нода не найдена: {folder}"}, status=404)

    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(None, git_ops.pop_stash, node_dir, ref)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

    return web.json_response({"success": True, **result})


@PromptServer.instance.routes.post("/custom_node_manager/stash/drop")
@security.local_and_token
async def api_stash_drop(request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)

    folder = (data.get("folder") or "").strip()
    ref = (data.get("ref") or "").strip()
    if not folder or not ref:
        return web.json_response({"error": "folder и ref обязательны"}, status=400)

    node_dir = _find_node_dir(folder)
    if not node_dir:
        return web.json_response({"error": f"Нода не найдена: {folder}"}, status=404)

    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(None, git_ops.drop_stash, node_dir, ref)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

    return web.json_response({"success": True, **result})


@PromptServer.instance.routes.post("/custom_node_manager/attach_remote")
@security.local_and_token
async def api_attach_remote(request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)

    folder = (data.get("folder") or "").strip()
    git_url = (data.get("git_url") or "").strip()
    if not folder or not git_url:
        return web.json_response({"error": "folder и git_url обязательны"}, status=400)

    if not re.match(r"^(https?://|git@|ssh://)", git_url):
        return web.json_response({"error": "invalid git_url"}, status=400)

    ok, reason = security.validate_git_url(git_url)
    if not ok:
        return web.json_response({"error": f"git_url rejected: {reason}"}, status=400)

    node_dir = _find_node_dir(folder)
    if not node_dir:
        return web.json_response({"error": f"Нода не найдена: {folder}"}, status=404)

    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(
            None, git_ops.attach_git_remote, node_dir, git_url, lambda m: None
        )
    except Exception as e:
        logger.exception(f"attach_remote({folder}) упал")
        return web.json_response({"error": str(e)}, status=500)

    cache = _load_cache()
    cache["nodes"] = {}
    cache["updated"] = None
    _save_cache(cache)

    return web.json_response({"success": True, "folder": folder, **result})


async def _run_update_check():
    loop = asyncio.get_running_loop()

    try:
        cache = _load_cache()
        cached_nodes = cache.get("nodes") or {}
        nodes = list(cached_nodes.values())

        if not nodes:
            logger.info("Update check: cache empty, scanning custom_nodes")
            nodes = await loop.run_in_executor(None, scan_all_nodes)
            cache["nodes"] = {n["folder"]: n for n in nodes}
            cache["updated"] = _now_iso()
            _save_cache(cache)
        else:
            logger.info(f"Update check: using cached node list ({len(nodes)} nodes)")

        if not nodes:
            logger.info("Update check: no nodes to check")
            cache["updates"] = {}
            cache["updates_checked"] = _now_iso()
            _save_cache(cache)
            return

        def _prog(done, total):
            if done % 10 == 0 or done == total:
                logger.info(f"Update check: {done}/{total}")

        result = await loop.run_in_executor(
            None, update_checker.check_all_nodes, nodes, _prog
        )

        cache = _load_cache()
        cache["updates"] = result["results"]
        cache["updates_checked"] = _now_iso()
        _save_cache(cache)

        logger.info(
            f"Update check done: {result['checked']}/{result['total']} "
            f"({sum(1 for r in result['results'].values() if r.get('has_update'))} with updates)"
        )
    except Exception:
        logger.exception("Update check failed")


@PromptServer.instance.routes.post("/custom_node_manager/check_updates")
@security.local_and_token
async def api_check_updates(request):
    global _update_check_task
    if _update_check_task and not _update_check_task.done():
        return web.json_response({"success": True, "already_running": True})

    _update_check_task = asyncio.create_task(_run_update_check())
    return web.json_response({"success": True, "started": True})


@PromptServer.instance.routes.get("/custom_node_manager/updates")
@security.local_only
async def api_get_updates(request):
    global _update_check_task
    cache = _load_cache()
    return web.json_response({
        "success": True,
        "updates": cache.get("updates", {}),
        "checked_at": cache.get("updates_checked"),
        "checking": bool(_update_check_task and not _update_check_task.done()),
    })


@PromptServer.instance.routes.get("/custom_node_manager/task/{task_id}")
@security.local_only
async def api_task(request):
    task_id = request.match_info["task_id"]
    task = task_queue.TASKS.get(task_id)
    if not task:
        return web.json_response({"error": "task not found"}, status=404)
    return web.json_response({
        "id": task.id,
        "kind": task.kind,
        "status": task.status,
        "progress": task.progress,
        "error": task.error,
        "result": task.result,
        "log": task.log[-50:],
        "created": task.created,
        "finished": task.finished,
    })


@PromptServer.instance.routes.get("/custom_node_manager/tasks")
@security.local_only
async def api_tasks(request):
    items = sorted(task_queue.TASKS.values(), key=lambda t: t.created, reverse=True)[:50]
    return web.json_response({
        "success": True,
        "tasks": [
            {
                "id": t.id, "kind": t.kind, "status": t.status,
                "progress": t.progress, "error": t.error,
                "created": t.created, "finished": t.finished,
                "folder": t.payload.get("folder"),
            }
            for t in items
        ],
    })


@PromptServer.instance.routes.post("/custom_node_manager/restart")
@security.local_and_token
async def api_restart(request):
    try:
        logger.info("Перезапуск ComfyUI по запросу Custom Node Manager")
        os.execv(sys.executable, [sys.executable] + sys.argv)
    except Exception as e:
        logger.exception("Не удалось перезапустить")
        return web.json_response({"error": str(e)}, status=500)


WEB_DIRECTORY = "./web"

logger.info(f"🦊 Custom Node Manager initialized. custom_nodes: {get_custom_nodes_dirs()}")

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}