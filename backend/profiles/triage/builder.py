"""Triage context kwargs builder — extracts template variables from triage case_data."""

import logging

log = logging.getLogger(__name__)


def build_context_kwargs(case_data: dict, author_note: str = "") -> dict[str, str]:
    """从 triage case_data 构建模板变量字典。"""
    pi = case_data.get("patient_info", {})
    vitals = case_data.get("vitals", {})

    patient_name = pi.get("name", "患者")
    patient_age = pi.get("age", "")
    patient_gender = pi.get("gender", "")
    parts = [patient_name]
    if patient_age:
        parts.append(f"{patient_age}岁")
    if patient_gender:
        parts.append(patient_gender)
    patient_info_str = "，".join(parts) if len(parts) > 1 else patient_name

    arrival = case_data.get("arrival_mode", "walk")
    arrival_map = {"walk": "步行", "stretcher": "平车", "ambulance": "救护车"}
    arrival_label = arrival_map.get(arrival, arrival)

    consciousness = vitals.get("consciousness", "alert")
    consciousness_map = {"alert": "清醒", "verbal": "对声音有反应", "pain": "对疼痛有反应", "unresponsive": "无反应"}
    consciousness_label = consciousness_map.get(consciousness, consciousness)

    bp = f"{vitals.get('bp_sys', '')}/{vitals.get('bp_dia', '')}" if vitals.get("bp_sys") else ""

    return {
        "patient_info": patient_info_str,
        "chief_complaint": case_data.get("chief_complaint", ""),
        "scenario": f"患者通过{arrival_label}到达急诊室。患者{consciousness_label}。",
        "arrival_mode": arrival_label,
        "consciousness": consciousness_label,
        "hr": str(vitals.get("hr", "")),
        "bp": bp,
        "rr": str(vitals.get("rr", "")),
        "spo2": str(vitals.get("spo2", "")),
        "temp": str(vitals.get("temp", "")),
        "red_flags": "、".join(case_data.get("red_flags", [])) if case_data.get("red_flags") else "无",
        "mews_score": str(case_data.get("mews_score", 0)),
        "author_note": author_note,
    }
