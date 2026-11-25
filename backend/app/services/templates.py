"""{{placeholder}} rendering for email / SMS / in-app templates, plus the built-in defaults."""

import html
import re

_PLACEHOLDER = re.compile(r"{{\s*([a-zA-Z0-9_]+)\s*}}")


def render(text: str, data: dict, escape: bool = False) -> str:
    def sub(m: re.Match) -> str:
        v = data.get(m.group(1), "")
        v = "" if v is None else str(v)
        return html.escape(v) if escape else v

    return _PLACEHOLDER.sub(sub, text)


def wrap_email(body_html: str, app_name: str, primary: str = "#7138DB") -> str:
    return f"""<!doctype html><html><body style="margin:0;background:#F7F8FC;font-family:Inter,Segoe UI,Arial,sans-serif;color:#20283A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #E6E8F0">
<tr><td style="background:#102344;color:#fff;padding:18px 24px;border-radius:12px 12px 0 0;font-size:18px;font-weight:600">{html.escape(app_name)}</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.6">{body_html}</td></tr>
<tr><td style="padding:14px 24px;color:#718096;font-size:12px;border-top:1px solid #EEF0F5">This message was sent by {html.escape(app_name)}.</td></tr>
</table></td></tr></table>
<style>a.btn{{background:{primary};color:#fff!important;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;font-weight:600}}</style>
</body></html>"""


# key: (channel, name, subject, body, placeholders)
DEFAULT_TEMPLATES: list[tuple[str, str, str, str | None, str, list[str]]] = [
    ("auth.verify_email", "email", "Verify your email address", "Verify your email for {{app_name}}",
     "<p>Hello {{name}},</p><p>Please confirm your email address to activate your account.</p>"
     '<p><a class="btn" href="{{link}}">Verify email</a></p><p>This link expires in {{hours}} hours. '
     "If you did not create an account, you can ignore this email.</p>",
     ["name", "link", "hours", "app_name"]),
    ("auth.password_reset", "email", "Password reset", "Reset your {{app_name}} password",
     "<p>Hello {{name}},</p><p>We received a request to reset your password.</p>"
     '<p><a class="btn" href="{{link}}">Choose a new password</a></p>'
     "<p>The link expires in {{minutes}} minutes. If you did not ask for this, ignore this email — your password stays the same.</p>",
     ["name", "link", "minutes", "app_name"]),
    ("auth.password_changed", "email", "Password changed", "Your {{app_name}} password was changed",
     "<p>Hello {{name}},</p><p>Your password was just changed and other devices were signed out. "
     "If this was not you, reset your password immediately and contact us.</p>", ["name", "app_name"]),
    ("auth.login_alert", "email", "New sign-in alert", "New sign-in to {{app_name}}",
     "<p>Hello {{name}},</p><p>Your account was signed in from a new device:</p><p>{{device}}<br>IP address: {{ip}}<br>{{time}}</p>"
     "<p>If this was not you, change your password and sign out all devices from Account settings.</p>",
     ["name", "device", "ip", "time", "app_name"]),
    ("auth.phone_otp", "sms", "Mobile verification code", None,
     "{{code}} is your {{app_name}} verification code. It expires in {{minutes}} minutes.", ["code", "minutes", "app_name"]),
    ("system.test_email", "email", "Test email", "Test email from {{app_name}}",
     "<p>This is a test message. Your email settings work.</p>", ["app_name"]),
    ("system.test_sms", "sms", "Test SMS", None, "Test message from {{app_name}}: your SMS settings work.", ["app_name"]),
    ("auth.account_exists", "email", "Registration with an existing account", "You already have a {{app_name}} account",
     "<p>Hello {{name}},</p><p>Someone (probably you) tried to register with this email address, but an account already exists.</p>"
     '<p><a class="btn" href="{{login}}">Sign in</a></p><p>Forgot your password? <a href="{{reset}}">Choose a new one</a>. '
     "If this was not you, no action is needed.</p>", ["name", "login", "reset", "app_name"]),
    ("alumni.verified", "email", "Profile verified", "Welcome to the {{app_name}} community",
     "<p>Hello {{name}},</p><p>Your alumni profile has been verified. You now have full access to the alumni directory, "
     "connections and community features.</p>"
     '<p><a class="btn" href="{{link}}">Open the alumni portal</a></p>', ["name", "link", "app_name"]),
    ("alumni.rejected", "email", "Verification not approved", "We could not verify your {{app_name}} profile",
     "<p>Hello {{name}},</p><p>We could not verify your profile yet:</p><blockquote>{{reason}}</blockquote>"
     '<p>You can correct your details or attach a supporting document and submit again.</p><p><a class="btn" href="{{link}}">Review my profile</a></p>',
     ["name", "reason", "link", "app_name"]),
    ("alumni.invite", "email", "Invitation from school records", "You are invited to {{app_name}}",
     "<p>Hello {{name}},</p><p>Your former school has invited you to join its alumni network. Your account is ready and "
     "already verified from school records — just choose a password.</p>"
     '<p><a class="btn" href="{{link}}">Set my password</a></p><p>The link is valid for {{days}} days.</p>',
     ["name", "link", "days", "app_name"]),
    ("alumni.connection_request", "email", "Connection request", "{{from}} wants to connect on {{app_name}}",
     "<p>Hello {{name}},</p><p><strong>{{from}}</strong> sent you a connection request.</p><p>{{message}}</p>"
     '<p><a class="btn" href="{{link}}">Reply</a></p>', ["name", "from", "message", "link", "app_name"]),
    ("alumni.connection_accepted", "email", "Connection accepted", "{{from}} accepted your connection request",
     "<p>Hello {{name}},</p><p><strong>{{from}}</strong> accepted your connection request.</p>"
     '<p><a class="btn" href="{{link}}">View profile</a></p>', ["name", "from", "link", "app_name"]),
    ("admin.new_registration", "email", "New registration (administrators)", "New registration: {{name}}",
     "<p>A new member registered and is waiting for verification.</p><p>{{name}} ({{email}})<br>{{kind}}, class of {{year}}<br>"
     "School records: {{match}}</p>"
     '<p><a class="btn" href="{{link}}">Open the verification queue</a></p>', ["name", "email", "kind", "year", "match", "link", "app_name"]),
]


