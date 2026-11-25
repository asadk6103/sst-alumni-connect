"""Generate docs/ERD.md from the SQLAlchemy models: one Mermaid diagram per domain plus a column reference.

    uv run python scripts/gen_erd.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models import Base  # noqa: E402

DOMAINS = {
    "Identity, access and configuration": ["identity", "config"],
    "Alumni core": ["alumni"],
    "Community and messaging": ["community", "messaging"],
    "Events, careers, mentorship, achievements": ["engagement"],
    "Institutional support": ["institutional"],
    "Administration and privacy": ["administration"],
}


def module_of(table) -> str:
    for mapper in Base.registry.mappers:
        if mapper.local_table is table:
            return mapper.class_.__module__.rsplit(".", 1)[-1]
    return "identity"  # association tables (user_roles, role_permissions)


def col_type(c) -> str:
    t = c.type.__class__.__name__.lower()
    return {"varchar": "string", "string": "string", "text": "text", "uuid": "uuid", "integer": "int", "biginteger": "bigint",
            "boolean": "bool", "datetime": "timestamptz", "date": "date", "numeric": "numeric", "jsonb": "jsonb", "array": "array",
            "tsvector": "tsvector", "inet": "inet"}.get(t, t)


def main() -> None:
    tables = sorted(Base.metadata.tables.values(), key=lambda t: t.name)
    by_domain: dict[str, list] = {d: [] for d in DOMAINS}
    for t in tables:
        mod = module_of(t)
        for d, mods in DOMAINS.items():
            if mod in mods:
                by_domain[d].append(t)
                break
    out = ["# Database ERD", "", "Generated from the SQLAlchemy models by `backend/scripts/gen_erd.py` — do not edit by hand.",
           f"{len(tables)} tables in PostgreSQL. Diagrams show keys and relations; the reference lists every column.", ""]
    for domain, ts in by_domain.items():
        if not ts:
            continue
        names = {t.name for t in ts}
        out += [f"## {domain}", "", "```mermaid", "erDiagram"]
        for t in ts:
            out.append(f"  {t.name} {{")
            for c in t.columns:
                keys = ["PK"] if c.primary_key else []
                if c.foreign_keys:
                    keys.append("FK")
                if keys or c.name in ("status", "kind", "slug", "email", "title", "name"):
                    out.append(f"    {col_type(c)} {c.name}{' ' + ','.join(keys) if keys else ''}")
            out.append("  }")
        for t in ts:
            for fk in t.foreign_keys:
                target = fk.column.table.name
                if target == t.name or (target not in names and target != "users"):
                    continue
                if target == "users" and "users" not in names:
                    continue
                out.append(f'  {target} ||--o{{ {t.name} : "{fk.parent.name}"')
        out += ["```", ""]
    out += ["## Column reference", ""]
    for t in tables:
        out += [f"### {t.name}", "", "| Column | Type | Null | Key / reference |", "|---|---|---|---|"]
        for c in t.columns:
            ref = ", ".join(f"→ {fk.column.table.name}.{fk.column.name}" for fk in c.foreign_keys)
            key = "PK" if c.primary_key else ""
            out.append(f"| {c.name} | {col_type(c)} | {'yes' if c.nullable else 'no'} | {' '.join(x for x in (key, ref) if x)} |")
        out.append("")
    path = Path(__file__).resolve().parents[2] / "docs" / "ERD.md"
    path.write_text("\n".join(out), encoding="utf-8")
    print(f"wrote {path} ({len(tables)} tables)")


if __name__ == "__main__":
    main()
