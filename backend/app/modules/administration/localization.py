"""Languages and translations: public bundles for the frontends, management for administrators."""

import csv
import io
import re

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import settings_store
from ...core.audit import record
from ...core.db import get_db
from ...core.deps import Principal, require
from ...core.errors import AppError, not_found
from ...core.pagination import csv_response
from ...i18n import CATALOG, built_in
from ...models import Language, Translation

public = APIRouter(prefix="/api/v1/public", tags=["Public"])
admin = APIRouter(prefix="/api/v1/admin/localization", tags=["Admin: localization"])

CODE = r"^[a-z]{2}(-[A-Z]{2})?$"
DEFAULT_LANGUAGES = [("en", "English", "English", False, 0), ("ur", "Urdu", "اردو", True, 1)]


async def ensure_languages(db: AsyncSession) -> None:
    for code, name, native, rtl, pos in DEFAULT_LANGUAGES:
        await db.execute(
            pg_insert(Language)
            .values(code=code, name=name, native_name=native, rtl=rtl, enabled=True, position=pos)
            .on_conflict_do_nothing()
        )


def language_out(lang: Language) -> dict:
    return {
        "code": lang.code,
        "name": lang.name,
        "native_name": lang.native_name,
        "rtl": lang.rtl,
        "enabled": lang.enabled,
        "position": lang.position,
    }


async def enabled_languages(db: AsyncSession) -> list[dict]:
    async def load():
        rows = (await db.execute(select(Language).where(Language.enabled.is_(True)).order_by(Language.position, Language.code))).scalars()
        return [language_out(r) for r in rows] or [
            {"code": "en", "name": "English", "native_name": "English", "rtl": False, "enabled": True, "position": 0}
        ]

    return await settings_store.cached("languages", load)


async def bundle(db: AsyncSession, code: str) -> dict:
    async def load():
        lang = await db.get(Language, code)
        if not lang or not lang.enabled:
            return None
        messages = built_in(code)
        rows = (await db.execute(select(Translation.key, Translation.value).where(Translation.language == code))).all()
        messages.update({k: v for k, v in rows})
        return {"code": code, "rtl": lang.rtl, "name": lang.native_name, "messages": messages}

    return await settings_store.cached(f"i18n:{code}", load)


@public.get("/languages", summary="Languages offered in the interface")
async def languages(response: Response, db: AsyncSession = Depends(get_db)):
    general = await settings_store.get_group(db, "general")
    response.headers["Cache-Control"] = "public, max-age=60"
    return {"data": await enabled_languages(db), "meta": {"default": general.default_language}}


@public.get("/i18n/{code}", summary="Interface strings for a language")
async def get_bundle(code: str, response: Response, db: AsyncSession = Depends(get_db)):
    if not re.match(CODE, code):
        raise not_found("Language")
    data = await bundle(db, code)
    if not data:
        raise not_found("Language")
    response.headers["Cache-Control"] = "public, max-age=60"
    return {"data": data}


# ── administration ──────────────────────────────────────────────────────────
class LanguageIn(BaseModel):
    code: str = Field(..., pattern=CODE)
    name: str = Field(..., min_length=2, max_length=60)
    native_name: str = Field(..., min_length=1, max_length=60)
    rtl: bool = False
    enabled: bool = True
    position: int = Field(0, ge=0, le=100)


@admin.get("/languages", summary="All languages")
async def list_languages(_: Principal = Depends(require("settings.view")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Language).order_by(Language.position, Language.code))).scalars().all()
    counts = dict((await db.execute(select(Translation.language, func.count()).group_by(Translation.language))).all())
    general = await settings_store.get_group(db, "general")
    out = []
    for r in rows:
        n = len(CATALOG) if r.code in ("en", "ur") else counts.get(r.code, 0)
        out.append(
            {
                **language_out(r),
                "overrides": counts.get(r.code, 0),
                "translated": min(n, len(CATALOG)),
                "is_default": r.code == general.default_language,
            }
        )
    return {"data": out, "meta": {"keys": len(CATALOG)}}


@admin.post("/languages", status_code=201, summary="Add a language")
async def add_language(body: LanguageIn, me: Principal = Depends(require("settings.configure")), db: AsyncSession = Depends(get_db)):
    if await db.get(Language, body.code):
        raise AppError(409, "LANGUAGE_EXISTS", "This language already exists.")
    db.add(Language(**body.model_dump()))
    await record(db, actor_id=me.id, action="create", entity="language", entity_id=body.code, summary=f"Added language {body.name}")
    await db.commit()
    await settings_store.changed()
    return {"data": body.model_dump()}


@admin.put("/languages/{code}", summary="Edit a language")
async def edit_language(
    code: str, body: LanguageIn, me: Principal = Depends(require("settings.configure")), db: AsyncSession = Depends(get_db)
):
    lang = await db.get(Language, code)
    if not lang:
        raise not_found("Language")
    general = await settings_store.get_group(db, "general")
    if not body.enabled and code in ("en", general.default_language):
        raise AppError(422, "LANGUAGE_REQUIRED", "English and the default language cannot be turned off.")
    lang.name, lang.native_name, lang.rtl, lang.enabled, lang.position = body.name, body.native_name, body.rtl, body.enabled, body.position
    await record(db, actor_id=me.id, action="update", entity="language", entity_id=code, summary=f"Edited language {body.name}")
    await db.commit()
    await settings_store.changed()
    return {"data": language_out(lang)}


