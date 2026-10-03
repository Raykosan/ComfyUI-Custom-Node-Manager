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
import re
import sys
import stat
import shutil
import logging
import datetime
import subprocess
from typing import Callable, Optional

logger = logging.getLogger("CustomNodeManager.git")

ProgressCb = Callable[[str], None]

DEFAULT_GIT_TIMEOUT = 600.0
DEFAULT_PIP_TIMEOUT = 1800.0


def git_available() -> bool:
    return shutil.which("git") is not None


def run_git(
    cwd: Optional[str],
    *args: str,
    timeout: float = DEFAULT_GIT_TIMEOUT,
    env: Optional[dict] = None,
):
    cmd = ["git"]
    if cwd:
        cmd += ["-C", cwd]
    cmd += list(args)
    try:
        p = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=timeout, check=False,
            env=env,
        )
        return p.returncode, (p.stdout or "").strip(), (p.stderr or "").strip()
    except subprocess.TimeoutExpired:
        return -1, "", f"git timeout after {timeout}s"
    except FileNotFoundError:
        return -1, "", "git executable not found in PATH"
    except OSError as e:
        return -1, "", str(e)


def non_interactive_env() -> dict:
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GCM_INTERACTIVE"] = "Never"
    return env


def derive_folder_name(git_url: str) -> str:
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


def _find_default_branch(node_dir: str) -> Optional[str]:
    rc, out, _ = run_git(node_dir, "symbolic-ref", "refs/remotes/origin/HEAD")
    if rc == 0 and out:
        return out.strip().split("/")[-1]

    rc, out, _ = run_git(node_dir, "branch", "-r")
    if rc == 0:
        refs = {line.strip() for line in out.splitlines() if line.strip()}
        for candidate in ("main", "master", "develop"):
            if f"origin/{candidate}" in refs:
                return candidate

    return None


def pip_install(cwd: str, requirements_file: str, progress: ProgressCb) -> dict:
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


def install_node(
    git_url: str,
    target_dir: str,
    version: Optional[str] = None,
    progress: ProgressCb = lambda msg: None,
) -> dict:
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
            progress("pip install завершился с ошибкой — проверьте лог")
    else:
        progress("requirements.txt отсутствует — пропускаем pip")

    if os.path.isfile(os.path.join(target_dir, "install.py")):
        progress("Обнаружен install.py — запустите вручную при необходимости")

    return {
        "folder": os.path.basename(target_dir),
        "path": target_dir,
        "pip": pip_result,
    }


def _clear_skip_worktree(node_dir: str) -> None:
    rc, out, _ = run_git(node_dir, "ls-files", "-v")
    if rc != 0 or not out:
        return
    skipped = []
    for line in out.splitlines():
        if len(line) > 2 and line[0] in ("S", "s"):
            skipped.append(line[2:].strip())
    if skipped:
        run_git(node_dir, "update-index", "--no-skip-worktree", "--", *skipped)


def _apply_skip_worktree_if_phantom(node_dir: str) -> None:
    rc, out, _ = run_git(node_dir, "status", "--porcelain")
    if rc != 0 or not out.strip():
        return

    rc_diff, _, _ = run_git(node_dir, "diff", "--ignore-cr-at-eol", "--quiet")
    if rc_diff == 0:
        run_git(node_dir, "update-index", "--really-refresh", "-q")
        rc, out2, _ = run_git(node_dir, "status", "--porcelain")
        if rc == 0 and out2.strip():
            run_git(node_dir, "checkout", "-f", "HEAD", "--", ".")
            run_git(node_dir, "ls-files", "-z")
            rc_files, out_files, _ = run_git(node_dir, "ls-files")
            if rc_files == 0 and out_files:
                files = [f for f in out_files.splitlines() if f.strip()]
                if files:
                    run_git(
                        node_dir, "update-index", "--skip-worktree", "--", *files
                    )


