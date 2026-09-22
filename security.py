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
import ipaddress
import secrets
import logging
from urllib.parse import urlparse
from functools import wraps

from aiohttp import web

logger = logging.getLogger("CustomNodeManager.security")

_SESSION_TOKEN = secrets.token_urlsafe(32)


def get_session_token() -> str:
    return _SESSION_TOKEN


DEFAULT_ALLOWED_GIT_HOSTS = {
    "github.com",
    "gitlab.com",
    "bitbucket.org",
    "codeberg.org",
    "gitea.com",
}


def _allowed_git_hosts() -> set:
    env = os.environ.get("CNM_ALLOWED_GIT_HOSTS", "").strip()
    if env:
        return {h.strip().lower() for h in env.split(",") if h.strip()}
    return DEFAULT_ALLOWED_GIT_HOSTS


def validate_git_url(url: str) -> tuple:
    if not url or not isinstance(url, str):
        return False, "empty url"

    host = ""

    if url.startswith("git@"):
        rest = url[4:]
        if ":" not in rest and "/" not in rest:
            return False, "malformed ssh url"
        host = rest.split(":", 1)[0].split("/", 1)[0]
    elif url.startswith("ssh://"):
        parsed = urlparse(url)
        host = parsed.hostname or ""
    else:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False, f"unsupported scheme: {parsed.scheme}"
        host = parsed.hostname or ""

    host = host.strip().lower()
    if not host:
        return False, "no host in url"

    allowed = _allowed_git_hosts()
    if host not in allowed:
        return False, (
            f"host '{host}' not in allow-list "
            f"({', '.join(sorted(allowed))}). "
            f"Override with CNM_ALLOWED_GIT_HOSTS env var."
        )

    return True, ""


def is_local_request(request) -> bool:
    remote = (request.remote or "").strip()
    if not remote:
        return False
    try:
        ip = ipaddress.ip_address(remote)
        return ip.is_loopback
    except ValueError:
        return False


def _forbidden(msg: str = "forbidden"):
    return web.json_response({"error": msg}, status=403)


def local_only(handler):
    @wraps(handler)
    async def wrapper(request):
        if not is_local_request(request):
            logger.warning(
                f"Blocked non-local request: {request.method} {request.path} "
                f"from {request.remote}"
            )
            return _forbidden("local requests only")
        return await handler(request)
    return wrapper


def local_and_token(handler):
    @wraps(handler)
    async def wrapper(request):
        if not is_local_request(request):
            logger.warning(
                f"Blocked non-local request: {request.method} {request.path} "
                f"from {request.remote}"
            )
            return _forbidden("local requests only")

        token = request.headers.get("X-CNM-Token", "")
        if not secrets.compare_digest(token, _SESSION_TOKEN):
            logger.warning(
                f"Blocked request with invalid token: {request.method} {request.path}"
            )
            return _forbidden("invalid session token")

        return await handler(request)
    return wrapper