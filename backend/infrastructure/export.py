"""Unified CSV export utility — BOM, streaming, buffered, response building."""

import csv
import io
from collections.abc import Callable, Generator
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

from fastapi.responses import Response, StreamingResponse


@dataclass
class Column:
    """Column definition: header label + value extractor."""

    header: str
    value: Callable[[Any], str | None]


def _encode_bom() -> str:
    return "\ufeff"


def _make_writer(buf: io.StringIO) -> csv.writer:
    return csv.writer(buf)


def _build_rows(items: list[Any], columns: list[Column]) -> Generator[list[str]]:
    """Yield header row then data rows."""
    yield [col.header for col in columns]
    for item in items:
        yield [col.value(item) or "" for col in columns]


def buffer_to_stringio(items: list[Any], columns: list[Column]) -> io.StringIO:
    """Buffer all rows into a StringIO. Caller reads via .getvalue()."""
    buf = io.StringIO()
    buf.write(_encode_bom())
    writer = _make_writer(buf)
    for row in _build_rows(items, columns):
        writer.writerow(row)
    buf.seek(0)
    return buf


def stream_response(
    items: list[Any],
    columns: list[Column],
    filename: str,
) -> StreamingResponse:
    """Stream CSV rows one at a time via generator (for large datasets)."""

    def generate() -> Generator[str]:
        buf = io.StringIO()
        writer = _make_writer(buf)
        buf.write(_encode_bom())
        writer.writerow([col.header for col in columns])
        yield buf.getvalue()
        buf.truncate(0)
        buf.seek(0)
        for item in items:
            writer.writerow([col.value(item) or "" for col in columns])
            yield buf.getvalue()
            buf.truncate(0)
            buf.seek(0)

    encoded_filename = quote(filename)
    return StreamingResponse(
        generate(),
        media_type="text/csv; charset=utf-8-sig",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
        },
    )


def buffered_response(
    items: list[Any],
    columns: list[Column],
    filename: str,
) -> Response:
    """Buffer all rows and return a single Response."""
    buf = buffer_to_stringio(items, columns)
    content = buf.getvalue().encode("utf-8-sig")
    buf.close()
    encoded_filename = quote(filename)
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8-sig",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
        },
    )