def _ensure_clean_worktree(node_dir: str, progress: ProgressCb) -> None:
    rc, out, _ = run_git(node_dir, "status", "--porcelain")
    if rc != 0 or not out.strip():
        return

    rc_diff, _, _ = run_git(node_dir, "diff", "--ignore-cr-at-eol", "--quiet")
    if rc_diff != 0:
        raise RuntimeError(
            "Working tree has real unstaged changes after stash attempt. "
            "Please resolve manually (git status, git diff)."
        )

    progress("Phantom changes detected — refreshing index stat cache")
    run_git(node_dir, "update-index", "--really-refresh", "-q")

    rc, out2, _ = run_git(node_dir, "status", "--porcelain")
    if rc == 0 and out2.strip():
        progress("Forcing clean checkout of tracked files")
        run_git(node_dir, "checkout", "-f", "HEAD", "--", ".")

        rc, out3, _ = run_git(node_dir, "status", "--porcelain")
        if rc == 0 and out3.strip():
            progress("Applying skip-worktree to phantom-modified files")
            phantom_files = []
            for line in out3.splitlines():
                if len(line) > 3:
                    path = line[3:].strip()
                    if path:
                        phantom_files.append(path)
            if phantom_files:
                run_git(
                    node_dir, "update-index", "--skip-worktree", "--",
                    *phantom_files
                )


def update_node(
    node_dir: str,
    version: Optional[str] = None,
    progress: ProgressCb = lambda msg: None,
) -> dict:
    if not git_available():
        raise RuntimeError("git не найден в PATH")
    if not os.path.isdir(os.path.join(node_dir, ".git")):
        raise RuntimeError(f"Не git-репозиторий: {node_dir}")

    stashed = None
    rc, out, _ = run_git(node_dir, "status", "--porcelain")
    if rc == 0 and out.strip():
        ts = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        stash_msg = f"cnm-auto-{ts}"
        progress(f"Local changes detected → stashing as {stash_msg}")
        rc, out, err = run_git(node_dir, "stash", "push", "-u", "-m", stash_msg)
        if rc != 0:
            raise RuntimeError(f"git stash не удался: {err or out}")
        stashed = stash_msg

        _ensure_clean_worktree(node_dir, progress)

    progress("git fetch --tags --prune")
    rc, out, err = run_git(node_dir, "fetch", "--tags", "--prune")
    if rc != 0:
        raise RuntimeError(f"git fetch не удался: {err or out}")

    if version:
        progress(f"git checkout {version}")
        rc, out, err = run_git(node_dir, "checkout", version)
        if rc != 0:
            err_str = f"{err or ''} {out or ''}".lower()
            if "would be overwritten" in err_str or "local changes" in err_str:
                progress("Phantom conflict — clearing skip-worktree and forcing checkout")
                _clear_skip_worktree(node_dir)
                rc, out, err = run_git(node_dir, "checkout", "-f", version)
            if rc != 0:
                raise RuntimeError(f"git checkout {version} failed: {err or out}")
    else:
        rc, out, _ = run_git(node_dir, "symbolic-ref", "-q", "--short", "HEAD")
        current_branch = out.strip() if rc == 0 else None

        if not current_branch:
            progress("Detached HEAD detected — switching to default branch")
            default_branch = _find_default_branch(node_dir)
            if not default_branch:
                raise RuntimeError(
                    "Detached HEAD: не удалось определить default branch. "
                    "Укажите ветку явно через Switch Version."
                )

            progress(f"git checkout {default_branch}")
            rc, out, err = run_git(node_dir, "checkout", default_branch)

            if rc != 0:
                progress(f"git checkout -B {default_branch} origin/{default_branch}")
                rc, out, err = run_git(
                    node_dir, "checkout", "-B", default_branch,
                    f"origin/{default_branch}",
                )

            if rc != 0:
                err_str = f"{err or ''} {out or ''}".lower()
                if "would be overwritten" in err_str or "local changes" in err_str:
                    progress("Phantom conflict — clearing skip-worktree and forcing checkout")
                    _clear_skip_worktree(node_dir)
                    rc, out, err = run_git(
                        node_dir, "checkout", "-f", "-B", default_branch,
                        f"origin/{default_branch}",
                    )

            if rc != 0:
                raise RuntimeError(
                    f"git checkout {default_branch} failed: {err or out}"
                )
            current_branch = default_branch

        progress(f"git pull --ff-only (branch: {current_branch})")
        rc, out, err = run_git(node_dir, "pull", "--ff-only")
        if rc != 0:
            err_str = f"{err or ''} {out or ''}".lower()
            if "would be overwritten" in err_str or "local changes" in err_str:
                progress("Phantom conflict on pull — clearing skip-worktree and forcing reset")
                _clear_skip_worktree(node_dir)
                rc, out, err = run_git(
                    node_dir, "reset", "--hard", f"origin/{current_branch}"
                )
            if rc != 0:
                raise RuntimeError(f"git pull failed: {err or out}")

    pip_result = None
    req = os.path.join(node_dir, "requirements.txt")
    if os.path.isfile(req):
        pip_result = pip_install(node_dir, req, progress)
        if pip_result.get("rc", -1) != 0:
            progress("pip install завершился с ошибкой — проверьте лог")

    if stashed:
        progress(f"Local changes saved as {stashed}")
        progress(f"   restore with: git -C \"{node_dir}\" stash pop")

    try:
        _apply_skip_worktree_if_phantom(node_dir)
    except Exception:
        logger.exception("phantom cleanup failed")

    return {"pip": pip_result, "stashed": stashed}

    return {"pip": pip_result, "stashed": stashed}


