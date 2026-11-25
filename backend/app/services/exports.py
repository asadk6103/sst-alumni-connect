"""Small dependency-free writers for report exports: Excel (.xlsx) and PDF tables.

They cover what reports need — a title, a header row and data rows — and nothing more. PDF text uses the
standard Helvetica font (Latin-1); characters outside it are replaced, which matters only for free-text values.
"""

import io
import zipfile
from datetime import UTC, datetime
from xml.sax.saxutils import escape


# ── Excel ───────────────────────────────────────────────────────────────────
def _col(n: int) -> str:
    s = ""
    n += 1
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def _cell(ref: str, v, style: int = 0) -> str:
    st = f' s="{style}"' if style else ""
    if isinstance(v, bool):
        return f'<c r="{ref}" t="b"{st}><v>{int(v)}</v></c>'
    if isinstance(v, int | float) and v == v:
        return f'<c r="{ref}"{st}><v>{v}</v></c>'
    text = "" if v is None else str(v)
    # Formula injection guard: a leading =,+,-,@ would be evaluated by spreadsheet apps.
    if text[:1] in ("=", "+", "-", "@") and not _is_number(text):
        text = "'" + text
    text = "".join(ch for ch in text if ch in "\t\n\r" or ord(ch) >= 32)
    return f'<c r="{ref}" t="inlineStr"{st}><is><t xml:space="preserve">{escape(text)}</t></is></c>'


def _is_number(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False


def xlsx(title: str, header: list[str], rows: list[list], subtitle: str = "") -> bytes:
    lines = [[title], [subtitle] if subtitle else [], [], header, *rows]
    widths = [min(60, max(10, *(len(str(r[i])) + 2 for r in [header, *rows] if i < len(r)))) for i in range(len(header))]
    sheet_rows = []
    for ri, row in enumerate(lines, start=1):
        if not row:
            continue
        style = 1 if ri == 1 or ri == 4 else 0
        cells = "".join(_cell(f"{_col(ci)}{ri}", v, style) for ci, v in enumerate(row))
        sheet_rows.append(f'<row r="{ri}">{cells}</row>')
    cols = "".join(f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>' for i, w in enumerate(widths))
    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        f'<cols>{cols}</cols><sheetData>{"".join(sheet_rows)}</sheetData></worksheet>'
    )
    name = escape("".join(c for c in title if c not in "[]:*?/\\")[:31] or "Report")
    files = {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        "</Types>",
        "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>",
        "xl/workbook.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets><sheet name="{name}" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        "</Relationships>",
        "xl/styles.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
        '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>'
        '<cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>',
        "xl/worksheets/sheet1.xml": sheet,
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for path, content in files.items():
            z.writestr(path, content)
    return buf.getvalue()


# ── PDF ─────────────────────────────────────────────────────────────────────
def _pdf_text(s) -> str:
    t = ("" if s is None else str(s)).encode("latin-1", "replace").decode("latin-1")
    return t.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)").replace("\r", " ").replace("\n", " ")


def _fit(text: str, width: float, size: float) -> str:
    max_chars = max(3, int(width / (size * 0.5)))
    return text if len(text) <= max_chars else text[: max_chars - 1] + "…".encode("latin-1", "replace").decode("latin-1")


def pdf(
    title: str, header: list[str], rows: list[list], subtitle: str = "", summary: list[tuple[str, str]] | None = None, institution: str = ""
) -> bytes:
    """A4 landscape table report with a title block, optional summary figures and page numbers."""
    W, H, M = 842.0, 595.0, 36.0
    size, line = 9.0, 16.0
    usable = W - 2 * M
    n = max(1, len(header))
    lens = [max([len(str(header[i]))] + [len(str(r[i])) for r in rows[:500] if i < len(r)]) for i in range(n)]
    total = sum(min(max(x, 4), 40) for x in lens)
    widths = [usable * min(max(x, 4), 40) / total for x in lens]
    numeric = [all(isinstance(r[i], int | float) for r in rows if i < len(r) and r[i] not in (None, "")) and rows for i in range(n)]
    stamp = datetime.now(UTC).strftime("%d %b %Y %H:%M UTC")

    pages: list[list[str]] = []
    ops: list[str] = []

    def text(x, y, s, sz=size, bold=False, gray=False):
        color = "0.4 0.45 0.5 rg" if gray else "0.07 0.1 0.2 rg"
        ops.append(f"BT {color} /{'F2' if bold else 'F1'} {sz} Tf {x:.1f} {y:.1f} Td ({_pdf_text(s)}) Tj ET")

    def header_row(y):
        ops.append(f"0.93 0.92 0.98 rg {M:.1f} {y - 4:.1f} {usable:.1f} {line:.1f} re f")
        x = M
        for i, h in enumerate(header):
            text(x + 4, y + 1, _fit(str(h), widths[i] - 8, size), bold=True)
            x += widths[i]

    def new_page(first: bool) -> float:
        nonlocal ops
        if ops:
            pages.append(ops)
        ops = []
        y = H - M
        if first:
            if institution:
                text(M, y - 2, institution, 9, gray=True)
                y -= 16
            text(M, y - 14, title, 18, bold=True)
            y -= 32
            if subtitle:
                text(M, y - 4, subtitle, 10, gray=True)
                y -= 18
            if summary:
                x = M
                for label, value in summary[:6]:
                    text(x, y - 14, value, 14, bold=True)
                    text(x, y - 28, label, 8, gray=True)
                    x += usable / min(6, len(summary))
                y -= 44
            y -= 8
        else:
            text(M, y - 8, title, 10, bold=True)
            y -= 24
        header_row(y - line)
        return y - 2 * line

    y = new_page(True)
    for ri, r in enumerate(rows):
        if y < M + line:
            y = new_page(False)
        if ri % 2:
            ops.append(f"0.97 0.97 0.98 rg {M:.1f} {y - 4:.1f} {usable:.1f} {line:.1f} re f")
        x = M
        for i in range(n):
            v = r[i] if i < len(r) else ""
            s = (
                f"{v:,}"
                if isinstance(v, int) and not isinstance(v, bool)
                else (f"{v:,.2f}" if isinstance(v, float) else str(v if v is not None else ""))
            )
            s = _fit(s, widths[i] - 8, size)
            tx = x + widths[i] - 4 - len(s) * size * 0.5 if numeric[i] else x + 4
            text(tx, y + 1, s)
            x += widths[i]
        y -= line
    if not rows:
        text(M + 4, y + 1, "No data for the selected period.", gray=True)
    pages.append(ops)

    objs: list[bytes] = []
    total_pages = len(pages)
    kids = " ".join(f"{5 + i * 2} 0 R" for i in range(total_pages))
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {total_pages} >>".encode())
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    for i, page_ops in enumerate(pages):
        footer = (
            f"BT 0.4 0.45 0.5 rg /F1 8 Tf {M:.1f} 20 Td (Generated {stamp}) Tj ET "
            f"BT 0.4 0.45 0.5 rg /F1 8 Tf {W - M - 60:.1f} 20 Td (Page {i + 1} of {total_pages}) Tj ET"
        )
        stream = ("\n".join(page_ops) + "\n" + footer).encode("latin-1", "replace")
        objs.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W:.0f} {H:.0f}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> "
            f"/Contents {6 + i * 2} 0 R >>".encode()
        )
        objs.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n".encode() + body + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode())
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()
