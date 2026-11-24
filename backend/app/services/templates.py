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
]
