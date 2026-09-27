"""增量块扫描：DM 的单次结构化输出里，**已经写完的顶层字段**要能立刻拿出来渲染。"""

from __future__ import annotations

from modules.scenario_training.dm.stream import fresh_fields, scan_complete_fields


def test_incomplete_string_yields_nothing() -> None:
    assert scan_complete_fields('{"narration": "他把') == {}


def test_completed_string_is_available_immediately() -> None:
    fields = scan_complete_fields('{"narration": "他把身体前倾", "lines": [{"actor": "pat')
    assert fields == {"narration": "他把身体前倾"}  # 台词块还没写完 → 先给叙述


def test_container_only_when_balanced() -> None:
    partial = '{"narration": "x", "lines": [{"actor": "patient", "text": "……"'
    assert scan_complete_fields(partial) == {"narration": "x"}

    complete = '{"narration": "x", "lines": [{"actor": "patient", "text": "……"}]}'
    assert scan_complete_fields(complete)["lines"] == [{"actor": "patient", "text": "……"}]


def test_escapes_and_nested_containers_do_not_confuse_the_scanner() -> None:
    text = '{"narration": "他说\\"别吸了\\"", "effects": [{"target": "scene", "key": "spo2", "op": "incr", "value": 2}], "options": ['
    fields = scan_complete_fields(text)
    assert fields["narration"] == '他说"别吸了"'
    assert fields["effects"][0]["value"] == 2
    assert "options" not in fields


def test_scalars_and_booleans() -> None:
    fields = scan_complete_fields('{"image_request": null, "x": 12, "ok": true, "y": 1')
    assert fields == {"image_request": None, "x": 12, "ok": True}


def test_fresh_fields_only_reports_changes() -> None:
    previous = {"narration": "a"}
    assert fresh_fields(previous, {"narration": "a"}) == {}
    assert fresh_fields(previous, {"narration": "a", "lines": []}) == {"lines": []}
    assert fresh_fields(previous, {"narration": "ab"}) == {"narration": "ab"}


def test_scanning_is_monotonic_over_chunks() -> None:
    """模拟分块到达：每个分片之后能拿到的字段只会越来越多。"""
    import json

    payload = {
        "narration": "他把身体前倾",
        "lines": [{"actor": "patient", "text": "……"}],
        "options": [{"label": "听诊双肺", "type": "observe", "affordance_id": "auscultate"}],
    }
    text = json.dumps(payload, ensure_ascii=False)
    seen: dict = {}
    sizes: list[int] = []
    for index in range(0, len(text), 7):
        seen = {**seen, **fresh_fields(seen, scan_complete_fields(text[: index + 7]))}
        sizes.append(len(seen))
    assert sizes == sorted(sizes)
    assert seen == payload
