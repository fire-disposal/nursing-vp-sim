import json
from pathlib import Path


def infer_mood(p):
    if p.get("anxiety_trait") == "anxious":
        return "fearful" if p.get("patience") == "normal" else "irritable"
    if p.get("anxiety_trait") == "calm":
        return "neutral"
    return "neutral"


def infer_compliance(p):
    if p.get("patience") == "low":
        return "resistant"
    if p.get("health_literacy") == "low":
        return "dependent"
    return "normal"


def main():
    for fp in sorted(Path("data/cases").glob("*.json")):
        d = json.loads(fp.read_text("utf-8"))
        p = d.get("personality")
        if not p:
            continue
        p.setdefault("mood", infer_mood(p))
        p.setdefault("compliance", infer_compliance(p))
        fp.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"  {fp.name}: mood={p['mood']} compliance={p['compliance']}")


if __name__ == "__main__":
    main()
