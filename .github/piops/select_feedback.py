#!/usr/bin/env python3
"""Select one feedback record from the bounded bot API response."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: select_feedback.py INPUT FEEDBACK_ID OUTPUT")

    source, raw_id, output = sys.argv[1:]
    feedback_id = int(raw_id)
    payload = json.loads(Path(source).read_text(encoding="utf-8"))
    items = payload.get("items", []) if isinstance(payload, dict) else []
    if not isinstance(items, list):
        raise SystemExit("feedback response has no items list")

    match = next((item for item in items if isinstance(item, dict) and item.get("id") == feedback_id), None)
    if match is None:
        raise SystemExit(f"feedback {feedback_id} not found in bounded response")

    allowed = {
        "id",
        "rating",
        "tag",
        "content",
        "version",
        "developer_reply",
        "created_at",
        "replied_at",
        "auto_fix_attempted",
        "auto_fix_at",
    }
    cleaned: dict[str, Any] = {key: value for key, value in match.items() if key in allowed}
    Path(output).write_text(
        json.dumps({"feedback": cleaned}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
