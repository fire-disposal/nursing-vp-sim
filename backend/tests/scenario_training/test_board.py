"""线索板（白板）投影：只读、按需出现、**简洁**（单行限长、去重、重复合并、限量）。"""

from __future__ import annotations

import pytest

from modules.scenario_training.dm.contract import DMNote, DMTurn, validate_turn
from modules.scenario_training.pack_loader import load_pack_file
from modules.scenario_training.runtime.board import LINE_LIMIT, MAX_ENTRIES, build_board
from modules.scenario_training.runtime.view import build_view
from modules.scenario_training.runtime.world import ActionRecord, initial_world, reveal_cues
from modules.scenario_training.schema import BoardSection, Presentation, ScenarioPack, Trigger
from modules.scenario_training.validation import validate_pack


@pytest.fixture(scope="module")
def sputum() -> ScenarioPack:
    return load_pack_file("sputum-ineffective")


@pytest.fixture(scope="module")
def two_beds() -> ScenarioPack:
    return load_pack_file("two-beds-priority")


def _section(board: dict, section_id: str) -> dict | None:
    return next((item for item in board["sections"] if item["id"] == section_id), None)


def test_board_is_read_only_with_declared_sections(sputum: ScenarioPack) -> None:
    board = build_board(sputum, initial_world(sputum))
    assert board["editable"] is False
    assert [section["title"] for section in board["sections"]][:2] == ["现场看到的", "注意到的"]


def test_section_appears_only_after_seeking(sputum: ScenarioPack) -> None:
    """版块级门控：没满足条件就不出现（用合成包，避免依赖具体场景把读数放在哪儿）。"""
    gated = sputum.model_copy(
        update={
            "presentation": Presentation(
                board=[
                    BoardSection(
                        id="b_read",
                        title="读数",
                        source="state",
                        refs=["scene.spo2"],
                        visible_when=Trigger.model_validate(
                            {"all": [{"kind": "cue_revealed", "cue_id": "c_low_spo2"}]}
                        ),
                    )
                ]
            )
        }
    )
    assert _section(build_board(gated, initial_world(gated)), "b_read") is None

    world = initial_world(gated)
    reveal_cues(gated, world, ["c_low_spo2"])
    section = _section(build_board(gated, world), "b_read")
    assert section is not None
    assert section["entries"][0]["text"] == "spo2 88"


def test_state_entries_are_only_for_refs_no_device_shows(sputum: ScenarioPack) -> None:
    """④ 的血氧在监护仪上 → 白板不再有读数版块；白板只放设备没展示的东西。"""
    board = build_board(sputum, initial_world(sputum))
    assert _section(board, "board_readings") is None

    # 合成：白板上的读数条目用 labels 里的人话标签，不暴露内部键名
    pack = sputum.model_copy(
        update={
            "presentation": Presentation(
                board=[
                    BoardSection(
                        id="b_read",
                        title="读数",
                        source="state",
                        refs=["scene.spo2"],
                        labels={"scene.spo2": "血氧（%）"},
                    )
                ]
            )
        }
    )
    entries = _section(build_board(pack, initial_world(pack)), "b_read")["entries"]
    assert entries
    assert entries[0]["text"] == "血氧（%） 88"
    assert "scene." not in entries[0]["text"]


def test_repeated_actions_merge_with_count(sputum: ScenarioPack) -> None:
    world = initial_world(sputum)
    for turn in (1, 2, 3):
        world.actions.append(ActionRecord(turn=turn, affordance_id="suction", type="act"))
    world.actions.append(ActionRecord(turn=4, affordance_id="auscultate", type="observe"))
    entries = _section(build_board(sputum, world), "board_done")["entries"]
    texts = [entry["text"] for entry in entries]
    assert "吸痰 ×3" in texts
    assert "听诊双肺" in texts


def test_free_form_questions_stay_out(sputum: ScenarioPack) -> None:
    """自由发问属于对话，不进白板（白板只放有价值的事实）。"""
    world = initial_world(sputum)
    world.actions.append(ActionRecord(turn=1, affordance_id=None, type="ask", text="你现在最难受的是什么？"))
    assert _section(build_board(sputum, world), "board_done")["entries"] == []


