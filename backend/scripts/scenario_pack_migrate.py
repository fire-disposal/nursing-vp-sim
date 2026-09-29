"""五包 v1/v2 → v3 迁移（docs/23 §9.4）：**先 dry-run 看差异，再 --apply**。

做三件事，每一件都可解释、都不静默丢东西：

1. 形状转换 `pack_loader.convert_legacy`（锚点 → 教学关注点；`unlocks` → 等价的 `visible_when`；
   `blocked_by`/`cue`/`deadline_turns`/`stage` 各产出一条说明）；
2. **作者审阅项**（本文件的两张表）：人物可写状态 `Actor.dm_writable`、动作对象 `Affordance.targets`；
3. 校验（加载期同一套）通过后：`--apply` 写回 `packs/*.json` **并**在库里追加新修订。

用法：
    cd backend && uv run python -m scripts.scenario_pack_migrate --dry-run
    cd backend && uv run python -m scripts.scenario_pack_migrate --apply [--expect-db NAME] [--only key]
"""

from __future__ import annotations

import argparse
import copy
import json
import pathlib
import re
from typing import Any

from core.config import DATABASE_URL
from core.database import SessionLocal
from core.unit_of_work import unit_of_work
from modules.scenario_training import pack_loader
from modules.scenario_training.pack_loader import PACKS_DIR, PackInvalid
from modules.scenario_training.schema import ScenarioPack

# --------------------------------------------------------------------------- #
# 作者审阅项（评审后手工定稿；不自动推导）
# --------------------------------------------------------------------------- #

#: 人物关系变量 → DM 可提议的小幅改动（`docs/23 §5.1`）。
#: **只收人物关系**（信任/防备/耐心/舒适）；临床数值、意识、气道是否通畅、场景事实一律不收。
PERSON_STATE: dict[str, list[dict[str, Any]]] = {
    "bp-contradiction": [
        {
            "key": "patient.trust",
            "kind": "int",
            "lo": 0,
            "hi": 5,
            "max_delta": 1,
            "meaning": "患者对你这个人的信任程度：愿意听你说、也愿意配合核对",
        },
        {
            "key": "patient.guarded",
            "kind": "bool",
            "meaning": "他是否处于防备状态（不愿多说、把话题挡回去）",
        },
    ],
    "night-call-decision": [
        {
            "key": "nurse.patience",
            "kind": "int",
            "lo": 0,
            "hi": 5,
            "max_delta": 1,
            "meaning": "电话那头护士还愿意为你重复核对的耐心",
        },
    ],
    "sputum-ineffective": [
        {
            "key": "patient.comfort",
            "kind": "int",
            "lo": 0,
            "hi": 5,
            "max_delta": 1,
            "meaning": "患者的舒适与配合程度（喘得厉害时会更差）",
        },
    ],
    "triage-hidden-bleed": [
        {
            "key": "patient.comfort",
            "kind": "int",
            "lo": 0,
            "hi": 5,
            "max_delta": 1,
            "meaning": "患者的舒适与配合程度（疼得厉害时会更差）",
        },
    ],
    "two-beds-priority": [
        {
            "key": "bed_a.comfort",
            "kind": "int",
            "lo": 0,
            "hi": 5,
            "max_delta": 2,
            "meaning": "A 床患者的舒适与配合程度",
        },
        {
            "key": "bed_b.comfort",
            "kind": "int",
            "lo": 0,
            "hi": 5,
            "max_delta": 1,
            "meaning": "B 床患者的舒适与配合程度",
        },
    ],
}

#: **时间代价**（`time_cost`，情境时间单位；0 = 瞬时）。判据：真的占用时间或专精的处置/等待；
#: **不确定就给 0**（纯交流刷信息已被防刷不变量挡住）。刻意等待也用这里表达（宁少不多）。
TIME_COST: dict[str, dict[str, int]] = {
    "sputum-ineffective": {"suction": 2, "bag_valve": 2, "reposition": 2, "call_doctor": 2, "increase_o2": 1},
    "two-beds-priority": {
        "visit_a": 1,
        "visit_b": 1,
        "reassure_a": 1,
        "analgesia_a": 2,
        "oxygen_b": 2,
        "call_doctor": 2,
    },
    # bp-contradiction：旧形状（v1/v2）只有问/量/记，全都不花时间；耗时动作「静息 5 分钟后再测」
    # 是**新加的 v3 内容**（pack 文件里 `time_cost=5`）——旧形状转换表管不到不存在的 affordance，
    # 所以这里留空，但该包已经有时间推进途径。
    "bp-contradiction": {},
    "triage-hidden-bleed": {"triage_red": 1, "triage_yellow": 1, "triage_ortho": 1, "triage_home": 1},
    "night-call-decision": {
        "order_tests": 3,  # 下检查并等回报
        "hold_observation": 3,  # 刻意等待（留观复测）
        "order_support": 2,
        "order_escalate": 2,
    },
}

