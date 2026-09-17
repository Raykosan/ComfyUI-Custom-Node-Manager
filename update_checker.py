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
import logging
import concurrent.futures

try:
    from . import git_ops
except ImportError:
    import git_ops

logger = logging.getLogger("CustomNodeManager.updates")

MAX_WORKERS = 6
LS_REMOTE_TIMEOUT = 20.0


def _parse_ls_remote(output: str) -> dict:
    refs = {}
    for line in (output or "").splitlines():
        parts = line.split("\t", 1)
        if len(parts) != 2:
            continue
        sha, ref = parts[0].strip(), parts[1].strip()
        refs[ref] = sha
    return refs


def check_single_node(node: dict) -> dict:
    folder = node.get("folder") or "?"
    node_dir = node.get("path")
    git_url = node.get("git_url")
    branch = node.get("branch")
    local_commit = node.get("commit")

    result = {
        "folder": folder,
        "has_update": False,
        "remote_commit": None,
        "remote_commit_short": None,
        "local_commit": local_commit,
        "branch": branch,
        "error": None,
    }

    if not git_url or not node_dir or not os.path.isdir(node_dir):
        result["error"] = "no git"
        return result

    rc, out, err = git_ops.run_git(
        node_dir, "ls-remote", "origin",
        timeout=LS_REMOTE_TIMEOUT,
    )
    if rc != 0:
        result["error"] = (err or "ls-remote failed").strip()[:200]
        return result

    refs = _parse_ls_remote(out)

    remote_sha = None
    if branch and branch != "HEAD":
        remote_sha = refs.get(f"refs/heads/{branch}")

    if not remote_sha:
        remote_sha = refs.get("HEAD")

    if not remote_sha:
        result["error"] = "remote ref not found"
        return result

    result["remote_commit"] = remote_sha
    result["remote_commit_short"] = remote_sha[:7]
    result["has_update"] = (remote_sha != local_commit)

    return result


def check_all_nodes(nodes: list, progress_cb=None) -> dict:
    results = {}
    total = len(nodes)
    done = 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(check_single_node, n): n for n in nodes}
        for fut in concurrent.futures.as_completed(futures):
            node = futures[fut]
            folder = node.get("folder") or "?"
            done += 1
            try:
                results[folder] = fut.result()
            except Exception as e:
                logger.exception(f"check_single_node({folder}) упал")
                results[folder] = {
                    "folder": folder,
                    "has_update": False,
                    "error": str(e)[:200],
                }
            if progress_cb:
                try:
                    progress_cb(done, total)
                except Exception:
                    pass

    return {"results": results, "total": total, "checked": done}