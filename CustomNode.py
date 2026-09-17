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

# Соседние модули (работает и как пакет, и как top-level)
try:
    from . import git_ops
    from . import task_queue
except ImportError:
    import git_ops          # type: ignore
    import task_queue       # type: ignore

logger = logging.getLogger("CustomNodeManager")

# --- Пути ---------------------------------------------------------------

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
COMFYUI_ROOT = os.path.dirname(os.path.dirname(CURRENT_DIR))
CACHE_FILE = os.path.join(CURRENT_DIR, "cache.json")
WEB_DIR = os.path.join(CURRENT_DIR, "web")

# --- Утилиты безопасности ----------------------------------------------

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


# --- custom_nodes -------------------------------------------------------

def get_custom_nodes_dirs() -> list[str]:
    dirs: list[str] = []
    try:
        import folder_paths  # type: ignore
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


# --- Git helpers --------------------------------------------------------

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
    return info


# --- Метаданные нод -----------------------------------------------------

def _read_node_metadata(node_dir: str) -> dict:
    meta = {"name": os.path.basename(node_dir), "description": None, "version": None}

    meta_json = os.path.join(node_dir, "metadata.json")
    if os.path.isfile(meta_json):
        try:
            with open(meta_json, "r", encoding="utf-8") as f:
                data = json.load(f)
            meta["name"] = data.get("name") or meta["name"]
            meta["description"] = data.get("description")
            meta["version"] = data.get("version")
        except Exception:
            pass

    pyproj = os.path.join(node_dir, "pyproject.toml")
    if os.path.isfile(pyproj) and not meta["version"]:
        try:
            with open(pyproj, "r", encoding="utf-8") as f:
                content = f.read()
            m = re.search(r'^\s*version\s*=\s*["\']([^"\']+)["\']', content, re.MULTILINE)
            if m:
                meta["version"] = m.group(1)
        except Exception:
            pass

    return meta


def _looks_like_node(node_dir: str) -> bool:
    init_py = os.path.join(node_dir, "__init__.py")
    if os.path.isfile(init_py):
        try:
            with open(init_py, "r", encoding="utf-8", errors="ignore") as f:
                head = f.read(200_000)
            if "NODE_CLASS_MAPPINGS" in head or "WEB_DIRECTORY" in head:
                return True
        except Exception:
            pass
    for marker in ("pyproject.toml", "metadata.json", "install.py", "requirements.txt"):
        if os.path.isfile(os.path.join(node_dir, marker)):
            return True
    return False


# --- Сканер -------------------------------------------------------------

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

        meta = _read_node_metadata(node_dir)

        return {
            "folder": name,
            "path": node_dir,
            "is_node": is_node,
            "name": meta["name"],
            "description": meta["description"],
            "version": meta["version"],
            "git_url": git_info["git_url"],
            "branch": git_info["branch"],
            "commit": git_info["commit"],
            "commit_short": git_info["commit_short"],
            "tag": git_info["tag"],
            "dirty": git_info["dirty"],
            "has_requirements": os.path.isfile(os.path.join(node_dir, "requirements.txt")),
            "has_install_py": os.path.isfile(os.path.join(node_dir, "install.py")),
        }
    except Exception:
        logger.exception(f"Ошибка сканирования {node_dir}")
        return None


def scan_all_nodes() -> list[dict]:
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


# --- Кэш ----------------------------------------------------------------

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


# --- Helpers ------------------------------------------------------------

def _find_node_dir(folder: str):
    for base in get_custom_nodes_dirs():
        safe = _safe_join(base, folder)
        if safe and os.path.isdir(safe):
            return safe
    return None


# =======================================================================
#  HTTP API
# =======================================================================

@PromptServer.instance.routes.get("/custom_node_manager/ping")
async def api_ping(request):
    return web.json_response({"status": "ok", "module": "CustomNodeManager"})


@PromptServer.instance.routes.get("/custom_node_manager/scan")
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
async def api_cache(request):
    return web.json_response({"success": True, **_load_cache()})


# --- install ------------------------------------------------------------

@PromptServer.instance.routes.post("/custom_node_manager/install")
async def api_install(request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)

    git_url = (data.get("git_url") or "").strip()
    if not re.match(r"^(https?://|git@)", git_url):
        return web.json_response({"error": "invalid git_url"}, status=400)

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


# --- update -------------------------------------------------------------

@PromptServer.instance.routes.post("/custom_node_manager/update")
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


# --- remove -------------------------------------------------------------

@PromptServer.instance.routes.post("/custom_node_manager/remove")
async def api_remove(request):
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

    roots = get_custom_nodes_dirs()

    task = task_queue.submit("remove", {
        "node_dir": node_dir,
        "roots": roots,
        "folder": folder,
    })
    return web.json_response({"success": True, "task_id": task.id})


# --- tasks --------------------------------------------------------------

@PromptServer.instance.routes.get("/custom_node_manager/task/{task_id}")
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


# --- restart ------------------------------------------------------------

@PromptServer.instance.routes.post("/custom_node_manager/restart")
async def api_restart(request):
    try:
        logger.info("Перезапуск ComfyUI по запросу Custom Node Manager")
        # os.execv на Windows использует _P_OVERLAY: процесс замещается
        # на месте с тем же PID и той же консолью. cmd.exe, запустивший .bat,
        # не видит завершения процесса, поэтому .bat не доходит до pause.
        os.execv(sys.executable, [sys.executable] + sys.argv)
    except Exception as e:
        logger.exception("Не удалось перезапустить")
        return web.json_response({"error": str(e)}, status=500)

# =======================================================================

@PromptServer.instance.routes.get("/custom_node_manager/versions/{folder}")
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

WEB_DIRECTORY = "./web"

logger.info(f"🦊 Custom Node Manager initialized. custom_nodes: {get_custom_nodes_dirs()}")

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}