#: 动作对象（`Affordance.targets`）：只在**本包确实有多个同类对象**时声明，
#: 让平台能拦住"静默换人"。单目标的动作由平台自动绑定，不会增加操作负担。
TARGETS: dict[str, dict[str, list[tuple[str, str]]]] = {
    "two-beds-priority": {
        "visit_a": [("actor", "bed_a")],
        "visit_b": [("actor", "bed_b")],
        "measure_a": [("actor", "bed_a")],
        "measure_b": [("actor", "bed_b")],
        "reassure_a": [("actor", "bed_a"), ("actor", "family_a")],
        "analgesia_a": [("actor", "bed_a")],
        "oxygen_b": [("actor", "bed_b")],
    },
    "bp-contradiction": {
        "measure_bp": [("actor", "patient")],
        "measure_bp_again": [("actor", "patient")],
        "ask_history": [("actor", "patient")],
        "ask_meds": [("actor", "patient")],
    },
    "sputum-ineffective": {
        "suction": [("actor", "patient")],
        "auscultate": [("actor", "patient")],
        "measure_spo2": [("actor", "patient")],
        "increase_o2": [("actor", "patient")],
        "bag_valve": [("actor", "patient")],
        "reposition": [("actor", "patient")],
    },
    "triage-hidden-bleed": {
        "measure_vitals": [("actor", "patient")],
        "ask_trauma": [("actor", "patient")],
        "observe_abdomen": [("actor", "patient")],
    },
    "night-call-decision": {
        "ask_vitals": [("actor", "nurse")],
        "ask_abdomen": [("actor", "nurse")],
        "ask_urine": [("actor", "nurse")],
        "ask_history": [("actor", "nurse")],
        "order_tests": [("actor", "nurse")],
        "hold_observation": [("actor", "nurse")],
        "order_support": [("actor", "nurse")],
        "order_escalate": [("actor", "nurse")],
    },
}


def _apply_person_state(out: dict[str, Any], key: str, notes: list[str]) -> None:
    """把作者审阅的人物关系变量并进包的 `dm_writable`。"""
    state = PERSON_STATE.get(key)
    if state is None:
        return
    actors = {actor["id"]: actor for actor in out.get("actors") or []}
    for item in state:
        owner = str(item["key"]).split(".", 1)[0]
        actor = actors.get(owner)
        if actor is None:
            notes.append(f"人物状态 {item['key']} 的所属角色 {owner} 不存在，已跳过")
            continue
        existing = {entry.get("key") for entry in actor.get("dm_writable") or []}
        if item["key"] in existing:
            continue
        actor.setdefault("dm_writable", []).append(dict(item))
    if state:
        notes.append(f"人物可写状态：新增 {[item['key'] for item in state]}（临床数值/意识/气道一律未纳入）")


def _apply_time_costs(out: dict[str, Any], key: str, notes: list[str]) -> None:
    """把作者审阅的时间代价并进包的 affordances。"""
    costs = TIME_COST.get(key) or {}
    if not costs:
        return
    marked = []
    for affordance in out.get("affordances") or []:
        cost = costs.get(str(affordance.get("id")))
        if cost:
            affordance["time_cost"] = int(cost)
            marked.append(f"{affordance.get('id')}={cost}")
    notes.append(f"时间代价：{marked}；其余动作 time_cost=0（说话/观察/测量不消耗时间）")


def _apply_targets(out: dict[str, Any], key: str, notes: list[str]) -> None:
    """把作者审阅的动作对象并进包的 affordances。"""
    targets = TARGETS.get(key)
    if not targets:
        return
    for affordance in out.get("affordances") or []:
        spec = targets.get(str(affordance.get("id")))
        if spec:
            affordance["targets"] = [{"kind": kind, "id": target_id} for kind, target_id in spec]
    notes.append(f"动作对象：为 {sorted(targets)} 声明了 targets（多同类对象时必须显式选对象）")


