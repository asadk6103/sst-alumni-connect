"""Upload processing: type sniffing (magic bytes), size/type policy, image sanitising and variants."""

import asyncio
import io
import re
import uuid
from datetime import UTC, datetime

import filetype
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.ext.asyncio import AsyncSession

from ..core import settings_store
from ..core.errors import AppError
from ..models import Media
from . import storage

IMAGE_MIMES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/x-icon": "ico",
               "image/vnd.microsoft.icon": "ico"}
DOC_MIMES = {
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "text/plain": "txt",
}
VARIANT_WIDTHS = (160, 480, 1200, 1920)
Image.MAX_IMAGE_PIXELS = 50_000_000  # decompression-bomb guard


def _sniff(data: bytes, filename: str) -> tuple[str, str]:
    kind = filetype.guess(data)
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if kind:
        mime = kind.mime
        if mime == "application/zip" and ext in ("docx", "xlsx", "pptx"):
            mime = next(m for m, e in DOC_MIMES.items() if e == ext)
        elif mime == "application/x-ole-storage" and ext in ("doc", "xls", "ppt"):
            mime = next(m for m, e in DOC_MIMES.items() if e == ext)
        return mime, IMAGE_MIMES.get(mime) or DOC_MIMES.get(mime) or kind.extension
    if ext == "ico" and data[:4] == b"\x00\x00\x01\x00":
        return "image/x-icon", "ico"
    if ext == "txt":
        try:
            data[:4096].decode("utf-8")
            return "text/plain", "txt"
        except UnicodeDecodeError:
            pass
    raise AppError(415, "UNSUPPORTED_FILE", "This file type is not supported.")


def _process_image(data: bytes, mime: str) -> tuple[bytes, int, int, list[tuple[int, bytes, int]]]:
    """Re-encode (drops EXIF/GPS metadata) and build WebP variants. Returns (original, w, h, variants)."""
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()
        img = Image.open(io.BytesIO(data))
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as e:
        raise AppError(415, "INVALID_IMAGE", "The image could not be read.") from e
    if mime in ("image/x-icon", "image/vnd.microsoft.icon", "image/gif"):
        return data, img.width, img.height, []  # keep as-is (multi-size icon / animation)
    img = ImageOps.exif_transpose(img)
    w, h = img.size
    out = io.BytesIO()
    fmt = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}[mime]
    save_img = img.convert("RGB") if fmt == "JPEG" and img.mode not in ("RGB", "L") else img
    save_img.save(out, format=fmt, **({"quality": 90, "optimize": True} if fmt != "PNG" else {"optimize": True}))
    variants = []
    for vw in VARIANT_WIDTHS:
        if vw >= w:
            continue
        v = img.copy()
        v.thumbnail((vw, vw * 10))
        buf = io.BytesIO()
        (v if v.mode in ("RGB", "RGBA") else v.convert("RGBA")).save(buf, format="WEBP", quality=82, method=4)
        variants.append((v.width, buf.getvalue(), v.height))
    return out.getvalue(), w, h, variants


def _safe_name(name: str) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-.")[:120]
    return base or "file"


async def upload(db: AsyncSession, *, data: bytes, filename: str, folder: str = "general", alt: str = "",
                 images_only: bool = False, actor=None) -> Media:
    sec = await settings_store.get_group(db, "security")
    if len(data) > sec.max_upload_mb * 1024 * 1024:
        raise AppError(413, "FILE_TOO_LARGE", f"The file is larger than {sec.max_upload_mb} MB.")
    if not data:
        raise AppError(422, "EMPTY_FILE", "The file is empty.")
    mime, ext = _sniff(data, filename)
    is_image = mime in IMAGE_MIMES
    if images_only and not is_image:
        raise AppError(415, "IMAGE_REQUIRED", "Please upload an image (JPG, PNG, WebP, GIF or ICO).")
    if ext not in sec.allowed_file_types and not (is_image and ext in ("jpg", "jpeg", "png", "webp", "gif", "ico")
                                                  and images_only):
        raise AppError(415, "FILE_TYPE_NOT_ALLOWED", f".{ext} files are not allowed.")
    width = height = None
    variants_raw: list[tuple[int, bytes, int]] = []
    if is_image:
        data, width, height, variants_raw = await asyncio.to_thread(_process_image, data, mime)
    store = await storage.backend(db)
    stamp = datetime.now(UTC).strftime("%Y/%m")
    uid = uuid.uuid4().hex
    key = f"{folder}/{stamp}/{uid}.{ext}"
    await store.put(key, data, mime)
    variants = {}
    for vw, vdata, vh in variants_raw:
        vkey = f"{folder}/{stamp}/{uid}-{vw}.webp"
        await store.put(vkey, vdata, "image/webp")
        variants[str(vw)] = {"key": vkey, "width": vw, "height": vh}
    m = Media(storage=store.name, key=key, filename=_safe_name(filename), mime=mime, size=len(data), width=width,
              height=height, variants=variants, alt=alt[:300], folder=folder[:60], uploaded_by=actor)
    db.add(m)
    await db.flush()
    return m


async def to_public(db: AsyncSession, m: Media | None) -> dict | None:
    if not m:
        return None
    store = await storage.backend(db)
    # Files keep the address of the storage they were written to (switching provider does not move them).
    url = store.url if (m.storage == store.name) else (lambda k: f"/media/{k}")
    return {
        "id": str(m.id), "url": url(m.key), "filename": m.filename, "mime": m.mime, "size": m.size,
        "width": m.width, "height": m.height, "alt": m.alt, "folder": m.folder,
        "variants": [{"width": v["width"], "height": v["height"], "url": url(v["key"])}
                     for v in sorted(m.variants.values(), key=lambda v: v["width"])],
        "created_at": m.created_at,
    }