@admin.delete("/languages/{code}", summary="Remove a language and its translations")
async def delete_language(code: str, me: Principal = Depends(require("settings.configure")), db: AsyncSession = Depends(get_db)):
    general = await settings_store.get_group(db, "general")
    if code in ("en", "ur", general.default_language):
        raise AppError(422, "LANGUAGE_REQUIRED", "English, Urdu and the default language cannot be removed (Urdu can be turned off).")
    lang = await db.get(Language, code)
    if not lang:
        raise not_found("Language")
    await db.delete(lang)
    await record(db, actor_id=me.id, action="delete", entity="language", entity_id=code, summary=f"Removed language {lang.name}")
    await db.commit()
    await settings_store.changed()
    return {"data": {"ok": True}}


def _group(key: str) -> str:
    return key.split(".", 1)[0]


@admin.get("/translations/{code}", summary="Strings of a language with their English source")
async def list_translations(
    code: str,
    q: str | None = Query(None, max_length=100),
    group: str | None = None,
    missing: bool = False,
    _: Principal = Depends(require("settings.view")),
    db: AsyncSession = Depends(get_db),
):
    if not await db.get(Language, code):
        raise not_found("Language")
    defaults = built_in(code)
    overrides = dict((await db.execute(select(Translation.key, Translation.value).where(Translation.language == code))).all())
    rows = []
    for key, (en, _ur) in CATALOG.items():
        value = overrides.get(key, defaults[key])
        untranslated = code not in ("en",) and value == en and key not in overrides
        if group and _group(key) != group:
            continue
        if missing and not untranslated:
            continue
        if q and q.casefold() not in f"{key} {en} {value}".casefold():
            continue
        rows.append(
            {
                "key": key,
                "source": en,
                "default": defaults[key],
                "value": value,
                "overridden": key in overrides,
                "untranslated": untranslated,
            }
        )
    return {"data": rows, "meta": {"groups": sorted({_group(k) for k in CATALOG}), "total": len(rows)}}


class TranslationIn(BaseModel):
    key: str = Field(..., max_length=150)
    value: str | None = Field(None, max_length=2000)  # null or empty = back to the built-in text


async def _save(db: AsyncSession, code: str, items: list[TranslationIn], actor) -> int:
    changed = 0
    defaults = built_in(code)
    for it in items:
        if it.key not in CATALOG:
            continue
        value = (it.value or "").strip()
        if not value or value == defaults[it.key]:
            await db.execute(delete(Translation).where(Translation.language == code, Translation.key == it.key))
        else:
            stmt = pg_insert(Translation).values(language=code, key=it.key, value=value, updated_by=actor)
            await db.execute(
                stmt.on_conflict_do_update(
                    index_elements=["language", "key"], set_={"value": value, "updated_by": actor, "updated_at": func.now()}
                )
            )
        changed += 1
    return changed


@admin.put("/translations/{code}", summary="Save translations (empty value restores the built-in text)")
async def save_translations(
    code: str, body: list[TranslationIn], me: Principal = Depends(require("settings.configure")), db: AsyncSession = Depends(get_db)
):
    if not await db.get(Language, code):
        raise not_found("Language")
    if len(body) > 2000:
        raise AppError(422, "TOO_MANY", "Save at most 2000 strings at once.")
    n = await _save(db, code, body, me.id)
    await record(db, actor_id=me.id, action="update", entity="translation", entity_id=code, summary=f"Updated {n} {code} translations")
    await db.commit()
    await settings_store.changed()
    return {"data": {"saved": n}}


@admin.get("/translations/{code}/export", summary="Download translations as CSV (key, English, translation)")
async def export_translations(code: str, _: Principal = Depends(require("settings.view")), db: AsyncSession = Depends(get_db)):
    if not await db.get(Language, code):
        raise not_found("Language")
    data = (await bundle(db, code) or {"messages": built_in(code)})["messages"]
    return csv_response(
        f"translations-{code}.csv", ["key", "english", "translation"], ([k, en, data.get(k, en)] for k, (en, _u) in CATALOG.items())
    )


@admin.post("/translations/{code}/import", summary="Upload a translations CSV (key, english, translation)")
async def import_translations(
    code: str, file: UploadFile = File(...), me: Principal = Depends(require("settings.configure")), db: AsyncSession = Depends(get_db)
):
    if not await db.get(Language, code):
        raise not_found("Language")
    raw = await file.read()
    if len(raw) > 2 * 1024 * 1024:
        raise AppError(413, "FILE_TOO_LARGE", "The file is larger than 2 MB.")
    try:
        reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
        items = [TranslationIn(key=(r.get("key") or "").strip(), value=r.get("translation")) for r in reader]
    except (UnicodeDecodeError, csv.Error, ValueError) as e:
        raise AppError(422, "INVALID_FILE", "Upload the CSV downloaded from this screen (UTF-8).") from e
    n = await _save(db, code, items[:2000], me.id)
    await record(db, actor_id=me.id, action="import", entity="translation", entity_id=code, summary=f"Imported {n} {code} translations")
    await db.commit()
    await settings_store.changed()
    return {"data": {"saved": n, "skipped": len(items) - n}}
