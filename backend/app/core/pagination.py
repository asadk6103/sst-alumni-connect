import csv
import io
from collections.abc import Iterable

from fastapi import Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession


class PageParams(BaseModel):
    page: int = 1
    page_size: int = 20


def page_params(page: int = Query(1, ge=1, le=100000), page_size: int = Query(20, ge=1, le=100)) -> PageParams:
    return PageParams(page=page, page_size=page_size)


async def paginate(db: AsyncSession, stmt: Select, p: PageParams):
    total = (await db.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))).scalar_one()
    rows = (await db.execute(stmt.offset((p.page - 1) * p.page_size).limit(p.page_size))).scalars().all()
    pages = max(1, -(-total // p.page_size))
    return rows, {"page": p.page, "page_size": p.page_size, "total": total, "pages": pages}


def csv_response(filename: str, header: list[str], rows: Iterable[list]) -> StreamingResponse:
    def gen():
        buf = io.StringIO()
        w = csv.writer(buf)
        buf.write("﻿")  # Excel-friendly UTF-8
        w.writerow(header)
        yield buf.getvalue()
        for r in rows:
            buf.seek(0)
            buf.truncate()
            # neutralise spreadsheet formula injection
            w.writerow([("'" + v) if isinstance(v, str) and v[:1] in ("=", "+", "-", "@") else v for v in r])
            yield buf.getvalue()

    return StreamingResponse(gen(), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})
