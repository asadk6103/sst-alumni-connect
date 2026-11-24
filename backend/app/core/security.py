import hashlib
import hmac
import secrets as pysecrets
import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken

from . import secrets

ACCESS_TOKEN_MINUTES = 15
_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)  # OWASP-recommended argon2id baseline
# Verifying against this keeps login timing similar for unknown accounts.
_DUMMY_HASH = _hasher.hash("timing-equaliser")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(hash_: str | None, password: str) -> bool:
    try:
        return _hasher.verify(hash_ or _DUMMY_HASH, password) and hash_ is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(hash_: str) -> bool:
    return _hasher.check_needs_rehash(hash_)


def token_hash(value: str) -> str:
    """SHA-256 of a random token (tokens are high-entropy, so no salt is needed)."""
    return hashlib.sha256(value.encode()).hexdigest()


def random_token(nbytes: int = 32) -> str:
    return pysecrets.token_urlsafe(nbytes)


def random_code(digits: int = 6) -> str:
    return f"{pysecrets.randbelow(10**digits):0{digits}d}"


def code_hash(user_id: uuid.UUID, code: str) -> str:
    """Short numeric codes are hashed with a server key so a leaked table cannot be brute-forced offline."""
    key = secrets.get("jwt_signing_key").encode()
    return hmac.new(key, f"{user_id}:{code}".encode(), hashlib.sha256).hexdigest()


# ── access tokens ────────────────────────────────────────────────────────────
def create_access_token(user_id: uuid.UUID, session_id: uuid.UUID, minutes: int = ACCESS_TOKEN_MINUTES) -> str:
    now = datetime.now(UTC)
    payload = {"sub": str(user_id), "sid": str(session_id), "iat": now, "exp": now + timedelta(minutes=minutes),
               "typ": "access"}
    return jwt.encode(payload, secrets.get("jwt_signing_key"), algorithm="HS256")


def decode_access_token(token: str) -> dict | None:
    try:
        data = jwt.decode(token, secrets.get("jwt_signing_key"), algorithms=["HS256"],
                          options={"require": ["exp", "sub", "sid"]})
    except jwt.PyJWTError:
        return None
    return data if data.get("typ") == "access" else None


# ── two-factor authentication (TOTP) ────────────────────────────────────────
def new_totp_secret() -> str:
    return pyotp.random_base32()


def totp_uri(secret: str, account: str, issuer: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=account, issuer_name=issuer)


def verify_totp(secret: str, code: str) -> bool:
    return pyotp.TOTP(secret).verify((code or "").replace(" ", ""), valid_window=1)


# ── encryption at rest (integration credentials, TOTP secrets) ───────────────
def _fernet() -> Fernet:
    return Fernet(secrets.get("encryption_key").encode())


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken:
        return None
