"""First-run installation wizard.

Every call needs the one-time setup code printed in the API log (and stored in CONFIG_DIR), so a
freshly deployed server cannot be claimed by someone else. After completion all endpoints return
409 INSTALLED and the code is deleted. Settings are changed later in the Configuration Center.
"""

import asyncio
import logging
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import secrets, settings_store
from ...core.audit import record
from ...core.config import infra
from ...core.db import get_db
from ...core.deps import client_ip
from ...core.errors import AppError
from ...core.permissions import SUPER_ADMIN
from ...core.redis import enforce, redis
from ...core.security import hash_password
from ...core.settings_schemas import Branding, BrandingColors, GeneralSettings, SecuritySettings, password_problems
from ...models import BrandingSetting, Role, SystemSetting, User
from ...services import integrations, media, messaging, storage
from ..auth.router import user_payload
from ..auth.service import issue_session

log = logging.getLogger("app.setup")
router = APIRouter(prefix="/api/v1/setup", tags=["Setup wizard"])
VERSION = "1.0.0"


async def _guard(db: AsyncSession, request: Request, code: str) -> None:
    if await settings_store.is_installed(db):
        raise AppError(409, "INSTALLED", "Installation is already complete.")
    await enforce(f"setup:{client_ip(request)}", 30, 600)
    if not secrets.check_setup_code(code):
        raise AppError(403, "INVALID_SETUP_CODE",
                       "The setup code is not correct. It is printed in the API log (docker compose logs api).")


class CodeIn(BaseModel):
    code: str = Field(..., min_length=5, max_length=20)


@router.get("/status", summary="Is installation required? Includes environment checks.")
async def status(db: AsyncSession = Depends(get_db)):
    installed = await settings_store.is_installed(db)
    out: dict = {"installed": installed}
    if installed:
        return {"data": out}
    checks = {}
    try:
        v = (await db.execute(text("SHOW server_version"))).scalar_one()
        checks["database"] = {"ok": True, "message": f"PostgreSQL {v} connected."}
    except Exception as e:  # pragma: no cover
        checks["database"] = {"ok": False, "message": type(e).__name__}
    try:
        await redis().ping()
        checks["redis"] = {"ok": True, "message": "Redis connected."}
    except Exception as e:
        checks["redis"] = {"ok": False, "message": f"Redis not reachable ({type(e).__name__})."}
    out.update(checks=checks, bundled_storage=bool(integrations.bundled_minio_defaults()),
               environment=infra().environment, mail_catcher=infra().is_dev)
    return {"data": out}


@router.post("/verify-code", summary="Check the setup code")
async def verify_code(body: CodeIn, request: Request, db: AsyncSession = Depends(get_db)):
    await _guard(db, request, body.code)
    return {"data": {"ok": True}}


@router.post("/upload", summary="Upload a logo or image during setup")
async def upload(request: Request, code: str = Form(...), file: UploadFile = File(...),
                 db: AsyncSession = Depends(get_db)):
    await _guard(db, request, code)
    data = await file.read()
    m = await media.upload(db, data=data, filename=file.filename or "logo", folder="branding", images_only=True)
    return {"data": await media.to_public(db, m)}


class SmtpTestIn(BaseModel):
    code: str
    config: integrations.SmtpConfig
    password: str | None = Field(None, max_length=500)
    send_to: EmailStr | None = None


@router.post("/test-email", summary="Test SMTP settings before saving")
async def test_email(body: SmtpTestIn, request: Request, db: AsyncSession = Depends(get_db)):
    await _guard(db, request, body.code)
    cfg, sec = body.config.model_dump(mode="json"), {"password": body.password or ""}
    try:
        if body.send_to:
            await asyncio.to_thread(messaging.smtp_send, cfg, sec, body.send_to, "Test email from the SST Alumni Connect setup",
                                    "<p>Your email settings work.</p>")
            return {"data": {"ok": True, "message": f"Test email sent to {body.send_to}."}}
        return {"data": {"ok": True, "message": await asyncio.to_thread(messaging.smtp_check, cfg, sec)}}
    except messaging.DeliveryError as e:
        return {"data": {"ok": False, "message": str(e)}}


class StorageIn(BaseModel):
    provider: Literal["local", "minio", "s3"] = "local"
    config: dict = Field(default_factory=dict)
    access_key: str | None = Field(None, max_length=200)
    secret_key: str | None = Field(None, max_length=500)


class StorageTestIn(StorageIn):
    code: str


def _storage_backend(s: StorageIn):
    if s.provider == "local":
        return storage.LocalStorage(infra().storage_dir)
    cfg = integrations.StorageConfig.model_validate(s.config).model_dump(mode="json")
    sec = {"access_key": s.access_key or "", "secret_key": s.secret_key or ""}
    if s.provider == "minio" and not cfg.get("endpoint"):
        bundled = integrations.bundled_minio_defaults()
        if not bundled:
            raise AppError(422, "NO_BUNDLED_STORAGE", "No bundled MinIO is available; enter an endpoint.")
        cfg = {**cfg, **bundled}
        sec = {"access_key": infra().minio_access_key, "secret_key": infra().minio_secret_key}
    return storage.S3Storage(cfg, sec)


