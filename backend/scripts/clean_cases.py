"""One-shot: strip 'scoring_criteria' from all case JSON files."""

from __future__ import annotations

import json
from pathlib import Path

CASES_DIR = Path(__file__).resolve().parent.parent / "data" / "cases"


def clean_all_cases() -> None:
    changes = []
    for fpath in sorted(CASES_DIR.glob("*.json")):
        text = fpath.read_text(encoding="utf-8")
        data = json.loads(text)
        modified = False

        for key in ("scoring_criteria", "capabilities"):
            if key in data:
                del data[key]
                modified = True

        # clean deep_background dups
        if "deep_background" in data:
            db = data["deep_background"]
            if isinstance(db, dict):
                cleaned = {k: v for k, v in db.items() if len(k) <= 8}
                if len(cleaned) != len(db):
                    data["deep_background"] = cleaned
                    modified = True

        # remove training_type (redundant in case_data, stored on model column)
        if "training_type" in data:
            del data["training_type"]
            modified = True

        if modified:
            fpath.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            changes.append(f"{fpath.name}: cleaned")

    print("\n".join(changes) if changes else "All cases already clean.")


if __name__ == "__main__":
    clean_all_cases()