def migrate_content(content: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """把一份旧包内容转成 v3（含作者审阅项）；返回 `(content, notes)`。"""
    notes: list[str] = []
    out = copy.deepcopy(content)
    if int(out.get("pack_schema_version", 1)) < 3:
        out, convert_notes = pack_loader.convert_legacy(out)
        notes += convert_notes
    key = str(out.get("key") or "")

    _apply_person_state(out, key, notes)
    _apply_time_costs(out, key, notes)
    _apply_targets(out, key, notes)

    return out, notes


def _inspect(name: str, content: dict[str, Any]) -> tuple[dict[str, Any], list[str], list[dict[str, str]]]:
    migrated, notes = migrate_content(content)
    problems = pack_loader.validate_content(migrated)
    return migrated, notes, problems


def _run_migrations(paths: list[pathlib.Path]) -> tuple[bool, list[tuple[str, dict[str, Any]]]]:
    """逐个包迁移并打印差异；返回 `(failed, changed)`。"""
    failed = False
    changed: list[tuple[str, dict[str, Any]]] = []
    for path in paths:
        content = json.loads(path.read_text(encoding="utf-8"))
        key = str(content.get("key") or path.stem)
        migrated, notes, problems = _inspect(path.stem, content)
        will_change = migrated != content
        print(f"== {key}｜当前 v{content.get('pack_schema_version', 1)} → v3｜{'有改动' if will_change else '无改动'}")
        costs = {a.get("id"): a.get("time_cost", 0) for a in migrated.get("affordances") or []}
        print(
            f"   time_cost={costs}｜teaching_focus={len(migrated.get('teaching_focus') or [])}｜"
            f"dm_writable={sum(len(a.get('dm_writable') or []) for a in migrated.get('actors') or [])}｜"
            f"targets={sum(1 for a in migrated.get('affordances') or [] if a.get('targets'))}"
        )
        for note in notes:
            print(f"   · {note}")
        if problems:
            failed = True
            for problem in problems:
                print(f"   ✗ {problem.get('path')}: {problem.get('message')}")
        else:
            print("   ✓ 通过当前形状校验")
        changed.append((path.stem, migrated))
    return failed, changed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="情境包 v3 迁移")
    parser.add_argument("--apply", action="store_true", help="写回 packs/*.json 并在库里追加新修订")
    parser.add_argument("--dry-run", action="store_true", help="只打印差异（默认）")
    parser.add_argument("--only", default="", help="只处理某个 pack key")
    parser.add_argument("--expect-db", default="", help="库名不符就拒绝运行（生产窗口防误操作）")
    args = parser.parse_args(argv)

    if args.expect_db:
        name = re.search(r"/([\w]+)(?:\?|$)", DATABASE_URL)
        actual = name.group(1) if name else "?"
        if actual != args.expect_db:
            print(f"拒绝运行：DATABASE_URL 指向 {actual}，期望 {args.expect_db}")
            return 2

    paths = sorted(PACKS_DIR.glob("*.json"))
    if args.only:
        paths = [path for path in paths if path.stem.replace("_", "-") == args.only or path.stem == args.only]
    failed, changed = _run_migrations(paths)

    if not args.apply:
        print("\n（dry-run：未写入任何文件、未改动数据库。加 --apply 执行。）")
        return 1 if failed else 0
    if failed:
        print("\n有包未通过校验，--apply 已中止（什么都不写）。")
        return 1

    db = SessionLocal()
    try:
        for stem, migrated in changed:
            (PACKS_DIR / f"{stem}.json").write_text(
                json.dumps(migrated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            pack = ScenarioPack.model_validate(migrated)
            with unit_of_work(db, conflict_detail=f"追加修订失败：{pack.key}"):
                try:
                    _, revision, created = pack_loader.install(db, pack, note="v3 migrate (docs/23)")
                except PackInvalid as exc:
                    print(f"✗ {pack.key}: {exc.problems}")
                    raise
            print(
                f"✓ {pack.key}: revision #{revision.revision_no} (id={revision.id}) "
                f"{'created' if created else 'unchanged'}"
            )
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
