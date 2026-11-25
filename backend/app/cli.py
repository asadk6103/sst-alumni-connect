"""Operator commands (run inside the api container):

python -m app.cli setup-code                  show the first-run setup code
python -m app.cli create-admin EMAIL "NAME"   create a Super Administrator (prompts for a password)
python -m app.cli reset-password EMAIL        set a new password (prompts) and sign the user out
python -m app.cli reset-mfa EMAIL             turn off two-factor authentication for a user
python -m app.cli rotate-key jwt|encryption   rotate a key (jwt: signs everyone out)
"""

import asyncio
import getpass
import sys
from datetime import UTC, datetime

from sqlalchemy import func, select

from .core import secrets, settings_store
from .core.db import SessionLocal, engine
from .core.permissions import SUPER_ADMIN
from .core.security import hash_password
from .core.settings_schemas import password_problems
from .models import Role, User


def _password() -> str:
    pw = getpass.getpass("New password: ")
    if pw != getpass.getpass("Repeat password: "):
        sys.exit("Passwords do not match.")
    return pw


async def _user(db, email: str) -> User:
    u = (await db.execute(select(User).where(func.lower(User.email) == email.lower(), User.deleted_at.is_(None)))).scalar_one_or_none()
    if not u:
        sys.exit(f"No user with email {email}.")
    return u


async def main(argv: list[str]) -> None:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return
    cmd, args = argv[0], argv[1:]
    async with SessionLocal() as db:
        if cmd == "setup-code":
            if await settings_store.is_installed(db):
                print("Installation is complete; there is no setup code.")
            else:
                print(secrets.ensure_setup_code())
        elif cmd == "create-admin" and len(args) == 2:
            email, name = args
            if (await db.execute(select(User.id).where(func.lower(User.email) == email.lower(), User.deleted_at.is_(None)))).first():
                sys.exit("A user with this email already exists.")
            pw = _password()
            sec = await settings_store.get_group(db, "security")
            if problems := password_problems(pw, sec):
                sys.exit("Password must contain " + ", ".join(problems) + ".")
            role = (await db.execute(select(Role).where(Role.key == SUPER_ADMIN))).scalar_one()
            now = datetime.now(UTC)
            db.add(
                User(
                    email=email.lower(),
                    full_name=name,
                    password_hash=hash_password(pw),
                    status="active",
                    email_verified_at=now,
                    password_changed_at=now,
                    roles=[role],
                )
            )
            await db.commit()
            print(f"Created Super Administrator {email}.")
        elif cmd == "reset-password" and len(args) == 1:
            u = await _user(db, args[0])
            pw = _password()
            sec = await settings_store.get_group(db, "security")
            if problems := password_problems(pw, sec):
                sys.exit("Password must contain " + ", ".join(problems) + ".")
            from .modules.auth.service import revoke_all

            u.password_hash, u.password_changed_at, u.locked_until = hash_password(pw), datetime.now(UTC), None
            await revoke_all(db, u.id)
            await db.commit()
            print(f"Password updated for {u.email}; all sessions ended.")
        elif cmd == "reset-mfa" and len(args) == 1:
            u = await _user(db, args[0])
            u.totp_enabled, u.totp_secret_enc, u.recovery_codes = False, None, None
            await db.commit()
            print(f"Two-factor authentication turned off for {u.email}.")
        elif cmd == "rotate-key" and args and args[0] in ("jwt", "encryption"):
            if args[0] == "encryption" and "--force" not in args:
                sys.exit(
                    "Rotating the encryption key makes stored integration secrets and two-factor secrets "
                    "unreadable (they must be re-entered). Run again with --force to proceed."
                )
            secrets.rotate("jwt_signing_key" if args[0] == "jwt" else "encryption_key")
            print("Key rotated. Restart the api and realtime containers.")
        else:
            print(__doc__)
            sys.exit(2)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
