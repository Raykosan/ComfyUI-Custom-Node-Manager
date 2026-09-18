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

import asyncio
import uuid
import logging
import datetime
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger("CustomNodeManager.tasks")

MAX_TASKS_KEPT = 100


@dataclass
class Task:
    id: str
    kind: str
    payload: dict
    status: str = "pending"
    progress: str = ""
    log: list = field(default_factory=list)
    error: Optional[str] = None
    result: Optional[dict] = None
    created: str = ""
    finished: Optional[str] = None

_post_success_hook = None


def set_post_success_hook(hook):
    global _post_success_hook
    _post_success_hook = hook

TASKS: dict[str, Task] = {}
_queue: "asyncio.Queue[Task]" = asyncio.Queue()
_worker: Optional[asyncio.Task] = None


def _now() -> str:
    return datetime.datetime.now().isoformat(timespec="seconds")


def _trim_tasks() -> None:
    if len(TASKS) <= MAX_TASKS_KEPT:
        return
    done = [t for t in TASKS.values() if t.status in ("done", "error")]
    done.sort(key=lambda t: t.finished or t.created)
    for old in done[: len(TASKS) - MAX_TASKS_KEPT]:
        TASKS.pop(old.id, None)


def submit(kind: str, payload: dict) -> Task:
    ensure_worker()
    task = Task(id=uuid.uuid4().hex[:12], kind=kind, payload=payload, created=_now())
    TASKS[task.id] = task
    _queue.put_nowait(task)
    _trim_tasks()
    logger.info(f"[task {task.id}] queued: {kind} {payload.get('folder') or payload.get('git_url', '')}")
    return task


def _progress_cb(task: Task):
    def cb(msg: str):
        task.progress = msg
        task.log.append(f"{_now()} {msg}")
        if len(task.log) > 300:
            task.log = task.log[-300:]
        logger.info(f"[task {task.id}] {msg}")
    return cb


async def _run_task(task: Task) -> None:
    try:
        from . import git_ops as _git_ops
    except ImportError:
        import git_ops as _git_ops

    loop = asyncio.get_running_loop()
    cb = _progress_cb(task)

    try:
        if task.kind == "install":
            p = task.payload
            result = await loop.run_in_executor(
                None,
                lambda: _git_ops.install_node(p["git_url"], p["target_dir"], p.get("version"), cb),
            )
            task.result = result

        elif task.kind == "update":
            p = task.payload
            result = await loop.run_in_executor(
                None,
                lambda: _git_ops.update_node(p["node_dir"], p.get("version"), cb),
            )
            task.result = result

        elif task.kind == "remove":
            p = task.payload
            await loop.run_in_executor(
                None,
                _git_ops.remove_node, p["node_dir"], p["roots"],
            )

        elif task.kind == "batch_update":
            p = task.payload
            items = p.get("items") or []
            total = len(items)
            results = []
            for i, item in enumerate(items, 1):
                folder = item.get("folder", "?")
                node_dir = item.get("node_dir")
                try:
                    cb(f"[{i}/{total}] {folder}: starting")
                    result = await loop.run_in_executor(
                        None,
                        lambda nd=node_dir: _git_ops.update_node(nd, None, cb),
                    )
                    results.append({"folder": folder, "ok": True, "result": result})
                    cb(f"[{i}/{total}] {folder}: ✅ done")
                except Exception as e:
                    logger.exception(f"batch_update: {folder} failed")
                    results.append({"folder": folder, "ok": False, "error": str(e)})
                    cb(f"[{i}/{total}] {folder}: ❌ {e}")

            succeeded = sum(1 for r in results if r["ok"])
            failed = total - succeeded
            task.result = {
                "total": total,
                "succeeded": succeeded,
                "failed": failed,
                "results": results,
            }
            cb(f"✅ Batch done: {succeeded}/{total} succeeded"
               + (f", {failed} failed" if failed else ""))

        else:
            raise RuntimeError(f"Unknown task type: {task.kind}")

        task.status = "done"
        cb("✅ Done")

        if _post_success_hook:
            try:
                _post_success_hook(task)
            except Exception:
                logger.exception(f"[task {task.id}] post-success hook error")
    except Exception as e:
        logger.exception(f"[task {task.id}] error")
        task.status = "error"
        task.error = str(e)
        task.log.append(f"{_now()} ❌ {e}")
    finally:
        task.finished = _now()


async def _worker_loop():
    logger.info("Task worker started")
    while True:
        task = await _queue.get()
        task.status = "running"
        try:
            await _run_task(task)
        finally:
            _queue.task_done()


def ensure_worker() -> None:
    global _worker
    if _worker is None or _worker.done():
        _worker = asyncio.create_task(_worker_loop())