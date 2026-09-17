"""
GitHub API клиент для Custom Node Manager.
Используется ТОЛЬКО для получения точного списка тегов,
которых может не быть в локальном .git.

Не трогает api.comfy.org и не показывает никакие флаги Registry.
"""

import os
import re
import time
import json
import logging
import requests

logger = logging.getLogger("CustomNodeManager.github")

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(CURRENT_DIR, "github_cache.json")

CACHE_TTL = 3600          # 1 час
MAX_TAGS_RETURN = 15
REQUEST_TIMEOUT = 15.0
MIN_RATE_BEFORE_PAUSE = 3


class GitHubClient:
    def __init__(self, token: str = ""):
        self.session = requests.Session()
        self.session.headers.update({
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "ComfyUI-Custom-Node-Manager",
        })
        if token:
            self.session.headers["Authorization"] = f"Bearer {token}"
            self.has_token = True
        else:
            self.has_token = False

        self.rate_limit_remaining = None
        self.rate_limit_reset = None
        self.last_error = None
        self._cache = self._load_cache()

    # --- cache ----------------------------------------------------------

    def _load_cache(self) -> dict:
        if not os.path.isfile(CACHE_FILE):
            return {}
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _save_cache(self) -> None:
        try:
            with open(CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(self._cache, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.warning(f"Не удалось сохранить github_cache.json: {e}")

    def _cache_get(self, key: str):
        entry = self._cache.get(key)
        if not entry:
            return None
        if time.time() - entry.get("ts", 0) > CACHE_TTL:
            return None
        return entry.get("data")

    def _cache_set(self, key: str, data) -> None:
        self._cache[key] = {"ts": time.time(), "data": data}
        self._save_cache()

    # --- rate limit -----------------------------------------------------

    def _update_rate(self, resp) -> None:
        self.rate_limit_remaining = resp.headers.get("X-RateLimit-Remaining")
        self.rate_limit_reset = resp.headers.get("X-RateLimit-Reset")

    def _maybe_pause_for_rate(self) -> None:
        if not self.rate_limit_remaining:
            return
        try:
            remaining = int(self.rate_limit_remaining)
        except (ValueError, TypeError):
            return
        if remaining >= MIN_RATE_BEFORE_PAUSE:
            return
        try:
            reset_ts = int(self.rate_limit_reset or 0)
        except (ValueError, TypeError):
            reset_ts = 0
        wait = max(0, reset_ts - int(time.time())) + 1
        if wait > 0:
            wait = min(wait, 30)
            logger.warning(f"GitHub rate limit низкий ({remaining}), пауза {wait}s")
            time.sleep(wait)

    # --- HTTP -----------------------------------------------------------

    def _get(self, url: str):
        self._maybe_pause_for_rate()
        try:
            resp = self.session.get(url, timeout=REQUEST_TIMEOUT)
        except requests.RequestException as e:
            self.last_error = f"network: {e}"
            logger.warning(f"GitHub request failed: {e}")
            return None

        self._update_rate(resp)

        if resp.status_code == 404:
            self.last_error = "not found"
            return None

        if resp.status_code == 403 and "rate limit" in resp.text.lower():
            self.last_error = "rate limit exceeded"
            logger.warning("GitHub API rate limit достигнут")
            return None

        if not resp.ok:
            self.last_error = f"http {resp.status_code}"
            logger.warning(f"GitHub API {resp.status_code} для {url}")
            return None

        try:
            return resp.json()
        except ValueError:
            self.last_error = "invalid json"
            return None

    # --- API ------------------------------------------------------------

    def get_tags(self, owner: str, repo: str, per_page: int = 100):
        """Возвращает список тегов (свежие от GitHub — по дате коммита, desc)."""
        cache_key = f"{owner}/{repo}/tags"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        url = (
            f"https://api.github.com/repos/{owner}/{repo}/tags"
            f"?per_page={per_page}"
        )
        data = self._get(url)
        if data is None:
            return None

        self._cache_set(cache_key, data)
        return data

    # --- helpers --------------------------------------------------------

    @staticmethod
    def parse_git_url(git_url: str):
        """https://github.com/owner/repo(.git) или git@github.com:owner/repo(.git)."""
        if not git_url:
            return None
        m = re.match(r"^https?://github\.com/([^/]+)/([^/]+?)(?:\.git)?/?$", git_url)
        if m:
            return m.group(1), m.group(2)
        m = re.match(r"^git@github\.com:([^/]+)/([^/]+?)(?:\.git)?$", git_url)
        if m:
            return m.group(1), m.group(2)
        return None


# --- Токен из настроек ComfyUI ------------------------------------------

def read_token_from_comfy_settings() -> str:
    """
    Пытается прочитать CustomNodeManager.GitHubToken из comfy.settings.json.
    Возвращает пустую строку, если не нашёл.
    """
    try:
        import folder_paths  # type: ignore
        user_dir = folder_paths.get_user_directory()
    except Exception:
        user_dir = None

    candidates = []
    if user_dir:
        candidates.append(os.path.join(user_dir, "default", "comfy.settings.json"))
        candidates.append(os.path.join(user_dir, "comfy.settings.json"))

    # Резервные пути
    here = os.path.dirname(os.path.abspath(__file__))
    comfy_root = os.path.dirname(os.path.dirname(here))
    candidates.append(os.path.join(comfy_root, "user", "default", "comfy.settings.json"))
    candidates.append(os.path.join(comfy_root, "user", "comfy.settings.json"))

    for path in candidates:
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            tok = data.get("CustomNodeManager.GitHubToken") or ""
            if isinstance(tok, str):
                return tok.strip()
        except Exception:
            continue
    return ""


def resolve_token() -> str:
    """Приоритет: переменная окружения → настройки ComfyUI."""
    env = (os.environ.get("GITHUB_TOKEN") or "").strip()
    if env:
        return env
    return read_token_from_comfy_settings()