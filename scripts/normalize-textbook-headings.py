"""Normalize textbook headings: 第X节 → ##, all others → ###."""
import re
import sys
from pathlib import Path

BOOKS = ["内科护理学", "外科护理学", "新编护理学基础"]
TEXTBOOKS_DIR = Path(__file__).resolve().parent.parent / "backend" / "data" / "textbooks"

SECTION_PAT = re.compile(r"^#\s+第[一二三四五六七八九十百\d]+节")

def normalize_file(filepath: Path) -> int:
    lines = filepath.read_text(encoding="utf-8").split("\n")
    changed = 0
    new_lines = []
    for line in lines:
        if line.startswith("# "):
            if SECTION_PAT.match(line):
                new_lines.append("##" + line[1:])
            else:
                new_lines.append("###" + line[1:])
            changed += 1
        else:
            new_lines.append(line)
    if changed:
        filepath.write_text("\n".join(new_lines), encoding="utf-8")
    return changed


def main():
    if not TEXTBOOKS_DIR.is_dir():
        print(f"ERROR: textbooks dir not found: {TEXTBOOKS_DIR}", file=sys.stderr)
        sys.exit(1)
    total = 0
    for book in BOOKS:
        book_dir = TEXTBOOKS_DIR / book
        if not book_dir.is_dir():
            print(f"WARN: not found: {book_dir}")
            continue
        for md in sorted(book_dir.rglob("*.md")):
            n = normalize_file(md)
            if n:
                print(f"  {md.relative_to(TEXTBOOKS_DIR)}: {n} headings")
            total += n
    print(f"\nDone: {total} headings normalised across {len(BOOKS)} books")


if __name__ == "__main__":
    main()