@router.post("/test-storage", summary="Test storage settings before saving")
async def test_storage(body: StorageTestIn, request: Request, db: AsyncSession = Depends(get_db)):
    await _guard(db, request, body.code)
    try:
        return {"data": {"ok": True, "message": await _storage_backend(body).check()}}
    except storage.StorageError as e:
        return {"data": {"ok": False, "message": str(e)}}


class AdminIn(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=150)
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=256)


class InstitutionIn(BaseModel):
    app_name: str = Field("SST Alumni Connect", min_length=2, max_length=80)
    institution_name: str = Field(..., min_length=2, max_length=150)
    app_url: str
    contact_email: EmailStr | None = None
    contact_phone: str | None = Field(None, max_length=40)
    address: str | None = Field(None, max_length=300)
    timezone: str = "Asia/Karachi"
    default_language: str = "en"
    currency: str = "PKR"


class BrandingIn(BaseModel):
    colors: BrandingColors = Field(default_factory=BrandingColors)
    institution_logo: str | None = None
    logo_light: str | None = None
    favicon: str | None = None
    tagline: str = Field("Reconnect. Network. Mentor. Give Back.", max_length=120)


class EmailIn(BaseModel):
    config: integrations.SmtpConfig
    password: str | None = Field(None, max_length=500)


class SecurityIn(BaseModel):
    min_password_length: int = Field(10, ge=8, le=128)
    mfa_policy: Literal["optional", "required_staff", "required_all"] = "optional"
    require_email_verification: bool = True
    max_login_attempts: int = Field(5, ge=3, le=20)
    lockout_minutes: int = Field(15, ge=1, le=1440)


class CompleteIn(BaseModel):
    code: str
    institution: InstitutionIn
    branding: BrandingIn = Field(default_factory=BrandingIn)
    admin: AdminIn
    email: EmailIn | None = None
    storage: StorageIn = Field(default_factory=StorageIn)
    security: SecurityIn = Field(default_factory=SecurityIn)


@router.post("/complete", status_code=201, summary="Finish installation: settings + first administrator")
async def complete(body: CompleteIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    await _guard(db, request, body.code)
    # Serialise concurrent completion attempts.
    await db.execute(text("SELECT pg_advisory_xact_lock(7312005)"))
    if (await db.get(SystemSetting, "installation")):
        raise AppError(409, "INSTALLED", "Installation is already complete.")

    general = GeneralSettings(**body.institution.model_dump())
    security = SecuritySettings(**body.security.model_dump())
    problems = password_problems(body.admin.password, security)
    if problems:
        raise AppError(422, "WEAK_PASSWORD", "Password must contain " + ", ".join(problems) + ".",
                       [{"field": "admin.password", "message": "Password must contain " + ", ".join(problems) + "."}])
    if (await db.execute(select(func.count()).select_from(User))).scalar_one():
        raise AppError(409, "USERS_EXIST", "Accounts already exist; use the administration portal instead.")
    await settings_store.save_group(db, "general", general, None)
    await settings_store.save_group(db, "security", security, None)

    brand = Branding(**{**Branding().model_dump(), **body.branding.model_dump()}).model_dump(mode="json")
    row = await db.get(BrandingSetting, 1)
    if row:
        row.draft = row.published = brand
        row.version += 1
        row.published_at = datetime.now(UTC)
    else:
        db.add(BrandingSetting(id=1, draft=brand, published=brand, version=1, published_at=datetime.now(UTC)))

    if body.email:
        await integrations.save(db, "email", integrations.IntegrationUpdate(
            provider="smtp", config=body.email.config.model_dump(mode="json"),
            secrets={"password": body.email.password} if body.email.password else {}, enabled=True), None)
    if body.storage.provider != "local":
        sec = {}
        if body.storage.access_key:
            sec = {"access_key": body.storage.access_key, "secret_key": body.storage.secret_key or ""}
        await integrations.save(db, "storage", integrations.IntegrationUpdate(
            provider=body.storage.provider, config=body.storage.config, secrets=sec, enabled=True), None)

    role = (await db.execute(select(Role).where(Role.key == SUPER_ADMIN))).scalar_one()
    now = datetime.now(UTC)
    user = User(email=body.admin.email.lower(), full_name=body.admin.full_name.strip(),
                password_hash=hash_password(body.admin.password), status="active", email_verified_at=now,
                password_changed_at=now, roles=[role])
    db.add(user)
    db.add(SystemSetting(key="installation", value={"completed_at": now.isoformat(), "version": VERSION,
                                                    "completed_by": body.admin.email.lower()}))
    await db.flush()
    await record(db, actor_id=user.id, action="install", entity="system", summary="Installation completed",
                 ip=client_ip(request))
    tokens = await issue_session(db, request, response, user)
    await settings_store.changed()
    secrets.clear_setup_code()
    log.info("Installation completed by %s", user.email)
    return {"data": {**tokens, "user": await user_payload(db, user)}}


async def announce() -> None:
    """Print the setup code while the installation is not complete."""
    from ...core.db import SessionLocal

    async with SessionLocal() as db:
        if await settings_store.is_installed(db):
            return
    code = secrets.ensure_setup_code()
    line = "=" * 64
    log.warning("\n%s\n  SST Alumni Connect — first-run setup\n  Open the site and enter this setup code:\n\n"
                "      %s\n\n  (shown until installation is complete)\n%s", line, code, line)
