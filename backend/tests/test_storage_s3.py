"""S3 / MinIO storage: the bucket is created on first use, and failures surface as StorageError (HTTP 503)."""

import pytest
from minio.error import S3Error

from app.services import storage


class FakeMinio:
    def __init__(self, fail: Exception | None = None):
        self.buckets: set[str] = set()
        self.objects: dict[str, bytes] = {}
        self.policy = None
        self.fail = fail

    def bucket_exists(self, b):
        return b in self.buckets

    def make_bucket(self, b, location=None):
        self.buckets.add(b)

    def set_bucket_policy(self, b, p):
        self.policy = p

    def put_object(self, b, k, data, length, content_type=None):
        if self.fail:
            raise self.fail
        if b not in self.buckets:
            raise S3Error("NoSuchBucket", "The specified bucket does not exist", k, "r", "h", None)
        self.objects[k] = data.read()


def make(fake: FakeMinio) -> storage.S3Storage:
    s = storage.S3Storage({"bucket": "alumni", "endpoint": "minio:9000", "secure": False}, {"access_key": "a", "secret_key": "b"})
    s.client = fake
    return s


async def test_put_creates_missing_bucket_and_public_policy():
    fake = FakeMinio()
    s = make(fake)
    await s.put("posts/2026/11/x.jpg", b"jpeg", "image/jpeg")
    assert "alumni" in fake.buckets
    assert fake.objects["public/posts/2026/11/x.jpg"] == b"jpeg"
    assert "alumni/public/*" in fake.policy


async def test_put_recreates_bucket_removed_after_first_check():
    fake = FakeMinio()
    s = make(fake)
    await s.put("a.jpg", b"1", "image/jpeg")
    fake.buckets.clear()  # e.g. MinIO volume recreated
    await s.put("b.jpg", b"2", "image/jpeg", private=True)
    assert fake.objects["private/b.jpg"] == b"2"


async def test_unreachable_storage_raises_storage_error():
    s = make(FakeMinio(fail=ConnectionError("minio:9000 refused")))
    with pytest.raises(storage.StorageError, match="ConnectionError"):
        await s.put("c.jpg", b"3", "image/jpeg")


async def test_bundled_minio_is_plain_http_even_if_saved_as_secure(monkeypatch):
    """The setup wizard used to save secure=true for the bundled MinIO → SSL WRONG_VERSION_NUMBER on upload."""
    from types import SimpleNamespace

    from app.services import integrations

    monkeypatch.setattr(integrations, "bundled_minio_defaults", lambda: {"endpoint": "minio:9000", "public_url": "/s3", "secure": False})
    monkeypatch.setattr(storage, "infra", lambda: SimpleNamespace(minio_access_key="ak", minio_secret_key="sk", storage_dir="."))
    for endpoint in (None, "minio:9000"):
        integ = SimpleNamespace(
            enabled=True, provider="minio", config={"endpoint": endpoint, "bucket": "alumni-media", "secure": True}, secrets={}
        )

        async def load(db, kind, integ=integ):
            return integ

        monkeypatch.setattr(integrations, "load", load)
        s = await storage._build(None)
        assert s.cfg["secure"] is False and s.cfg["endpoint"] == "minio:9000"
        assert s.client._base_url.is_https is False
