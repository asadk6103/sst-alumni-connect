"""Alembic environment: uses DATABASE_URL from the infrastructure settings (async engine)."""

import asyncio
from logging.config import fileConfig

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from alembic import context
from app.core.config import infra
from app.models import Base

if context.config.config_file_name:
    fileConfig(context.config.config_file_name)
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(url=infra().database_url, target_metadata=target_metadata, literal_binds=True, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


def _run(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(infra().database_url, poolclass=NullPool)
    async with engine.connect() as conn:
        # Several API replicas may start together: only one migrates at a time.
        await conn.execute(text("SELECT pg_advisory_lock(7312003)"))
        try:
            await conn.run_sync(_run)
            await conn.commit()
        finally:
            await conn.execute(text("SELECT pg_advisory_unlock(7312003)"))
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
