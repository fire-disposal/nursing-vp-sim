"""泄漏守卫的「已问过」窗口（2026-09-27 修复的回归）。

症状：豁免只看**本轮**学生输入。于是「学生第 3 轮问过吸烟史、患者第 5 轮又提到烟」会被判成
"主动说出医生视角信息"，触发一次**错误的**纠正重试；纠正话术还会让患者收口，
把学生**已经问到**的信息压掉 —— 与 U0-A 通过条件「学生合理追问能得到对应细节」直接冲突。
"""

from __future__ import annotations

from types import SimpleNamespace

from modules.training.pipeline.middleware.llm_caller import _asked_so_far, _collect_leak_corrections

_CASE = {
    "deep_background": {
        "吸烟史": "吸烟 40 年，已戒 2 年",
        "停药": "2 周前自行停用噻托溴铵吸入剂",
    }
}


def _ctx(*, history: list[tuple[str, str]], current: str):
    return SimpleNamespace(
        case_data=_CASE,
        student_input=current,
        student_display=current,
        messages=[SimpleNamespace(role=role, content=content) for role, content in history],
    )


def test_asked_so_far_includes_history_and_current_turn():
    ctx = _ctx(history=[("student", "您有吸烟史吗？"), ("patient", "抽了四十年")], current="现在戒了吗？")

    asked = _asked_so_far(ctx)

    assert "您有吸烟史吗？" in asked
    assert "现在戒了吗？" in asked
    assert "抽了四十年" not in asked  # 只收学生说过的话，不收患者说的


def test_topic_asked_two_turns_ago_is_not_a_leak():
    """历史问过 → 本轮再由患者提到，不算泄露（修复点）。"""
    ctx = _ctx(
        history=[
            ("student", "您有吸烟史吗？"),
            ("patient", "抽了四十年，戒了两年了"),
            ("student", "那退休前做什么工作？"),
        ],
        current="平时跟谁一起住？",
    )

    corrections = _collect_leak_corrections(ctx, "我吸烟史有四十来年，跟老伴儿一起住。")

    assert corrections == []


def test_topic_never_asked_is_still_flagged():
    """没问过就主动说出 → 仍然要拦（本修复不得放宽真实泄漏）。

    注：这里必须让回复**字面包含**键「停药」——守卫是子串匹配，`把药停了` 这种同义换词
    抓不到（已知 T7/PIP-13 边界：需要作者可声明的别名或语义判定）。
    """
    ctx = _ctx(
        history=[("student", "咳嗽多久了？"), ("patient", "三天了")],
        current="有没有痰？",
    )

    corrections = _collect_leak_corrections(ctx, "对了，我两周前自己停药了。")

    assert len(corrections) == 1
    assert "停药" in corrections[0].text


def test_only_current_turn_asked_also_exempts():
    """本轮问到就豁免（原有行为不得回归）。"""
    ctx = _ctx(history=[], current="您有吸烟史吗？")

    assert _collect_leak_corrections(ctx, "我吸烟史四十年。") == []
