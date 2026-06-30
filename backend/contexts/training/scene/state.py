"""
SceneState — the structured clinical context that drives both
LLM prompt injection and optional front-end visual rendering.

Stored in ``TrainingRecord.runtime_state["scene"]`` and broadcast
to the front-end over MessageBus whenever it changes.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


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
