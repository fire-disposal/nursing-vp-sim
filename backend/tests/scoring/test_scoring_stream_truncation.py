"""流式评分尝试的失败分类（2026-09-27 真实故障的回归）。

故障链：模型输出只缺最外层一个 ``}`` → 解析被判"无结果" → 两次尝试都被当成"模型返回空"
→ ``scoring_fallback_zero`` 写 0 分（学生看到"你什么都没做到"）。

契约：**截断**是可重试的失败（压缩输出再试），**不是 JSON** 才是重试也无用。
两者混为一谈就会重新引入假 0 分。
"""

from __future__ import annotations

import pytest

from modules.training.scoring.engine import StageConfig, _stream_attempt


class _FakeStreamClient:
    """最小流式替身：把给定片段按序吐出。"""

    def __init__(self, chunks: list[str]) -> None:
        self._chunks = chunks

    async def stream(self, messages, **kwargs):  # 替身按生产调用形态收参（on_reasoning 等）
        for chunk in self._chunks:
            yield chunk


def _stage() -> StageConfig:
    return StageConfig(
        pct_base=10,
        pct_range=40,
        progress_msg="逐项评分分析",
        sse_stage="scoring",
        record_id=1,
    )


async def _run(chunks: list[str]) -> tuple[dict, bool]:
    return await _stream_attempt(
        _FakeStreamClient(chunks),
        [{"role": "user", "content": "评分"}],
        {},
        stage=_stage(),
        purpose="scoring",
        case_id=1,
        log_meta=None,
    )


@pytest.mark.asyncio
async def test_truncated_output_is_flagged_retriable():
    """字符串内被截断：解析不出结果，但必须标记为**截断**（→ 压缩重试），不是空响应。"""
    result, truncated = await _run(['{"total_score": "20(0~4'])

    assert result == {}
    assert truncated is True


@pytest.mark.asyncio
async def test_non_json_output_is_not_flagged_as_truncation():
    """模型回散文：重试同类提示即可，不属于截断（不该走"压缩输出"那条路）。"""
    result, truncated = await _run(["我无法完成本次评分。"])

    assert result == {}
    assert truncated is False


@pytest.mark.asyncio
async def test_repairable_truncation_yields_result_not_flag():
    """只缺最外层一个 ``}`` 的截断：修复成功即返回结果，不再当失败（真实故障形状）。"""
    payload = (
        '{"total_score": 20, "detail_scores": {"沟通技能": {"score": 13, '
        '"items": [{"id": "comm_01", "name": "打招呼", "score": 2, "reason": "主动问候"}]}'
    )

    result, truncated = await _run([payload])

    assert truncated is False
    assert result["total_score"] == 20
    assert result["detail_scores"]["沟通技能"]["items"][0]["score"] == 2


@pytest.mark.asyncio
async def test_annotated_numeric_strings_are_coerced_in_stream_path():
    """模型把分值写成 "13(0~28)" 时，流式路径也要转成数值（不把字符串带进校验）。"""
    payload = '{"total_score": "20(0~48)", "detail_scores": {"沟通技能": {"score": "13(0~28)"}}}'

    result, truncated = await _run([payload])

    assert truncated is False
    assert result["total_score"] == 20
    assert result["detail_scores"]["沟通技能"]["score"] == 13