def _t(key: str, name: str, subject: str, body: str, ph: list[str]) -> tuple:
    return (key, "email", name, subject, body, [*ph, "app_name"])


def _btn(label: str) -> str:
    return f'<p><a class="btn" href="{{{{link}}}}">{label}</a></p>'


DEFAULT_TEMPLATES += [
    # events
    _t("events.registered", "Event registration confirmed", "You're registered: {{event}}",
       "<p>Hello {{name}},</p><p>You are registered for <strong>{{event}}</strong> on {{when}} ({{where}}).</p>"
       "<p>Your ticket with its QR code is on the event page — show it at the entrance.</p>" + _btn("View my ticket"),
       ["name", "event", "when", "where", "link"]),
    _t("events.waitlisted", "Event waitlist", "You're on the waitlist: {{event}}",
       "<p>Hello {{name}},</p><p><strong>{{event}}</strong> ({{when}}) is full, so you are on the waitlist. "
       "We will email you as soon as a place frees up.</p>" + _btn("View event"), ["name", "event", "when", "where", "link"]),
    _t("events.promoted", "Waitlist place confirmed", "A place opened up: {{event}}",
       "<p>Hello {{name}},</p><p>Good news — a place opened up and you are now registered for <strong>{{event}}</strong> on {{when}}.</p>"
       + _btn("View my ticket"), ["name", "event", "when", "link"]),
    _t("events.cancelled", "Event cancelled", "Cancelled: {{event}}",
       "<p>Hello {{name}},</p><p>We are sorry — <strong>{{event}}</strong> has been cancelled.</p><blockquote>{{reason}}</blockquote>"
       + _btn("See other events"), ["name", "event", "reason", "link"]),
    _t("events.reminder", "Event reminder", "Tomorrow: {{event}}",
       "<p>Hello {{name}},</p><p>A reminder that <strong>{{event}}</strong> starts {{when}} ({{where}}).</p>" + _btn("Event details"),
       ["name", "event", "when", "where", "link"]),
    # jobs
    _t("jobs.application_received", "New job application (poster)", "New application: {{job}}",
       "<p>Hello {{name}},</p><p>{{applicant}} applied for <strong>{{job}}</strong>.</p>" + _btn("Review applications"),
       ["name", "applicant", "job", "link"]),
    _t("jobs.application_status", "Application status update", "Your application for {{job}}",
       "<p>Hello {{name}},</p><p>Your application for <strong>{{job}}</strong> at {{organization}} is now: <strong>{{status}}</strong>.</p>"
       + _btn("My applications"), ["name", "job", "organization", "status", "link"]),
    _t("jobs.approved", "Job approved", "Your job is live: {{job}}",
       "<p>Hello {{name}},</p><p><strong>{{job}}</strong> was approved and is now listed for alumni.</p>" + _btn("View job"),
       ["name", "job", "link"]),
    _t("jobs.rejected", "Job not approved", "Your job needs changes: {{job}}",
       "<p>Hello {{name}},</p><p><strong>{{job}}</strong> was not approved:</p><blockquote>{{reason}}</blockquote>"
       "<p>Edit the job and it will be reviewed again.</p>" + _btn("Edit job"), ["name", "job", "reason", "link"]),
    # mentorship
    _t("mentorship.request", "Mentorship request (mentor)", "{{from}} asked you for mentorship",
       "<p>Hello {{name}},</p><p>{{from}} would like your mentorship on <strong>{{topic}}</strong>.</p>" + _btn("Reply"),
       ["name", "from", "topic", "link"]),
    _t("mentorship.accepted", "Mentorship accepted", "{{mentor}} accepted your mentorship request",
       "<p>Hello {{name}},</p><p>{{mentor}} accepted your request.</p><p>{{note}}</p><p>Schedule your first session together.</p>"
       + _btn("Open mentorship"), ["name", "mentor", "note", "link"]),
    _t("mentorship.declined", "Mentorship declined", "Your mentorship request",
       "<p>Hello {{name}},</p><p>{{mentor}} cannot take on your request right now.</p><p>{{note}}</p><p>Other mentors may be able to help.</p>"
       + _btn("Find a mentor"), ["name", "mentor", "note", "link"]),
    _t("mentorship.cancelled", "Mentorship cancelled", "Mentorship cancelled: {{topic}}",
       "<p>Hello {{name}},</p><p>{{mentee}} cancelled the mentorship on <strong>{{topic}}</strong>.</p>" + _btn("Mentorship"),
       ["name", "mentee", "topic", "link"]),
    _t("mentorship.completed", "Mentorship completed", "Mentorship completed: {{topic}}",
       "<p>Hello {{name}},</p><p>{{by}} marked the mentorship on <strong>{{topic}}</strong> as completed. Please share your feedback.</p>"
       + _btn("Leave feedback"), ["name", "by", "topic", "link"]),
    _t("mentorship.session", "Mentorship session scheduled", "Mentoring session on {{when}}",
       "<p>Hello {{name}},</p><p>{{by}} scheduled a {{format}} session on {{when}}.</p>" + _btn("Session details"),
       ["name", "by", "when", "format", "link"]),
    _t("mentorship.mentor_approved", "Mentor application approved", "You are now a mentor",
       "<p>Hello {{name}},</p><p>Your mentor application was approved — alumni and students can now request your mentorship.</p>"
       + _btn("Mentorship"), ["name", "link"]),
    _t("mentorship.mentor_rejected", "Mentor application not approved", "Your mentor application",
       "<p>Hello {{name}},</p><p>Your mentor application was not approved:</p><blockquote>{{reason}}</blockquote>" + _btn("Update application"),
       ["name", "reason", "link"]),
    # achievements
    _t("achievements.published", "Achievement published", "Congratulations — {{kind}}",
       "<p>Hello {{name}},</p><p>Your achievement “{{title}}” is now featured in the alumni portal.</p>"
       "<p>Would you like it to appear on the public website too? You can choose on the achievement page.</p>" + _btn("View and choose"),
       ["name", "title", "kind", "link"]),
]
