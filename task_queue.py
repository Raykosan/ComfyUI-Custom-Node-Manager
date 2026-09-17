"""
Асинхронная очередь задач для Custom Node Manager.
Долгие операции (clone, pip install) уходят в executor, event loop не блокируется.
"""

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
    kind: str                    # install | update | remove
    payload: dict
    status: str = "pending"      # pending | running | done | error
    progress: str = ""
    log: list = field(default_factory=list)
    error: Optional[str] = None
    result: Optional[dict] = None
    created: str = ""
    finished: Optional[str] = None


TASKS: dict[str, Task] = {}
_queue: "asyncio.Queue[Task]" = asyncio.Queue()
_worker: Optional[asyncio.Task] = None


def _now() -> str:
    return datetime.datetime.now().isoformat(timespec="seconds")


def _trim_tasks() -> None:
    """Не даём словарю расти бесконечно."""
    if len(TASKS) <= MAX_TASKS_KEPT:
        return
    done = [t for t in TASKS.values() if t.status in ("done", "error")]
    done.sort(key=lambda t: t.finished or t.created)
    for old in done[: len(TASKS) - MAX_TASKS_KEPT]:
        TASKS.pop(old.id, None)


def submit(kind: str, payload: dict) -> Task:
    """Создаёт задачу и ставит в очередь. Должна вызываться из работающего event loop."""
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
    # Импорт внутри — чтобы не тянуть git_ops до старта
    try:
        from . import git_ops as _git_ops
    except ImportError:
        import git_ops as _git_ops  # type: ignore

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

        else:
            raise RuntimeError(f"Неизвестный тип задачи: {task.kind}")

        task.status = "done"
        cb("✅ Готово")
    except Exception as e:
        logger.exception(f"[task {task.id}] ошибка")
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
    """Ленивый старт воркера. Вызывать из контекста работающего loop."""
    global _worker
    if _worker is None or _worker.done():
        _worker = asyncio.create_task(_worker_loop())