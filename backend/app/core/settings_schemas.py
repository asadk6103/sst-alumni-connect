"""Validated shapes of every UI-managed settings group, with defaults."""

import re
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, HttpUrl, field_validator

HEX = r"^#[0-9a-fA-F]{6}$"


class GeneralSettings(BaseModel):
    app_name: str = Field("SST Alumni Connect", min_length=2, max_length=80)
    app_description: str = Field("Reconnect. Network. Mentor. Give Back.", max_length=300)
    app_url: str = Field("http://localhost:8080", max_length=200)
    institution_name: str = Field("SST Public School Rashidabad", min_length=2, max_length=150)
    contact_email: EmailStr | None = None
    contact_phone: str | None = Field(None, max_length=40)
    address: str | None = Field(None, max_length=300)
    default_language: str = Field("en", pattern=r"^[a-z]{2}(-[A-Z]{2})?$")
    timezone: str = Field("Asia/Karachi", max_length=60)
    date_format: Literal["DD MMM YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] = "DD MMM YYYY"
    time_format: Literal["12h", "24h"] = "12h"
    currency: str = Field("PKR", pattern=r"^[A-Z]{3}$")
    page_size: int = Field(20, ge=5, le=100)

    @field_validator("app_url")
    @classmethod
    def _url(cls, v: str) -> str:
        HttpUrl(v)  # raises when not a valid http(s) URL
        return v.rstrip("/")


class SecuritySettings(BaseModel):
    min_password_length: int = Field(10, ge=8, le=128)
    require_uppercase: bool = True
    require_lowercase: bool = True
    require_digit: bool = True
    require_symbol: bool = False
    password_expiry_days: int = Field(0, ge=0, le=730)  # 0 = never
    max_login_attempts: int = Field(5, ge=3, le=20)  # floor of 3: cannot disable lockout
    lockout_minutes: int = Field(15, ge=1, le=1440)
    session_idle_minutes: int = Field(60 * 24 * 7, ge=15, le=60 * 24 * 30)
    session_absolute_days: int = Field(30, ge=1, le=90)
    mfa_policy: Literal["optional", "required_staff", "required_all"] = "optional"
    require_email_verification: bool = True
    require_phone_verification: bool = False
    allowed_file_types: list[str] = Field(
        default_factory=lambda: ["jpg", "jpeg", "png", "webp", "gif", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt"])
    max_upload_mb: int = Field(10, ge=1, le=100)
    allowed_origins: list[str] = Field(default_factory=list)
    login_notifications: bool = True

    @field_validator("allowed_file_types")
    @classmethod
    def _types(cls, v: list[str]) -> list[str]:
        out = sorted({t.strip().lower().lstrip(".") for t in v if t.strip()})
        dangerous = {"exe", "bat", "cmd", "sh", "js", "html", "htm", "svg", "php", "jar", "msi", "ps1", "dll"}
        if bad := dangerous.intersection(out):
            raise ValueError(f"These file types cannot be allowed for security reasons: {', '.join(sorted(bad))}")
        return out

    @field_validator("allowed_origins")
    @classmethod
    def _origins(cls, v: list[str]) -> list[str]:
        for o in v:
            if not re.match(r"^https?://[^/\s]+$", o):
                raise ValueError(f"Not a valid origin (scheme://host[:port]): {o}")
        return v


class RealtimeSettings(BaseModel):
    """Applied by the real-time gateway; values marked restart in the UI need a controlled restart."""

    max_connections_per_gateway: int = Field(5000, ge=100, le=100000)  # restart
    heartbeat_interval_seconds: int = Field(25, ge=5, le=120)  # restart
    connection_timeout_seconds: int = Field(20, ge=5, le=120)  # restart
    max_message_chars: int = Field(4000, ge=100, le=20000)
    attachment_max_mb: int = Field(10, ge=1, le=100)
    messages_per_minute: int = Field(60, ge=5, le=1000)
    presence_ttl_seconds: int = Field(60, ge=15, le=600)


class BrandingColors(BaseModel):
    primary_navy: str = Field("#102344", pattern=HEX)
    dark_navy: str = Field("#0B1830", pattern=HEX)
    primary: str = Field("#7138DB", pattern=HEX)
    secondary: str = Field("#9461EC", pattern=HEX)
    light: str = Field("#F2ECFF", pattern=HEX)
    surface: str = Field("#FFFFFF", pattern=HEX)
    background: str = Field("#F7F8FC", pattern=HEX)
    text_primary: str = Field("#20283A", pattern=HEX)
    text_secondary: str = Field("#718096", pattern=HEX)
    success: str = Field("#16A36A", pattern=HEX)
    warning: str = Field("#E5A000", pattern=HEX)
    danger: str = Field("#DC4545", pattern=HEX)


FONTS = Literal["Inter", "Poppins", "Roboto", "Open Sans", "Lato", "Nunito Sans", "Noto Nastaliq Urdu", "System"]


class Branding(BaseModel):
    colors: BrandingColors = Field(default_factory=BrandingColors)
    font_body: FONTS = "Inter"
    font_heading: FONTS = "Poppins"
    button_radius: int = Field(8, ge=0, le=24)
    card_radius: int = Field(12, ge=0, le=24)
    color_mode: Literal["light", "dark", "system"] = "light"
    tagline: str = Field("Reconnect. Network. Mentor. Give Back.", max_length=120)
    footer_text: str = Field("", max_length=300)
    # Media library ids
    institution_logo: str | None = None
    logo_light: str | None = None
    logo_dark: str | None = None
    favicon: str | None = None
    login_background: str | None = None
    dashboard_banner: str | None = None


SETTINGS_GROUPS: dict[str, type[BaseModel]] = {
    "general": GeneralSettings,
    "security": SecuritySettings,
    "realtime": RealtimeSettings,
}

RESTART_FIELDS = {"realtime": ["max_connections_per_gateway", "heartbeat_interval_seconds", "connection_timeout_seconds"]}

DEFAULT_MODULES: dict[str, tuple[str, str]] = {
    "directory": ("Alumni Directory", "Search and connect with alumni."),
    "community": ("Community", "Feed, posts, comments and discussion groups."),
    "jobs": ("Job Portal", "Jobs, internships, applications and employers."),
    "mentorship": ("Mentorship", "Mentor directory, requests and sessions."),
    "events": ("Events", "Events, reunions, registration and check-in."),
    "donations": ("Donations", "Campaigns and donations."),
    "scholarships": ("Scholarships", "Scholarship funds and sponsorships."),
    "gallery": ("Gallery", "Photo albums."),
    "newsletters": ("Newsletters", "Newsletter subscriptions and campaigns."),
    "messaging": ("Messaging", "Private and group chat."),
    "chapters": ("Alumni Chapters", "Regional alumni chapters."),
}


def password_problems(password: str, s: SecuritySettings) -> list[str]:
    problems = []
    if len(password) < s.min_password_length:
        problems.append(f"at least {s.min_password_length} characters")
    if s.require_uppercase and not re.search(r"[A-Z]", password):
        problems.append("an uppercase letter")
    if s.require_lowercase and not re.search(r"[a-z]", password):
        problems.append("a lowercase letter")
    if s.require_digit and not re.search(r"\d", password):
        problems.append("a number")
    if s.require_symbol and not re.search(r"[^A-Za-z0-9]", password):
        problems.append("a symbol")
    if len(password) > 256:
        problems.append("at most 256 characters")
    return problems
