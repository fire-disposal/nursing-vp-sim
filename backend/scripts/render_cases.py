"""把 `modules/scenario_training/packs/*.json` 渲染成人可读文本。

用法：
    cd backend && uv run python -m scripts.render_cases                    # 全部打印到 stdout
    cd backend && uv run python -m scripts.render_cases --out-dir ../docs/cases

`--out-dir` 每个病例写一份 `<pack key>/case.md`（目录里可能还有 `case.toml` / `img/`，
本脚本只写 `case.md`，不动别的东西）。产物是**派生物**（唯一真源永远是 `packs/*.json`）；
改了病例就用它重新生成，不要手改产物。
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

PACKS_DIR = pathlib.Path(__file__).resolve().parent.parent / "modules" / "scenario_training" / "packs"

SOURCE_NOTE = (
    "> 派生文件：由 `backend/scripts/render_cases.py` 从 `backend/modules/scenario_training/packs/*.json` 生成。\n"
    "> `packs/*.json` 是唯一真源；改了病例请重新生成，不要手改这一份。"
)


def _j(value: object) -> str:
    return json.dumps(value, ensure_ascii=False)


def _actors(pack: dict) -> list[str]:
    rows = ["**在场者**"]
    for actor in pack["actors"]:
        rows.append(
            f"- `{actor['id']}`（{actor['role']}）在场方式={actor['presence']}，索取注意力={actor.get('demand', 'neutral')}"
        )
        if actor.get("style"):
            rows.append(f"  - 风格：{actor['style']}")
        if actor.get("goals"):
            rows.append(f"  - 目的：{'；'.join(actor['goals'])}")
        if actor.get("knowledge"):
            rows.append(f"  - 他知道：{_j(actor['knowledge'])}")
    return rows


def _state(pack: dict) -> list[str]:
    bounds = pack.get("state_bounds", {})
    rows = ["**状态键**（模型的唯一可写通道，越界即拒）"]
    for key, value in (pack.get("state_keys") or {}).items():
        bound = bounds.get(key)
        suffix = f"　边界 {_j(bound)}" if bound else ""
        rows.append(f"- `{key}` = {value}{suffix}")
    return rows


def _cues(pack: dict) -> list[str]:
    rows = ["**线索**（未被揭示前，学生看不到、模型也不许提前说）"]
    for cue in pack["setting"].get("cues", []):
        flag = "　（开场即见）" if cue.get("visible_from_start") else ""
        rows.append(f"- `{cue['id']}`{flag}：{cue['text']}")
    return rows


def _affordances(pack: dict) -> list[str]:
    rows = ["**动作**（学生的结构化入口；效果与揭示由平台确定性执行）"]
    for affordance in pack["affordances"]:
        bits = [f"`{affordance['id']}`（{affordance['type']}）{affordance['label']}"]
        if affordance.get("targets"):
            bits.append(f"目标 {'/'.join(t['id'] for t in affordance['targets'])}")
        if affordance.get("time_cost"):
            bits.append(f"耗时 +{affordance['time_cost']}")
        if affordance.get("select", "none") != "none":
            options = [o.get("id") for o in (affordance.get("params") or {}).get("options", [])]
            bits.append(f"{affordance['select']} {'|'.join(options)}")
        rows.append("- " + "　".join(bits))
        if affordance.get("reveals"):
            rows.append(f"  - 揭示：{'、'.join(affordance['reveals'])}")
        if affordance.get("effects"):
            rows.append(f"  - 效果：{_j(affordance['effects'])}")
        if affordance.get("visible_when"):
            rows.append(f"  - 门控：{_j(affordance['visible_when'])}")
    return rows


def _facts(pack: dict) -> list[str]:
    if not pack.get("facts"):
        return []
    rows = ["**判读要观察的事实**"]
    for fact in pack["facts"]:
        flag = "，关键" if fact.get("critical") else ""
        rows.append(f"- `{fact['id']}`{flag}：{fact['intent']}")
    return rows


def _rubric(pack: dict) -> list[str]:
    if not pack.get("rubric"):
        return []
    rows = [f"**判据**（作者自写；权重合计 {sum(c.get('weight', 0) for c in pack['rubric'])}）"]
    for criterion in pack["rubric"]:
        rows.append(
            f"- **{criterion['title']}**　`{criterion['id']}`　权重 {criterion['weight']}　规则 `{criterion['rule']}`"
        )
        for anchor, text in (criterion.get("anchors") or {}).items():
            rows.append(f"  - {anchor}：{text}")
    return rows


def _devices(pack: dict) -> list[str]:
    devices = (pack.get("presentation") or {}).get("devices") or []
    if not devices:
        return []
    rows = ["**设备面**（读数只有被测过才有值；未测一律「未测量」）"]
    for device in devices:
        rows.append(f"- `{device['id']}`（{device['title']}）")
        for channel in device.get("channels", []):
            ranges = []
            if channel.get("normal"):
                ranges.append(f"正常 {channel['normal']}")
            if channel.get("critical"):
                ranges.append(f"危急 {channel['critical']}")
            rows.append(
                f"  - `{channel['ref']}` {channel['label']} {channel.get('unit', '')}　{'　'.join(ranges) or '无区间'}"
            )
    return rows


def _assets(pack: dict) -> list[str]:
    if not pack.get("assets"):
        return []
    rows = ["**图片**（模型自行决定何时发；声明了闸门的必须等对应线索）"]
    for asset in pack["assets"]:
        gate = f"　闸门 {asset['reveal_with']}" if asset.get("reveal_with") else ""
        rows.append(f"- `{asset['id']}` {asset.get('title', '')}{gate}")
    return rows


def _truth(pack: dict) -> list[str]:
    if not pack.get("truth"):
        return []
    rows = ["**学生看不到的真相**（只进模型的解析上下文，学生永远看不到；也是防泄漏词表）"]
    rows.extend(f"- {item}" for item in pack["truth"])
    return rows


def render(pack: dict, *, heading: str = "#") -> str:
    rows: list[str] = [f"{heading} {pack['title']}（`{pack['key']}`）", ""]
    rows.append(f"> {pack.get('one_line', '')}")
    rows.append(
        f"> 你是：**{pack['player']['role']}** ｜ 地点：{pack['setting']['place']} ｜ 时间：{pack['setting'].get('time_hint', '')}"
    )
    if pack["setting"].get("resources"):
        rows.append(f"> 手边：{'、'.join(pack['setting']['resources'])}")
    rows.append("")
    for section in (
        _actors(pack),
        _state(pack),
        _cues(pack),
        _affordances(pack),
        _facts(pack),
        _rubric(pack),
        _devices(pack),
        _assets(pack),
        _truth(pack),
    ):
        if section:
            rows.extend(section)
            rows.append("")
    rows.append(f"**结局**：{pack.get('failure')}")
    if pack.get("failure_when"):
        rows.append(f"- 不可逆失败条件：{_j(pack['failure_when'])}")
    return "\n".join(rows)


def case_document(pack: dict) -> str:
    """一份病例的独立文件：来源说明 + 标题 + 正文。"""
    return f"{SOURCE_NOTE}\n\n{render(pack)}\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="渲染病例为人可读文本")
    parser.add_argument(
        "--out-dir",
        type=pathlib.Path,
        default=None,
        help="按 pack key 逐份写 <out-dir>/<pack key>/case.md（缺省打印到 stdout）",
    )
    args = parser.parse_args()

    paths = sorted(PACKS_DIR.glob("*.json"))
    if not paths:
        sys.exit(f"没有找到病例：{PACKS_DIR}")
    packs = [json.loads(path.read_text(encoding="utf-8")) for path in paths]

    if args.out_dir is None:
        blocks = [SOURCE_NOTE, ""]
        for pack in packs:
            blocks.append(render(pack))
            blocks.extend(["", "---", ""])
        sys.stdout.write("\n".join(blocks).rstrip() + "\n")
        return

    for pack in packs:
        target = args.out_dir / pack["key"] / "case.md"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(case_document(pack), encoding="utf-8")
        sys.stdout.write(f"写完 {target}（{len(case_document(pack))} 字符）\n")


if __name__ == "__main__":
    main()
