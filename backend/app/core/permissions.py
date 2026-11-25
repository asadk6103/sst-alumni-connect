"""Permission catalogue and default roles.

Permission keys are `<module>.<action>`. Administrative modules use the standard actions
(view, create, edit, delete, approve, reject, publish, export, configure). Portal permissions
(`portal.*`) govern what signed-in community members may do.

The catalogue is synchronised to the database at start-up (new permissions are added; default
roles receive newly introduced default grants without losing administrator customisations).
"""

ADMIN_MODULES: dict[str, tuple[str, list[str]]] = {
    "dashboard": ("Admin dashboard", ["view", "export"]),
    "alumni": ("Alumni management", ["view", "create", "edit", "delete", "export"]),
    "verification": ("Alumni verification", ["view", "approve", "reject"]),
    "batches": ("Batch management", ["view", "create", "edit", "delete"]),
    "community": ("Community moderation", ["view", "edit", "delete", "approve", "reject", "publish"]),
    "events": ("Events management", ["view", "create", "edit", "delete", "publish", "export"]),
    "jobs": ("Jobs and internships", ["view", "create", "edit", "delete", "approve", "reject", "export"]),
    "mentorship": ("Mentorship management", ["view", "edit", "approve", "reject", "export"]),
    "donations": ("Donations", ["view", "create", "edit", "export", "configure"]),
    "scholarships": ("Scholarships", ["view", "create", "edit", "delete", "export"]),
    "achievements": ("Alumni achievements", ["view", "create", "edit", "delete", "approve", "reject", "publish"]),
    "news": ("News and announcements", ["view", "create", "edit", "delete", "publish"]),
    "gallery": ("Gallery", ["view", "create", "edit", "delete", "publish"]),
    "cms": ("Pages and content", ["view", "create", "edit", "delete", "publish"]),
    "navigation": ("Navigation builder", ["view", "edit"]),
    "media": ("Media library", ["view", "create", "edit", "delete"]),
    "communications": ("Communication centre", ["view", "create", "publish", "configure"]),
    "reports": ("Reports and analytics", ["view", "export"]),
    "users": ("User management", ["view", "create", "edit", "delete", "export"]),
    "roles": ("Roles and permissions", ["view", "create", "edit", "delete"]),
    "settings": ("System configuration", ["view", "configure"]),
    "branding": ("Branding", ["view", "edit", "publish"]),
    "integrations": ("Integrations (email, SMS, storage, payments)", ["view", "configure"]),
    "modules": ("Module management", ["view", "configure"]),
    "custom_fields": ("Custom field builder", ["view", "configure"]),
    "feature_flags": ("Feature flags", ["view", "configure"]),
    "audit": ("Audit logs", ["view", "export"]),
    "health": ("System health", ["view"]),
}

PORTAL_PERMISSIONS: dict[str, str] = {
    "portal.access": "Use the alumni portal",
    "portal.directory": "Browse the alumni directory",
    "portal.connect": "Send connection requests and follow members",
    "portal.post": "Create community posts and comments",
    "portal.react": "React to posts",
    "portal.message": "Send private and group messages",
    "portal.groups": "Join discussion groups",
    "portal.jobs.view": "View job listings",
    "portal.jobs.apply": "Apply for jobs",
    "portal.jobs.post": "Submit job postings for approval",
    "portal.mentorship.request": "Request mentorship",
    "portal.mentorship.mentor": "Apply to become a mentor",
    "portal.events.register": "Register for events",
    "portal.donate": "Make donations",
    "portal.nominate": "Nominate alumni for achievements",
}


def all_permissions() -> list[tuple[str, str, str, str]]:
    """(key, module, action, description) for every permission."""
    out: list[tuple[str, str, str, str]] = []
    for module, (label, actions) in ADMIN_MODULES.items():
        for action in actions:
            out.append((f"{module}.{action}", module, action, f"{label}: {action}"))
    for key, desc in PORTAL_PERMISSIONS.items():
        out.append((key, "portal", key.split(".", 1)[1], desc))
    return out


