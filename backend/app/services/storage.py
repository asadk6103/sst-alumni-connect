"""File storage: local disk or S3-compatible (bundled MinIO, AWS S3, other S3 providers).

Public objects get a public URL; private objects (CVs, receipts …) are only streamed through the
API after a permission check.
"""

import asyncio
import io
import json
import mimetypes
from dataclasses import dataclass
from pathlib import Path

from minio import Minio
from minio.error import S3Error
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import infra
from . import integrations


class StorageError(Exception):
    pass


@dataclass
class Stored:
    storage: str
    key: str


class LocalStorage:
    name = "local"

    def __init__(self, root: Path):
        self.root = root

    def _path(self, key: str, private: bool) -> Path:
        base = (self.root / ("private" if private else "public")).resolve()
        p = (base / key).resolve()
        if base not in p.parents:
            raise StorageError("Invalid storage key.")
        return p

    async def put(self, key: str, data: bytes, content_type: str, private: bool = False) -> Stored:
        p = self._path(key, private)

        def write():
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)

        await asyncio.to_thread(write)
        return Stored("local", key)

    async def get(self, key: str, private: bool = False) -> bytes:
        return await asyncio.to_thread(self._path(key, private).read_bytes)

    async def delete(self, key: str, private: bool = False) -> None:
        await asyncio.to_thread(lambda: self._path(key, private).unlink(missing_ok=True))

    def url(self, key: str) -> str:
        return f"/media/{key}"

    async def check(self) -> str:
        def probe():
            d = self.root / "public"
            d.mkdir(parents=True, exist_ok=True)
            t = d / ".write-test"
            t.write_text("ok")
            t.unlink()

        await asyncio.to_thread(probe)
        return f"Local storage is writable ({self.root})."


class S3Storage:
    name = "s3"

    def __init__(self, cfg: dict, secrets: dict):
        if not cfg.get("bucket"):
            raise StorageError("A bucket name is required.")
        endpoint = cfg.get("endpoint") or (f"s3.{cfg['region']}.amazonaws.com" if cfg.get("region") else "s3.amazonaws.com")
        self.bucket, self.cfg = cfg["bucket"], cfg
        self.client = Minio(
            endpoint,
            access_key=secrets.get("access_key"),
            secret_key=secrets.get("secret_key"),
            secure=bool(cfg.get("secure", True)),
            region=cfg.get("region") or None,
        )

    _ready: bool = False  # bucket confirmed / created by this instance

    def _key(self, key: str, private: bool) -> str:
        return f"private/{key}" if private else f"public/{key}"

    def _ensure_bucket(self) -> bool:
        """Create the bucket (and the public-read policy for public/) if it does not exist yet.

        Normally done by the storage test in the setup wizard; doing it on first use means uploads also work
        when that step was skipped or the bundled MinIO volume was recreated. Returns True if it was created.
        """
        created = False
        if not self.client.bucket_exists(self.bucket):
            self.client.make_bucket(self.bucket, location=self.cfg.get("region") or None)
            created = True
        if self.cfg.get("access", "public") == "public":
            policy = {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Principal": {"AWS": ["*"]},
                        "Action": ["s3:GetObject"],
                        "Resource": [f"arn:aws:s3:::{self.bucket}/public/*"],
                    }
                ],
            }
            try:
                self.client.set_bucket_policy(self.bucket, json.dumps(policy))
            except S3Error:
                pass  # some providers manage access with their own settings / CDN
        self._ready = True
        return created

    async def put(self, key: str, data: bytes, content_type: str, private: bool = False) -> Stored:
        def write():
            if not self._ready:
                self._ensure_bucket()
            try:
                self.client.put_object(self.bucket, self._key(key, private), io.BytesIO(data), len(data), content_type=content_type)
            except S3Error as e:
                if e.code != "NoSuchBucket":
                    raise
                self._ensure_bucket()  # bucket removed since the last check
                self.client.put_object(self.bucket, self._key(key, private), io.BytesIO(data), len(data), content_type=content_type)

        try:
            await asyncio.to_thread(write)
        except S3Error as e:
            raise StorageError(f"{e.code}: {e.message}") from e
        except StorageError:
            raise
        except Exception as e:  # network errors, wrong endpoint, bad credentials …
            raise StorageError(f"{type(e).__name__}: {e}") from e
        return Stored("s3", key)

    async def get(self, key: str, private: bool = False) -> bytes:
        def read():
            r = self.client.get_object(self.bucket, self._key(key, private))
            try:
                return r.read()
            finally:
                r.close()
                r.release_conn()

        return await asyncio.to_thread(read)

    async def delete(self, key: str, private: bool = False) -> None:
        await asyncio.to_thread(self.client.remove_object, self.bucket, self._key(key, private))

    def url(self, key: str) -> str:
        base = (self.cfg.get("public_url") or "").rstrip("/")
        if not base:
            return f"/media/{key}"  # streamed through the API
        return f"{base}/{self.bucket}/public/{key}" if "{bucket}" not in base else f"{base.replace('{bucket}', self.bucket)}/public/{key}"

    async def check(self) -> str:
        def probe():
            try:
                created = self._ensure_bucket()  # anyone may read objects under public/ (never private/)
                k = "public/.write-test"
                self.client.put_object(self.bucket, k, io.BytesIO(b"ok"), 2)
                self.client.remove_object(self.bucket, k)
                return created
            except S3Error as e:
                raise StorageError(f"{e.code}: {e.message}") from e
            except Exception as e:  # network errors
                raise StorageError(f"{type(e).__name__}: {e}") from e

        created = await asyncio.to_thread(probe)
        return f"Connected to bucket '{self.bucket}'" + (" (created it)." if created else ".")


async def backend(db: AsyncSession) -> LocalStorage | S3Storage:
    """Current storage backend, cached (reset whenever settings change)."""
    from ..core import settings_store

    return await settings_store.cached("storage-backend", lambda: _build(db))


async def _build(db: AsyncSession) -> LocalStorage | S3Storage:
    integ = await integrations.load(db, "storage")
    if integ and integ.enabled and integ.provider in ("minio", "s3"):
        cfg, sec = dict(integ.config), dict(integ.secrets)
        if integ.provider == "minio":
            bundled = integrations.bundled_minio_defaults()
            if bundled and not cfg.get("endpoint"):
                cfg = {**bundled, **{k: v for k, v in cfg.items() if v}}
            if bundled and not sec.get("access_key"):
                sec = {"access_key": infra().minio_access_key, "secret_key": infra().minio_secret_key}
        return S3Storage(cfg, sec)
    return LocalStorage(infra().storage_dir)


def guess_type(name: str) -> str:
    return mimetypes.guess_type(name)[0] or "application/octet-stream"