def _rmtree_onerror(func, path, exc_info):
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except Exception:
        pass


def remove_node(node_dir: str, custom_nodes_roots: list) -> None:
    real = os.path.realpath(node_dir)

    for root in custom_nodes_roots:
        if real == os.path.realpath(root):
            raise RuntimeError("Отказ: попытка удалить корень custom_nodes")

    if not any(_is_within(root, real) for root in custom_nodes_roots):
        raise RuntimeError(f"Отказ: {real} вне custom_nodes")

    if not os.path.isdir(real):
        raise RuntimeError(f"Не папка: {real}")

    shutil.rmtree(real, onerror=_rmtree_onerror)


def _git_lines(node_dir: str, *args: str, timeout: float = 10.0) -> list:
    rc, out, _ = run_git(node_dir, *args, timeout=timeout)
    if rc != 0:
        return []
    return [ln for ln in out.splitlines() if ln.strip()]


def list_versions(node_dir: str, max_tags: int = 15) -> dict:
    if not os.path.isdir(os.path.join(node_dir, ".git")):
        raise RuntimeError(f"Не git-репозиторий: {node_dir}")

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


_STASH_REF_RE = re.compile(r"^stash@\{\d+\}$")


def list_stashes(node_dir: str) -> list:
    if not os.path.isdir(os.path.join(node_dir, ".git")):
        raise RuntimeError(f"Не git-репозиторий: {node_dir}")

    stashes = []
    for line in _git_lines(node_dir, "stash", "list", "--format=%gd|%ci|%gs"):
        parts = line.split("|", 2)
        if len(parts) < 3:
            continue
        ref = parts[0]
        date = parts[1][:19]
        message = parts[2]

        files = []
        for fline in _git_lines(node_dir, "stash", "show", "--name-status", "-u", ref):
            cols = fline.split("\t")
            if len(cols) >= 2:
                status = (cols[0].strip() or "?")[:1].upper()
                path = cols[-1].strip()
                files.append({"status": status, "path": path})

        files_changed = 0
        insertions = 0
        deletions = 0
        shortstat = _git_lines(node_dir, "stash", "show", "--shortstat", "-u", ref)
        if shortstat:
            s = shortstat[0]
            m = re.search(r"(\d+)\s+files?\s+changed", s)
            if m:
                files_changed = int(m.group(1))
            m = re.search(r"(\d+)\s+insertions?\(\+\)", s)
            if m:
                insertions = int(m.group(1))
            m = re.search(r"(\d+)\s+deletions?\(-\)", s)
            if m:
                deletions = int(m.group(1))

        if not files_changed:
            files_changed = len(files)

        base = {"commit_short": None, "subject": None, "tag": None}
        base_line = _git_lines(node_dir, "log", "-1", "--format=%h|%s", f"{ref}^")
        if base_line:
            bparts = base_line[0].split("|", 1)
            base["commit_short"] = bparts[0]
            base["subject"] = bparts[1] if len(bparts) > 1 else ""
        tag_line = _git_lines(node_dir, "describe", "--tags", "--exact-match", f"{ref}^")
        if tag_line:
            base["tag"] = tag_line[0]

        stashes.append({
            "ref": ref,
            "date": date,
            "message": message,
            "files": files,
            "files_changed": files_changed,
            "insertions": insertions,
            "deletions": deletions,
            "base": base,
        })
    return stashes


