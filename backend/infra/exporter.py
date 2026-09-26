"""Generic export engine — format-agnostic, reusable tabular export."""

import csv
import io
from abc import ABC, abstractmethod
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Generic, TypeVar
from urllib.parse import quote

from fastapi import HTTPException, Request
from fastapi.responses import Response

T = TypeVar("T")


@dataclass
class ColumnDef(Generic[T]):
    """Column: header + key (attribute/dict-key) or value (callable on item) + optional fmt."""

    header: str
    key: str = ""
    value: Callable[[T], Any] | None = None
    fmt: Callable[[Any], str | None] | None = None

    def _resolve(self, item: T) -> Any:
        if self.value is not None:
            return self.value(item)
        return getattr(item, self.key, None)


def _sanitize_csv(val: str | None) -> str:
    if val is None:
        return ""
    if val and val[0] in ("=", "+", "-", "@"):
        return "'" + val
    return val


class Exporter(ABC, Generic[T]):
    """Base export engine."""

    @abstractmethod
    def export(self, items: Sequence[T], columns: list[ColumnDef[T]], title: str = "") -> bytes: ...


class CSVExporter(Exporter[T]):
    """Export to CSV (UTF-8 BOM)."""

    def export(self, items: Sequence[T], columns: list[ColumnDef[T]], title: str = "") -> bytes:
        buf = io.StringIO()
        # utf-8-sig 编码自带 BOM；这里显式再写一个会造成双 BOM，Excel 首格会多出不可见字符
        w = csv.writer(buf)
        w.writerow([c.header for c in columns])
        for item in items:
            row = []
            for c in columns:
                raw = c._resolve(item)
                if raw is None:
                    row.append("")
                elif c.fmt:
                    row.append(_sanitize_csv(c.fmt(raw)))
                else:
                    row.append(_sanitize_csv(str(raw)))
            w.writerow(row)
        return buf.getvalue().encode("utf-8-sig")


class XLSXExporter(Exporter[T]):
    """Export to .xlsx with styled header row and auto column widths."""

    _HEADER_FILL = "2563EB"

    def __init__(self, column_width: int = 18):
        self._col_width = column_width

    def export(self, items: Sequence[T], columns: list[ColumnDef[T]], title: str = "") -> bytes:
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter

        wb = Workbook()
        ws = wb.active
        ws.title = (title or "Sheet1")[:31]

        hfont = Font(bold=True, color="FFFFFF")
        hfill = PatternFill(start_color=self._HEADER_FILL, end_color=self._HEADER_FILL, fill_type="solid")
        halign = Alignment(horizontal="center")

        for ci, c in enumerate(columns, 1):
            cell = ws.cell(row=1, column=ci, value=c.header)
            cell.font = hfont
            cell.fill = hfill
            cell.alignment = halign

        for ri, item in enumerate(items, 2):
            for ci, c in enumerate(columns, 1):
                raw = c._resolve(item)
                if raw is None:
                    val = ""
                elif c.fmt:
                    val = c.fmt(raw)
                else:
                    val = raw
                ws.cell(row=ri, column=ci, value=val)

        for ci in range(1, len(columns) + 1):
            ws.column_dimensions[get_column_letter(ci)].width = self._col_width

        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()


@dataclass(slots=True)
class ExportAudit:
    """导出留痕上下文：谁、导了什么、多少行、按什么筛选。

    用**独立 session** 落库（见 core/audit.record_detached）：导出发生在请求里，而导出端点
    没有 unit_of_work —— 若走请求事务，行会随会话关闭一起丢掉；而"数据被导出带走"这件事
    恰恰是最需要留下的证据（2026-09-26 审计 A4）。
    """

    request: Request | None
    target_label: str
    filters: dict[str, Any] | None = None


def export_response(
    items: Sequence[T],
    columns: list[ColumnDef[T]],
    filename: str,
    title: str = "",
    format: str = "csv",
    *,
    audit: ExportAudit | None = None,
) -> Response:
    """Build a FastAPI Response exporting *items* in the given *format* (csv|xlsx).

    **取数约定**（导出端点一律照此写，不要各写各的上限）：
    - 调用方按 `core.config.MAX_EXPORT_ROWS + 1` 取数 —— 多取那条就是为了在这里命中判定；
    - 超限由本函数统一 400（不静默截断），因此服务层不得再写死别的魔数上限；
    - 真正天然有界的导出（单个作业的学生名单、单个模板的答卷）可不带上限，但在调用处注明理由。
    - `audit` 非空时记录一行 `export.downloaded`（含行数/格式/筛选），且只在**判定通过之后**记
      —— 被 400 拒掉的超限导出不该留下"已导出"的记录。
    """
    from core.audit import ACTION_EXPORT_DOWNLOADED, TARGET_TYPE_EXPORT, record_detached
    from core.config import MAX_EXPORT_ROWS

    if len(items) > MAX_EXPORT_ROWS:
        raise HTTPException(status_code=400, detail=f"单次导出最多 {MAX_EXPORT_ROWS} 行")
    if audit is not None:
        record_detached(
            audit.request,
            action=ACTION_EXPORT_DOWNLOADED,
            target_type=TARGET_TYPE_EXPORT,
            target_label=audit.target_label,
            payload={"rows": len(items), "format": format, "filters": audit.filters or {}},
        )
    ext = format
    encoded = quote(filename)
    disposition = f"attachment; filename*=UTF-8''{encoded}.{ext}"

    if format == "xlsx":
        content = XLSXExporter().export(items, columns, title or filename)
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        content = CSVExporter().export(items, columns, title or filename)
        media_type = "text/csv; charset=utf-8-sig"
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": disposition})
