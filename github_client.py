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
import time
import json
import logging
import requests

logger = logging.getLogger("CustomNodeManager.github")

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(CURRENT_DIR, "github_cache.json")

CACHE_TTL = 3600
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
            logger.warning(f"Couldn't save github_cache.json: {e}")

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
            logger.warning(f"GitHub rate limit is low ({remaining}), pause {wait}s")
            time.sleep(wait)

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
            logger.warning("GitHub API rate limit has been reached")
            return None

        if not resp.ok:
            self.last_error = f"http {resp.status_code}"
            logger.warning(f"GitHub API {resp.status_code} for {url}")
            return None

        try:
            return resp.json()
        except ValueError:
            self.last_error = "invalid json"
            return None

    def get_tags(self, owner: str, repo: str, per_page: int = 100):
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

    @staticmethod
    def parse_git_url(git_url: str):
        if not git_url:
            return None
        m = re.match(r"^https?://github\.com/([^/]+)/([^/]+?)(?:\.git)?/?$", git_url)
        if m:
            return m.group(1), m.group(2)
        m = re.match(r"^git@github\.com:([^/]+)/([^/]+?)(?:\.git)?$", git_url)
        if m:
            return m.group(1), m.group(2)
        return None


def read_token_from_comfy_settings() -> str:
    candidates = []

    try:
        import folder_paths
        user_dir = folder_paths.get_user_directory()
        if user_dir and os.path.isdir(user_dir):
            candidates.append(user_dir)
    except Exception:
        pass

    env_dir = os.environ.get("COMFYUI_USER_DIRECTORY")
    if env_dir and os.path.isdir(env_dir):
        candidates.append(env_dir)

    here = os.path.dirname(os.path.abspath(__file__))
    comfy_root = os.path.dirname(os.path.dirname(here))
    rel_user_dir = os.path.join(comfy_root, "user")
    if os.path.isdir(rel_user_dir):
        candidates.append(rel_user_dir)

    seen = set()
    for user_dir in candidates:
        user_dir = os.path.realpath(user_dir)
        if user_dir in seen:
            continue
        seen.add(user_dir)

        for rel in ("default/comfy.settings.json", "comfy.settings.json"):
            path = os.path.join(user_dir, rel)
            if not os.path.isfile(path):
                continue
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                tok = data.get("CustomNodeManager.GitHubToken") or ""
                if isinstance(tok, str) and tok.strip():
                    return tok.strip()
            except Exception:
                continue

    return ""


def resolve_token() -> str:
    env = (os.environ.get("GITHUB_TOKEN") or "").strip()
    if env:
        return env
    return read_token_from_comfy_settings()