def pop_stash(node_dir: str, ref: str) -> dict:
    if not os.path.isdir(os.path.join(node_dir, ".git")):
        raise RuntimeError(f"Не git-репозиторий: {node_dir}")
    if not _STASH_REF_RE.match(ref or ""):
        raise RuntimeError(f"Неверный ref: {ref}")

    rc, out, err = run_git(node_dir, "stash", "pop", ref)
    if rc != 0:
        raise RuntimeError(f"git stash pop не удался: {err or out}")
    return {"output": out}


def drop_stash(node_dir: str, ref: str) -> dict:
    if not os.path.isdir(os.path.join(node_dir, ".git")):
        raise RuntimeError(f"Не git-репозиторий: {node_dir}")
    if not _STASH_REF_RE.match(ref or ""):
        raise RuntimeError(f"Неверный ref: {ref}")

    rc, out, err = run_git(node_dir, "stash", "drop", ref)
    if rc != 0:
        raise RuntimeError(f"git stash drop не удался: {err or out}")
    return {"output": out}


def attach_git_remote(
    node_dir: str,
    git_url: str,
    progress: ProgressCb = lambda msg: None,
) -> dict:
    if not git_available():
        raise RuntimeError("git не найден в PATH")
    if not os.path.isdir(node_dir):
        raise RuntimeError(f"Не папка: {node_dir}")
    if not git_url or not re.match(r"^(https?://|git@)", git_url):
        raise RuntimeError(f"Некорректный git URL: {git_url}")

    git_dir = os.path.join(node_dir, ".git")
    initialized = False

    if not os.path.isdir(git_dir):
        progress("git init")
        rc, out, err = run_git(node_dir, "init", "-q")
        if rc != 0:
            raise RuntimeError(f"git init не удался: {err or out}")
        initialized = True

    rc, out, _ = run_git(node_dir, "remote", "get-url", "origin")
    if rc == 0:
        progress("git remote set-url origin")
        rc, out, err = run_git(node_dir, "remote", "set-url", "origin", git_url)
    else:
        progress("git remote add origin")
        rc, out, err = run_git(node_dir, "remote", "add", "origin", git_url)
    if rc != 0:
        raise RuntimeError(f"git remote не удался: {err or out}")

    progress("git fetch origin")
    rc, out, err = run_git(node_dir, "fetch", "origin", "--tags", "--prune")
    if rc != 0:
        raise RuntimeError(f"git fetch не удался: {err or out}")

    run_git(node_dir, "remote", "set-head", "origin", "-a")
    rc, out, _ = run_git(node_dir, "symbolic-ref", "refs/remotes/origin/HEAD")
    default_branch = None
    if rc == 0 and out:
        default_branch = out.strip().split("/")[-1]

    if not default_branch:
        rc, out, _ = run_git(node_dir, "ls-remote", "--symref", "origin", "HEAD")
        m = re.search(r"ref:\s+refs/heads/(\S+)\s+HEAD", out or "")
        if m:
            default_branch = m.group(1)

    if not default_branch:
        raise RuntimeError("Не удалось определить default branch на origin")

    progress(f"git reset --soft origin/{default_branch}")
    rc, out, err = run_git(node_dir, "reset", "--soft", f"origin/{default_branch}")
    if rc != 0:
        raise RuntimeError(f"git reset не удался: {err or out}")

    run_git(node_dir, "branch", "-M", default_branch)
    run_git(node_dir, "branch", "--set-upstream-to", f"origin/{default_branch}")

    rc, out, _ = run_git(node_dir, "status", "--porcelain")
    diff_count = len([l for l in (out or "").splitlines() if l.strip()])

    return {
        "initialized": initialized,
        "branch": default_branch,
        "git_url": git_url,
        "changed_files": diff_count,
    }