def test_long_text_becomes_one_short_line(sputum: ScenarioPack) -> None:
    world = initial_world(sputum)
    world.ad_hoc_cues.append("他把身子前倾，肩膀一起一伏，喉咙里有很响的声音" * 3)
    entries = _section(build_board(sputum, world), "board_noticed")["entries"]
    assert len(entries[0]["text"]) <= LINE_LIMIT
    assert entries[0]["text"].endswith("…")
    assert "\n" not in entries[0]["text"]


def test_duplicates_and_cap(sputum: ScenarioPack) -> None:
    world = initial_world(sputum)
    world.ad_hoc_cues.extend(["同一句观察"] * 3)
    world.ad_hoc_cues.extend([f"第{i}条新观察" for i in range(25)])
    section = _section(build_board(sputum, world), "board_noticed")
    texts = [entry["text"] for entry in section["entries"]]
    assert texts.count("同一句观察") == 1
    assert len(texts) == MAX_ENTRIES
    assert section["more"] == 25 + 1 - MAX_ENTRIES


def test_notes_append_and_supersede_marks_the_target(sputum: ScenarioPack) -> None:
    world = initial_world(sputum)
    world.notes.append({"id": "note:1:0", "text": "他自称只是腰闪了", "turn": 1})
    world.notes.append({"id": "note:2:0", "text": "订正：应疑腹内出血", "turn": 2, "supersedes": "note:1:0"})
    entries = _section(build_board(sputum, world), "board_notes")["entries"]
    assert [entry["text"] for entry in entries] == ["他自称只是腰闪了", "订正：应疑腹内出血"]
    assert entries[0]["superseded"] is True
    assert entries[1]["supersedes"] == "note:1:0"


def test_dm_note_must_be_short_and_on_a_declared_section(sputum: ScenarioPack) -> None:
    ok = validate_turn(sputum, DMTurn.model_validate({"notes": [{"text": "血氧不升，考虑深部堵塞"}]}))
    assert [note.text for note in ok.turn.notes] == ["血氧不升，考虑深部堵塞"]

    too_long = validate_turn(sputum, DMTurn.model_validate({"notes": [{"text": "很长的句子" * 12}]}))
    assert too_long.turn.notes == []
    assert too_long.dropped.get("notes") == 1

    bad_section = validate_turn(sputum, DMTurn.model_validate({"notes": [{"text": "写错版块", "section": "nope"}]}))
    assert bad_section.problems == ["unknown_board_section:nope"]


def test_board_not_declared_means_dm_cannot_write(sputum: ScenarioPack) -> None:
    closed = sputum.model_copy(update={"presentation": Presentation(hud=sputum.presentation.hud)})
    check = validate_turn(closed, DMTurn.model_validate({"notes": [{"text": "随手写一句"}]}))
    assert check.turn.notes == []
    assert check.problems == ["board_not_declared"]
    assert DMNote(text="x")  # 类型可用


def test_validation_rejects_unknown_state_ref(two_beds: ScenarioPack) -> None:
    broken = two_beds.model_copy(
        update={
            "presentation": Presentation(
                board=[
                    BoardSection(
                        id="b",
                        title="读数",
                        source="state",
                        refs=["scene.nope"],
                        visible_when=Trigger.model_validate({"all": [{"kind": "turn_gte", "count": 1}]}),
                    )
                ]
            )
        }
    )
    problems = validate_pack(broken)
    assert any("scene.nope" in problem for problem in problems)


def test_view_exposes_board(sputum: ScenarioPack) -> None:
    view = build_view(sputum, initial_world(sputum), session_id=1, status="active", revision_id=1)
    board = view["board"]
    assert board["entry_count"] == sum(len(section["entries"]) for section in board["sections"])
    assert len(_section(board, "board_scene")["entries"]) == 2  # 两条开场线索
    assert _section(board, "board_done")["entries"] == []