def _admin(*modules: str, actions: tuple[str, ...] | None = None) -> set[str]:
    keys: set[str] = set()
    for m in modules:
        for a in ADMIN_MODULES[m][1]:
            if actions is None or a in actions:
                keys.add(f"{m}.{a}")
    return keys


ALL_KEYS = {k for k, *_ in all_permissions()}
ADMIN_KEYS = {k for k in ALL_KEYS if not k.startswith("portal.")}
MEMBER_BASE = {
    "portal.access",
    "portal.directory",
    "portal.connect",
    "portal.post",
    "portal.react",
    "portal.message",
    "portal.groups",
    "portal.jobs.view",
    "portal.events.register",
    "portal.donate",
}
CONTENT = ("news", "gallery", "cms", "media", "achievements", "navigation")

# key: (name, description, is_staff, default permissions)
DEFAULT_ROLES: dict[str, tuple[str, str, bool, set[str]]] = {
    "super_admin": ("Super Administrator", "Unrestricted access to everything.", True, ALL_KEYS),
    "system_admin": (
        "System Administrator",
        "Configuration, integrations, users and system health.",
        True,
        _admin(
            "dashboard",
            "users",
            "roles",
            "settings",
            "branding",
            "integrations",
            "modules",
            "custom_fields",
            "feature_flags",
            "audit",
            "health",
            "navigation",
            "media",
        ),
    ),
    "alumni_admin": (
        "Alumni Administrator",
        "Manages alumni records, verification, batches and community.",
        True,
        _admin("dashboard", "alumni", "verification", "batches", "community", "achievements", "reports", "communications")
        | _admin("media", actions=("view", "create")),
    ),
    "alumni_coordinator": (
        "Alumni Coordinator",
        "Day-to-day alumni engagement and verification.",
        True,
        _admin("dashboard", actions=("view",))
        | _admin("alumni", actions=("view", "edit"))
        | _admin("verification", "batches", "achievements")
        | _admin("community", actions=("view", "approve", "reject")),
    ),
    "content_editor": (
        "Content Editor",
        "Website pages, news, gallery and media.",
        True,
        _admin("dashboard", actions=("view",)) | _admin(*CONTENT),
    ),
    "event_manager": (
        "Event Manager",
        "Events, reunions, registrations and attendance.",
        True,
        _admin("dashboard", actions=("view",)) | _admin("events", "gallery", "media"),
    ),
    "career_manager": ("Career Manager", "Jobs, internships and employers.", True, _admin("dashboard", actions=("view",)) | _admin("jobs")),
    "mentorship_coordinator": (
        "Mentorship Coordinator",
        "Mentor approvals and mentorship programme.",
        True,
        _admin("dashboard", actions=("view",)) | _admin("mentorship"),
    ),
    "finance_manager": (
        "Finance / Donation Manager",
        "Campaigns, donations and scholarships.",
        True,
        _admin("dashboard", actions=("view",)) | _admin("donations", "scholarships") | _admin("reports", actions=("view", "export")),
    ),
    "chapter_head": (
        "Alumni Chapter Head",
        "Leads a regional alumni chapter.",
        False,
        MEMBER_BASE | {"portal.jobs.apply", "portal.jobs.post", "portal.mentorship.request", "portal.mentorship.mentor", "portal.nominate"},
    ),
    "verified_alumni": (
        "Verified Alumni",
        "Verified former student of SST.",
        False,
        MEMBER_BASE | {"portal.jobs.apply", "portal.jobs.post", "portal.mentorship.request", "portal.mentorship.mentor", "portal.nominate"},
    ),
    "unverified_alumni": (
        "Unverified Alumni",
        "Registered; awaiting verification.",
        False,
        {"portal.access", "portal.jobs.view", "portal.events.register", "portal.donate"},
    ),
    "student": (
        "Student",
        "Current SST student (mentorship and events).",
        False,
        {"portal.access", "portal.mentorship.request", "portal.events.register", "portal.jobs.view"},
    ),
    "employer": (
        "Employer",
        "Organisation posting jobs and internships.",
        False,
        {"portal.access", "portal.jobs.view", "portal.jobs.post"},
    ),
    "guest": ("Guest", "Limited access.", False, {"portal.access"}),
}

SUPER_ADMIN = "super_admin"