def preview_update(node_dir: str) -> dict:
    if not git_available():
        raise RuntimeError("git не найден в PATH")
    if not os.path.isdir(os.path.join(node_dir, ".git")):
        raise RuntimeError(f"Не git-репозиторий: {node_dir}")

    rc, out, _ = run_git(node_dir, "symbolic-ref", "-q", "--short", "HEAD")
    branch = out.strip() if rc == 0 and out else None

    if not branch:
        branch = _find_default_branch(node_dir)
        if not branch:
            raise RuntimeError("Detached HEAD и не удалось определить ветку")

    rc, out, err = run_git(node_dir, "fetch", "origin", "--tags", "--prune")
    if rc != 0:
        raise RuntimeError(f"git fetch не удался: {err or out}")

    remote_ref = f"origin/{branch}"

    rc, out, _ = run_git(node_dir, "rev-parse", "--verify", remote_ref)
    if rc != 0:
        raise RuntimeError(f"Удалённая ветка не найдена: {remote_ref}")

    commits = []
    rc, out, _ = run_git(
        node_dir, "log", f"HEAD..{remote_ref}",
        "--format=%h|%s", "--max-count=21"
    )
    if rc == 0 and out:
        for line in out.splitlines():
            parts = line.split("|", 1)
            if len(parts) == 2:
                commits.append({"sha": parts[0], "subject": parts[1]})

    more_commits = 0
    if len(commits) > 20:
        more_commits = len(commits) - 20
        commits = commits[:20]

    files_changed = 0
    insertions = 0
    deletions = 0
    rc, out, _ = run_git(node_dir, "diff", "--shortstat", f"HEAD..{remote_ref}")
    if rc == 0 and out:
        m = re.search(r"(\d+)\s+files?\s+changed", out)
        if m:
            files_changed = int(m.group(1))
        m = re.search(r"(\d+)\s+insertions?", out)
        if m:
            insertions = int(m.group(1))
        m = re.search(r"(\d+)\s+deletions?", out)
        if m:
            deletions = int(m.group(1))

    files = []
    rc, out, _ = run_git(node_dir, "diff", "--numstat", f"HEAD..{remote_ref}")
    if rc == 0 and out:
        raw = []
        for line in out.splitlines():
            parts = line.split("\t")
            if len(parts) == 3:
                ins_s, del_s, path = parts
                try:
                    ins = int(ins_s) if ins_s != "-" else 0
                    dels = int(del_s) if del_s != "-" else 0
                except ValueError:
                    continue
                raw.append({
                    "path": path,
                    "insertions": ins,
                    "deletions": dels,
                    "total": ins + dels,
                })
        raw.sort(key=lambda f: f["total"], reverse=True)
        files = raw[:5]

    rc, out, _ = run_git(node_dir, "status", "--porcelain")
    is_dirty = rc == 0 and bool(out.strip())

    return {
        "branch": branch,
        "commits": commits,
        "more_commits": more_commits,
        "total_commits": len(commits) + more_commits,
        "files_changed": files_changed,
        "insertions": insertions,
        "deletions": deletions,
        "files": files,
        "dirty": is_dirty,
    }