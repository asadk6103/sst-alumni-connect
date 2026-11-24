"""Application secrets, generated on first start and kept in CONFIG_DIR/secrets.json (mode 600).

- jwt_signing_key: signs access tokens (rotating it signs everyone out)
- encryption_key:  Fernet key encrypting integration credentials at rest (SMTP, SMS, storage …)

No secret is ever read from source code. The setup code proves control of the server during the
first-run wizard and is deleted once installation completes.
"""

import base64
import hmac
import json
import os
import secrets
import string
from pathlib import Path
from threading import Lock

from .config import infra

_lock = Lock()
_cache: dict[str, str] | None = None
KEYS = ("jwt_signing_key", "encryption_key")


def _file() -> Path:
    return infra().config_dir / "secrets.json"


def _generate(name: str) -> str:
    if name == "encryption_key":
        return base64.urlsafe_b64encode(os.urandom(32)).decode()
    return secrets.token_urlsafe(48)


def _write(data: dict[str, str]) -> None:
    path = _file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    try:
        os.chmod(tmp, 0o600)
    except OSError:  # pragma: no cover - Windows
        pass
    os.replace(tmp, path)


def load() -> dict[str, str]:
    global _cache
    with _lock:
        if _cache is not None:
            return _cache
        path = _file()
        if not path.exists():
            # First start: create the file atomically so concurrently starting replicas agree on one set of keys.
            path.parent.mkdir(parents=True, exist_ok=True)
            fresh = {k: _generate(k) for k in KEYS}
            try:
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "w") as f:
                    f.write(json.dumps(fresh, indent=2))
            except FileExistsError:
                pass  # another process won the race
        data: dict[str, str] = {}
        for _ in range(20):  # the winner may still be writing
            try:
                data = json.loads(path.read_text() or "{}")
                break
            except json.JSONDecodeError:
                import time

                time.sleep(0.05)
        missing = [k for k in KEYS if not data.get(k)]
        if missing:  # keys introduced by an upgrade
            for k in missing:
                data[k] = _generate(k)
            _write(data)
        _cache = data
        return data


def get(name: str) -> str:
    return load()[name]


def rotate(name: str) -> None:
    global _cache
    data = dict(load())
    data[name] = _generate(name)
    with _lock:
        _write(data)
        _cache = data


# ── first-run setup code ────────────────────────────────────────────────────
def _setup_file() -> Path:
    return infra().config_dir / "setup-code.txt"


def ensure_setup_code() -> str:
    path = _setup_file()
    if path.exists():
        return path.read_text().strip()
    alphabet = string.ascii_uppercase.replace("O", "").replace("I", "") + "23456789"
    code = "-".join("".join(secrets.choice(alphabet) for _ in range(5)) for _ in range(2))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(code)
    try:
        os.chmod(path, 0o600)
    except OSError:  # pragma: no cover
        pass
    return code


def check_setup_code(code: str) -> bool:
    path = _setup_file()
    if not path.exists():
        return False
    return hmac.compare_digest(path.read_text().strip().upper(), (code or "").strip().upper())


def clear_setup_code() -> None:
    _setup_file().unlink(missing_ok=True)


def reset_cache() -> None:  # tests
    global _cache
    _cache = None
