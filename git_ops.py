"""
Синхронные git-операции для Custom Node Manager.
Все функции вызываются из executor (не блокируют event loop).
"""

import os
import re
import sys
import stat
import shutil
import logging
import subprocess
from typing import Callable, Optional

logger = logging.getLogger("CustomNodeManager.git")

ProgressCb = Callable[[str], None]

DEFAULT_GIT_TIMEOUT = 600.0   # clone / fetch
DEFAULT_PIP_TIMEOUT = 1800.0  # pip install (торч иногда тянется долго)


# --- Низкоуровневые утилиты --------------------------------------------

def git_available() -> bool:
    return shutil.which("git") is not None


def run_git(cwd: Optional[str], *args: str, timeout: float = DEFAULT_GIT_TIMEOUT):
    """Возвращает (rc, stdout, stderr). Никогда не бросает — только возвращает rc=-1."""
    cmd = ["git"]
    if cwd:
        cmd += ["-C", cwd]
    cmd += list(args)
    try:
        p = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=timeout, check=False,
        )
        return p.returncode, (p.stdout or "").strip(), (p.stderr or "").strip()
    except subprocess.TimeoutExpired:
        return -1, "", f"git timeout after {timeout}s"
    except FileNotFoundError:
        return -1, "", "git executable not found in PATH"
    except OSError as e:
        return -1, "", str(e)


def derive_folder_name(git_url: str) -> str:
    """Из https://github.com/owner/repo.git → repo"""
    url = git_url.rstrip("/")
    if url.endswith(".git"):
        url = url[:-4]
    tail = url.rsplit("/", 1)[-1]
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", tail).strip("._")
    return safe or "custom_node"


def _is_within(base: str, candidate: str) -> bool:
    base_abs = os.path.realpath(base)
    cand_abs = os.path.realpath(candidate)
    return cand_abs == base_abs or cand_abs.startswith(base_abs + os.sep)


# --- pip ----------------------------------------------------------------

def pip_install(cwd: str, requirements_file: str, progress: ProgressCb) -> dict:
    """Устанавливает зависимости. Не бросает при ошибке — возвращает dict с rc/выводом."""
    cmd = [sys.executable, "-m", "pip", "install", "-r", requirements_file]
    progress(f"pip install -r {os.path.basename(requirements_file)}")
    try:
        p = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True,
            timeout=DEFAULT_PIP_TIMEOUT, check=False,
        )
        return {
            "rc": p.returncode,
            "stdout_tail": (p.stdout or "")[-1500:],
            "stderr_tail": (p.stderr or "")[-1500:],
        }
    except subprocess.TimeoutExpired:
        return {"rc": -1, "error": f"pip timeout after {DEFAULT_PIP_TIMEOUT}s"}
    except Exception as e:
        return {"rc": -1, "error": str(e)}


# --- Установка ----------------------------------------------------------

def install_node(
    git_url: str,
    target_dir: str,
    version: Optional[str] = None,
    progress: ProgressCb = lambda msg: None,
) -> dict:
    """
    Клонирует репозиторий в target_dir.
    Если задан version (tag/branch/commit) — делает checkout.
    Затем ставит requirements.txt, если он есть.
    """
    if not git_available():
        raise RuntimeError("git не найден в PATH")
    if os.path.exists(target_dir):
        raise RuntimeError(f"Папка уже существует: {target_dir}")

    progress(f"git clone {git_url}")
    rc, out, err = run_git(None, "clone", "--recursive", git_url, target_dir)
    if rc != 0:
        shutil.rmtree(target_dir, ignore_errors=True)
        raise RuntimeError(f"git clone не удался: {err or out}")

    if version:
        progress(f"git checkout {version}")
        rc, out, err = run_git(target_dir, "checkout", version)
        if rc != 0:
            raise RuntimeError(f"git checkout {version} не удался: {err or out}")

    pip_result = None
    req = os.path.join(target_dir, "requirements.txt")
    if os.path.isfile(req):
        pip_result = pip_install(target_dir, req, progress)
        if pip_result.get("rc", -1) != 0:
            progress("⚠️ pip install завершился с ошибкой — проверьте лог")
    else:
        progress("requirements.txt отсутствует — пропускаем pip")

    if os.path.isfile(os.path.join(target_dir, "install.py")):
        progress("⚠️ Обнаружен install.py — запустите вручную при необходимости")

    return {
        "folder": os.path.basename(target_dir),
        "path": target_dir,
        "pip": pip_result,
    }


# --- Обновление ---------------------------------------------------------

