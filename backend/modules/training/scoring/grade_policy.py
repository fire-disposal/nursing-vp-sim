"""能力等第政策 —— 服务端**唯一**的等第定义与阈值来源（docs/19 §4.2 第 8/9 条）。

四层分离里最后一层（可观察证据 → 条目锚点与原始量尺 → 展示分 → 经校准的能力等第）的
owner。学生页、教师页、导出、筛选一律消费这里的标签与阈值，不得各自再算一遍：

* **数值分层**（``numeric_band``）保留了原有的 85/60 固定阈值，但只作为**数值描述**：
  它说的是「均分落在哪一段」，不是「该生能力属于哪个等第」。
* **能力等第**（``capability_band``）在政策声明 ``calibrated`` 之前**恒为 None**。
  校准（教师判例、留出集、签字阈值；单人判定即可）未完成时不得授予能力标签 —— 计划通过条件
  见 docs/19 §4.3，代码侧不得以「阈值看起来合理」代替。

历史兼容：旧记录上的 85/60 标签是**旧规则结果**，不得重新解释为能力结论；新政策不回溯
改写历史分，只在读取时标注其来源（``legacy``）。
"""

from __future__ import annotations

CALIBRATION_UNCALIBRATED = "uncalibrated"
CALIBRATION_CALIBRATED = "calibrated"

#: 当前校准状态。**改这一行不是代码决定**：docs/19 §4.3 要求先有去标识判例集、护理教师的
#: 独立评判、预先记录的验收标准，并在留出集上通过；不要求多位教师联合宣判。没有这些输入时
#: 保持 uncalibrated。
CALIBRATION_STATE = CALIBRATION_UNCALIBRATED

GRADE_POLICY_ID = "nursing_history_grade"
GRADE_POLICY_VERSION = 1

#: 数值分层阈值（0-100 展示分，降序）。只有这一处定义阈值。
NUMERIC_BANDS: tuple[tuple[str, float], ...] = (("good", 85.0), ("medium", 60.0))

NUMERIC_BAND_LABELS: dict[str, str] = {
    "good": "数值参考 · 高",
    "medium": "数值参考 · 中",
    "poor": "数值参考 · 低",
    "none": "无成绩",
}

NUMERIC_BAND_DESCRIPTION = "按展示分固定阈值分段，只描述数值位置，不代表能力等第"

#: 未校准时的能力等第文案（学生页/教师页/导出共用同一句，不得各自改写）。
CAPABILITY_UNCALIBRATED_LABEL = "尚未校准能力等第"
CAPABILITY_UNCALIBRATED_NOTE = "能力等第需要教师校准裁判例后才能启用；当前只提供量尺、逐项表现与反馈"

#: 历史记录上的旧规则分层说明。
LEGACY_BAND_NOTE = "旧规则分层结果，不可与经校准的能力等第互换解释"

#: 进步幅度判定的平稳阈值（±2 分内视为平稳）——同样只在这里定义。
PROGRESS_TREND_THRESHOLD = 2.0

SOURCE_AI = "ai"
SOURCE_REVIEW = "review"
SOURCE_FALLBACK = "fallback"

SOURCE_LABELS: dict[str, str] = {
    SOURCE_AI: "AI 初评",
    SOURCE_REVIEW: "教师复核",
    SOURCE_FALLBACK: "系统降级结果",
}


def calibration_state() -> str:
    return CALIBRATION_STATE


def policy_descriptor() -> dict:
    """政策身份与当前可用性 —— 所有成绩视图共同携带。"""
    calibrated = CALIBRATION_STATE == CALIBRATION_CALIBRATED
    return {
        "id": GRADE_POLICY_ID,
        "version": GRADE_POLICY_VERSION,
        "calibrated": calibrated,
        "capability_available": calibrated,
        "capability_label": None if calibrated else CAPABILITY_UNCALIBRATED_LABEL,
        "capability_note": None if calibrated else CAPABILITY_UNCALIBRATED_NOTE,
        "numeric_bands": [
            {"band": band, "min": minimum, "label": NUMERIC_BAND_LABELS.get(band, band)}
            for band, minimum in NUMERIC_BANDS
        ],
        "numeric_band_description": NUMERIC_BAND_DESCRIPTION,
    }


def numeric_band(score: float | None) -> str:
    """数值分层（唯一实现）：good ≥ 85，medium ≥ 60，其余 poor；无成绩 = none。"""
    if score is None:
        return "none"
    for band, minimum in NUMERIC_BANDS:
        if score >= minimum:
            return band
    return "poor"


def capability_band(score: float | None) -> str | None:
    """能力等第：校准通过前**恒为 None**（不得用数值分层冒充能力结论）。"""
    if CALIBRATION_STATE != CALIBRATION_CALIBRATED:
        return None
    return numeric_band(score) if score is not None else None


def score_source(*, reviewed_total: float | None, fallback: dict | None) -> str:
    """有效成绩的来源：系统降级 > 教师复核 > AI 初评。

    降级优先是因为降级分本就不进统计（``grade_scope.grade_conditions``）：把它标成
    「教师复核」会让一个不可用成绩获得权威外观。
    """
    if fallback:
        return SOURCE_FALLBACK
    if reviewed_total is not None:
        return SOURCE_REVIEW
    return SOURCE_AI


def grade_view(score: float | None, *, reviewed_total: float | None = None, fallback: dict | None = None) -> dict:
    """成绩的解释视图：数值分段 + （校准前为空的）能力等第 + 来源 + 政策身份。"""
    band = numeric_band(score)
    return {
        "numeric_band": band,
        "numeric_band_label": NUMERIC_BAND_LABELS.get(band, band),
        "capability_band": capability_band(score),
        "capability_label": CAPABILITY_UNCALIBRATED_LABEL if CALIBRATION_STATE != CALIBRATION_CALIBRATED else None,
        "source": score_source(reviewed_total=reviewed_total, fallback=fallback),
        "policy": policy_descriptor(),
    }
