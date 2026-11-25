import re
import uuid
from datetime import UTC, date, datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.errors import AppError
from ...core.settings_schemas import AlumniSettings
from ...models import Batch

PHONE = r"^\+?[0-9 ()\-]{7,20}$"
Gender = Literal["female", "male", "other", "prefer_not"]


def _clean(v):
    if isinstance(v, str):
        v = re.sub(r"\s+", " ", v).strip()
        return v or None
    return v


def _url(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    if not v:
        return None
    if not re.match(r"^https?://", v, re.I):
        v = "https://" + v
    if not re.match(r"^https?://[^\s/$.?#][^\s]*$", v, re.I) or len(v) > 300:
        raise ValueError("Enter a valid web address.")
    return v


class SchoolFields(BaseModel):
    kind: Literal["alumni", "student"] = "alumni"
    gender: Gender | None = None
    date_of_birth: date | None = None
    admission_year: int | None = Field(None, ge=1900, le=2100)
    graduation_year: int | None = Field(None, ge=1900, le=2100)
    batch_id: uuid.UUID | None = None
    class_name: str | None = Field(None, max_length=60)
    registration_no: str | None = Field(None, max_length=40)

    _c = field_validator("class_name", "registration_no", mode="before")(_clean)


class PresentFields(BaseModel):
    city: str | None = Field(None, max_length=100)
    country: str | None = Field(None, max_length=100)
    designation: str | None = Field(None, max_length=150)
    organization: str | None = Field(None, max_length=150)

    _c = field_validator("city", "country", "designation", "organization", mode="before")(_clean)


class RegisterIn(SchoolFields, PresentFields):
    full_name: str = Field(..., min_length=2, max_length=150)
    email: EmailStr
    phone: str | None = Field(None, pattern=PHONE)
    password: str = Field(..., min_length=1, max_length=256)
    accept_terms: bool = False
    custom_fields: dict = Field(default_factory=dict)
    invite: str | None = Field(None, max_length=64)

    _n = field_validator("full_name", mode="before")(_clean)


class ProfileIn(PresentFields, SchoolFields):
    """Own profile (personal + professional). Identity fields are locked once verified."""

    full_name: str | None = Field(None, min_length=2, max_length=150)
    industry: str | None = Field(None, max_length=100)
    bio: str | None = Field(None, max_length=2000)
    custom_fields: dict | None = None
    website: str | None = None
    linkedin: str | None = None

    _n = field_validator("full_name", "industry", mode="before")(_clean)
    _u = field_validator("website", "linkedin", mode="before")(_url)

    @field_validator("bio", mode="before")
    @classmethod
    def _bio(cls, v):
        return v.strip() or None if isinstance(v, str) else v


class PrivacyIn(BaseModel):
    visibility: Literal["members", "connections", "hidden"]
    sections: dict[str, Literal["members", "connections", "only_me"]]


class EducationIn(BaseModel):
    institution: str = Field(..., min_length=2, max_length=200)
    qualification: str = Field(..., min_length=2, max_length=150)
    field_of_study: str | None = Field(None, max_length=150)
    start_year: int | None = Field(None, ge=1900, le=2100)
    end_year: int | None = Field(None, ge=1900, le=2100)
    is_sst: bool = False
    description: str | None = Field(None, max_length=1000)

    _c = field_validator("institution", "qualification", "field_of_study", "description", mode="before")(_clean)


class EmploymentIn(BaseModel):
    organization: str = Field(..., min_length=1, max_length=150)
    designation: str = Field(..., min_length=1, max_length=150)
    industry: str | None = Field(None, max_length=100)
    location: str | None = Field(None, max_length=150)
    start_date: date | None = None
    end_date: date | None = None
    is_current: bool = False
    description: str | None = Field(None, max_length=2000)

    _c = field_validator("organization", "designation", "industry", "location", mode="before")(_clean)


class AchievementIn(BaseModel):
    kind: Literal["award", "recognition", "publication", "milestone", "certification"]
    title: str = Field(..., min_length=2, max_length=200)
    issuer: str | None = Field(None, max_length=150)
    year: int | None = Field(None, ge=1900, le=2100)
    url: str | None = None
    description: str | None = Field(None, max_length=1000)

    _c = field_validator("title", "issuer", "description", mode="before")(_clean)
    _u = field_validator("url", mode="before")(_url)


class SkillsIn(BaseModel):
    skills: list[str] = Field(default_factory=list, max_length=40)

    @field_validator("skills")
    @classmethod
    def _skills(cls, v: list[str]) -> list[str]:
        out, seen = [], set()
        for s in v:
            s = re.sub(r"\s+", " ", s).strip()
            if not s:
                continue
            if len(s) > 60:
                raise ValueError("Each skill can have at most 60 characters.")
            if s.casefold() not in seen:
                seen.add(s.casefold())
                out.append(s)
        return out


def fail(field: str, message: str, code: str = "VALIDATION_ERROR"):
    raise AppError(422, code, message, [{"field": field, "message": message}])


def check_years(start: int | None, end: int | None, field: str = "end_year") -> None:
    if start and end and end < start:
        fail(field, "The end cannot be before the start.")


async def validate_school(
    db: AsyncSession, body: SchoolFields, cfg: AlumniSettings, *, registering: bool, fields: set[str] | None = None
) -> None:
    """School identity rules shared by registration, profile editing and administration."""
    this_year = datetime.now(UTC).year
    has = (lambda f: True) if fields is None else (lambda f: f in fields)
    if registering and body.graduation_year is None:
        fail("graduation_year", "Select your graduation year.")
    if body.kind == "student" and registering and not cfg.allow_student_registration:
        fail("kind", "Registration is open to alumni only.")
    gy, ay = body.graduation_year, body.admission_year
    if gy and has("graduation_year"):
        if gy < cfg.founding_year:
            fail("graduation_year", f"The school's first year is {cfg.founding_year}.")
        if body.kind == "alumni" and gy > this_year:
            fail("graduation_year", "Alumni graduated in a past year — current students should register as a student.")
        if body.kind == "student" and (gy < this_year or gy > this_year + 15):
            fail("graduation_year", "Enter the year you expect to graduate.")
    if registering and cfg.require_admission_year and ay is None:
        fail("admission_year", "Enter your admission year.")
    if ay and has("admission_year"):
        if ay < cfg.founding_year or ay > this_year:
            fail("admission_year", f"Enter a year between {cfg.founding_year} and {this_year}.")
        if gy and ay > gy:
            fail("admission_year", "Admission must be before graduation.")
    if registering and cfg.require_registration_no and not body.registration_no:
        fail("registration_no", "Enter your student registration number.")
    if body.date_of_birth and has("date_of_birth"):
        today = datetime.now(UTC).date()
        if body.date_of_birth >= today or today.year - body.date_of_birth.year < 4 or body.date_of_birth.year < 1900:
            fail("date_of_birth", "Enter a valid date of birth.")
    if body.batch_id and has("batch_id"):
        b = await db.get(Batch, body.batch_id)
        if not b or not b.is_active:
            fail("batch_id", "This batch does not exist.")
        if gy and b.graduation_year != gy:
            fail("batch_id", f"{b.name} graduated in {b.graduation_year}, not {gy}.")
