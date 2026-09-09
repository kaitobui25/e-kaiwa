from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from threading import Lock
from urllib.parse import urlparse

APP_MODES = frozenset({"dev", "public"})


def normalize_app_mode(value: object) -> str:
    mode = str(value or "dev").strip().lower()
    if mode not in APP_MODES:
        raise ValueError(f"invalid app mode: {mode}")
    return mode


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_seconds: float):
        self.limit = max(1, int(limit))
        self.window_seconds = max(1.0, float(window_seconds))
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str, now: float | None = None) -> bool:
        current = time.monotonic() if now is None else float(now)
        cutoff = current - self.window_seconds
        with self._lock:
            events = self._events[key]
            while events and events[0] <= cutoff:
                events.popleft()
            if len(events) >= self.limit:
                return False
            events.append(current)
            return True


@dataclass
class AccessPolicy:
    mode: str = "dev"
    allowed_origins: frozenset[str] = field(default_factory=frozenset)
    trust_proxy: bool = False
    session_limiter: SlidingWindowLimiter = field(default_factory=lambda: SlidingWindowLimiter(12, 600))
    coach_limiter: SlidingWindowLimiter = field(default_factory=lambda: SlidingWindowLimiter(90, 60))
    metric_limiter: SlidingWindowLimiter = field(default_factory=lambda: SlidingWindowLimiter(180, 60))

    @classmethod
    def from_environment(cls, mode: str) -> "AccessPolicy":
        normalized = normalize_app_mode(mode)
        origins = frozenset(
            item.strip().rstrip("/")
            for item in os.environ.get("E_KAIWA_ALLOWED_ORIGINS", "").split(",")
            if item.strip()
        )
        trust_proxy = os.environ.get("E_KAIWA_TRUST_PROXY", "").strip().lower() in {"1", "true", "yes"}
        return cls(mode=normalized, allowed_origins=origins, trust_proxy=trust_proxy)

    @property
    def is_public(self) -> bool:
        return self.mode == "public"

    def client_ip(self, headers, socket_ip: str) -> str:
        if self.trust_proxy:
            forwarded = str(headers.get("X-Forwarded-For", "")).split(",", 1)[0].strip()
            if forwarded:
                return forwarded[:80]
        return str(socket_ip or "unknown")[:80]

    def origin_allowed(self, headers) -> bool:
        if not self.is_public:
            return True
        origin = str(headers.get("Origin", "")).strip().rstrip("/")
        if not origin:
            fetch_site = str(headers.get("Sec-Fetch-Site", "")).strip().lower()
            return fetch_site in {"", "same-origin", "same-site", "none"}
        if self.allowed_origins:
            return origin in self.allowed_origins
        host = str(headers.get("Host", "")).strip().lower()
        parsed = urlparse(origin)
        return bool(parsed.netloc and parsed.netloc.lower() == host)

    def allow(self, endpoint: str, client_key: str) -> bool:
        if not self.is_public:
            return True
        limiter = {
            "session": self.session_limiter,
            "coach": self.coach_limiter,
            "metric": self.metric_limiter,
        }.get(endpoint)
        return True if limiter is None else limiter.allow(client_key)
