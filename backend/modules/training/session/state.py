"""
``TrainingRecord.runtime_state`` 的 schema 与写入契约。

两个职责：

1. ``SceneState`` —— ``runtime_state["scene"]`` 的结构（LLM 提示词注入用；学生端不再有
   场景状态容器，客户端看到的场景来自会话详情投影）。
2. ``patch_runtime_state`` —— ``runtime_state`` 顶层键的**唯一写契约**：行锁 + 重读 +
   只改自己拥有的键。持有已加载实例、且中间跨过外部调用（LLM）的写入者必须走这里，
   禁止整列回写（那会把并发工具写入的 ``exam_results`` 等一起抹掉）。
   例外：``router/session.py`` 的计时暂停在同一请求内就地读写 ``paused_*`` 键。

键的 owner（一个事实一个 owner）：

| 键 | owner |
|---|---|
| ``exam_results`` / ``quiz_answers`` / ``nursing_diagnoses`` | Activity command（``tools/service.py`` 的行锁 + revision CAS 内） |
| ``scene`` | 会话创建写初值（``router/session.py:_create_record``）+ Activity command 写 vitals 增量 |
| ``message_correction`` | 对话回合修正（``pipeline/middleware/persister.py``） |
| ``patient_walkout`` / ``terminal`` | 会话终结（``session/finalize.py``） |
| ``force_rescore_snapshot`` | 评分重评快照（``scoring/runner.py``） |
| ``paused_*`` / ``questionnaire_paused_*`` | 计时暂停（``router/session.py``） |
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from typing import TYPE_CHECKING, Any, Literal, cast

from pydantic import BaseModel
from sqlalchemy import select

from core.exceptions import NotFoundError
from models import TrainingRecord

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


class EnvironmentState(BaseModel):
    type: Literal["icu", "ward", "er", "clinic", "home"] = "clinic"
    time_of_day: Literal["morning", "day", "night"] = "day"
    equipment: list[str] = []
    noise_level: Literal["quiet", "moderate", "loud"] = "quiet"


class PatientState(BaseModel):
    position: Literal["supine", "sitting", "semi-recumbent", "lateral"] = "supine"
    consciousness: Literal["alert", "lethargic", "confused", "unresponsive"] = "alert"
    visible_symptoms: list[str] = []
    expression: str = "neutral"


class VitalsState(BaseModel):
    hr: int | None = None
    bp_sys: int | None = None
    bp_dia: int | None = None
    rr: int | None = None
    spo2: int | None = None
    temp: float | None = None
    pain: int | None = None


class SceneState(BaseModel):
    """SSOT for what the student sees and the LLM reads."""

    environment: EnvironmentState = EnvironmentState()
    patient: PatientState = PatientState()
    vitals: VitalsState = VitalsState()
    phase: str = ""
    procedure_step: int = 0


def format_scene_for_prompt(state: SceneState | None) -> str:
    """Serialize SceneState into a natural-language block for the LLM prompt."""
    if state is None:
        return ""

    parts: list[str] = []
    env = state.environment
    pt = state.patient
    vt = state.vitals

    parts.append(f"环境: {env.type} ({env.time_of_day})")
    if env.equipment:
        parts.append(f"设备: {'/'.join(env.equipment)}")

    parts.append(f"患者: {pt.position} / {pt.consciousness}")
    if pt.visible_symptoms:
        parts.append(f"可见体征: {'/'.join(pt.visible_symptoms)}")

    vs: list[str] = []
    if vt.hr is not None:
        vs.append(f"HR {vt.hr}")
    if vt.spo2 is not None:
        vs.append(f"SpO₂ {vt.spo2}%")
    if vt.bp_sys is not None:
        vs.append(f"BP {vt.bp_sys}/{vt.bp_dia}")
    if vt.rr is not None:
        vs.append(f"RR {vt.rr}")
    if vt.temp is not None:
        vs.append(f"T {vt.temp}°C")
    if vt.pain is not None:
        vs.append(f"疼痛 {vt.pain}/10")
    if vs:
        parts.append("生命体征: " + " | ".join(vs))

    if state.phase:
        parts.append(f"阶段: {state.phase}")

    return "；".join(parts)


#: ``patch`` 参数可以是一份静态键值，也可以是「拿到当前 state 再算出要写的键」的回调
#: （同一把锁内读-改-写，避免先读后锁的窗口）。
PatchBuilder = Callable[[dict[str, Any]], Mapping[str, Any]]


def patch_runtime_state(
    db: Session,
    record_id: int,
    patch: Mapping[str, Any] | PatchBuilder | None = None,
    *,
    remove: Iterable[str] = (),
) -> dict[str, Any]:
    """把 ``runtime_state`` 的若干**顶层键**写入并返回合并后的值。

    契约（一个事实一个 owner）：

    * **行锁**：先 ``SELECT … FOR UPDATE`` 再读，与 Activity command 路径（
      ``tools/service.py`` 的 ``with_for_update()``）互斥 —— 两条写路径不会再交错覆盖；
    * **重读**：``populate_existing`` 强制以数据库当前值为基准。调用方常常持有几十秒前
      加载的实例（对话回合在 LLM 调用前构造），直接整列回写会静默吞掉这期间的工具写入；
    * **只改自己拥有的键**：``patch`` 覆盖自己的键，``remove`` 删除自己的键（如评分快照
      用完即清），其余键原样保留；
    * **不提交**：事务边界由调用方持有（与 ``tools/service.py`` 相同）。

    Args:
        db: 持有事务的 session。
        record_id: ``training_records.id``。
        patch: 要写入的顶层键值；或 ``lambda current: {...}`` 形式的回调（current 为锁内
            读到的当前 state），用于需要基于现值推导的键（如修正计数）。
        remove: 要删除的顶层键。

    Returns:
        合并后的完整 ``runtime_state``（已写回 ORM 实例；由调用方提交）。

    Raises:
        NotFoundError: 记录不存在。
    """
    record = db.execute(
        select(TrainingRecord)
        .where(TrainingRecord.id == record_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if record is None:
        raise NotFoundError(detail="训练记录不存在")

    merged = dict(record.runtime_state or {})
    for key in remove:
        merged.pop(key, None)
    if patch is not None:
        if isinstance(patch, Mapping):
            merged.update(patch)
        else:
            merged.update(cast("PatchBuilder", patch)(merged))
    record.runtime_state = merged
    return merged