def update_node(
    node_dir: str,
    version: Optional[str] = None,
    progress: ProgressCb = lambda msg: None,
) -> dict:
    """
    Обновляет ноду: fetch + checkout (если version задан) либо pull --ff-only.
    Отказывается работать, если в репозитории есть незакоммиченные изменения.
    """
    if not git_available():
        raise RuntimeError("git не найден в PATH")
    if not os.path.isdir(os.path.join(node_dir, ".git")):
        raise RuntimeError(f"Не git-репозиторий: {node_dir}")

    # Проверка на dirty
    rc, out, _ = run_git(node_dir, "status", "--porcelain")
    if rc == 0 and out.strip():
        raise RuntimeError(
            "В репозитории есть локальные изменения. "
            "Сделайте git stash / commit или откатите их вручную."
        )

    progress("git fetch --tags --prune")
    rc, out, err = run_git(node_dir, "fetch", "--tags", "--prune")
    if rc != 0:
        raise RuntimeError(f"git fetch не удался: {err or out}")

    if version:
        progress(f"git checkout {version}")
        rc, out, err = run_git(node_dir, "checkout", version)
        if rc != 0:
            raise RuntimeError(f"git checkout {version} не удался: {err or out}")
    else:
        progress("git pull --ff-only")
        rc, out, err = run_git(node_dir, "pull", "--ff-only")
        if rc != 0:
            raise RuntimeError(f"git pull не удался: {err or out}")

    pip_result = None
    req = os.path.join(node_dir, "requirements.txt")
    if os.path.isfile(req):
        pip_result = pip_install(node_dir, req, progress)
        if pip_result.get("rc", -1) != 0:
            progress("⚠️ pip install завершился с ошибкой — проверьте лог")

    return {"pip": pip_result}


# --- Удаление -----------------------------------------------------------

def _rmtree_onerror(func, path, exc_info):
    """Windows: .git-объекты могут быть read-only."""
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except Exception:
        pass


def remove_node(node_dir: str, custom_nodes_roots: list[str]) -> None:
    """Удаляет папку ноды с защитой от случайного выхода за пределы custom_nodes."""
    real = os.path.realpath(node_dir)

    # Нельзя удалить корень custom_nodes
    for root in custom_nodes_roots:
        if real == os.path.realpath(root):
            raise RuntimeError("Отказ: попытка удалить корень custom_nodes")

    # node_dir должен лежать внутри одного из корней
    if not any(_is_within(root, real) for root in custom_nodes_roots):
        raise RuntimeError(f"Отказ: {real} вне custom_nodes")

    if not os.path.isdir(real):
        raise RuntimeError(f"Не папка: {real}")

    shutil.rmtree(real, onerror=_rmtree_onerror)

# --- Список версий ------------------------------------------------------

def _git_lines(node_dir: str, *args: str, timeout: float = 10.0) -> list[str]:
    rc, out, _ = run_git(node_dir, *args, timeout=timeout)
    if rc != 0:
        return []
    return [ln for ln in out.splitlines() if ln.strip()]


def list_versions(node_dir: str, max_tags: int = 15) -> dict:
    """
    Возвращает текущее состояние ноды и последние max_tags тегов
    (сортировка по дате создания, свежие сверху).
    """
    if not os.path.isdir(os.path.join(node_dir, ".git")):
        raise RuntimeError(f"Не git-репозиторий: {node_dir}")

    # --- Текущее состояние ---
    current = {
        "branch": None, "tag": None,
        "commit": None, "commit_short": None,
        "dirty": False,
    }
    b = _git_lines(node_dir, "rev-parse", "--abbrev-ref", "HEAD")
    if b:
        current["branch"] = b[0]
    c = _git_lines(node_dir, "rev-parse", "HEAD")
    if c:
        current["commit"] = c[0]
        current["commit_short"] = c[0][:7]
    t = _git_lines(node_dir, "describe", "--tags", "--exact-match")
    if t:
        current["tag"] = t[0]
    current["dirty"] = bool(_git_lines(node_dir, "status", "--porcelain"))

    # --- Теги (только ref + дата, до max_tags) ---
    tags = []
    for line in _git_lines(
        node_dir,
        "for-each-ref", "--sort=-creatordate",
        "--format=%(refname:short)|%(creatordate:short)",
        "refs/tags",
    ):
        parts = line.split("|", 1)
        tags.append({
            "ref": parts[0],
            "date": parts[1] if len(parts) > 1 else "",
        })
        if len(tags) >= max_tags:
            break

    return {"current": current, "tags": tags}