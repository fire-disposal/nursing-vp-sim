"""PhysicalExamPlugin — allows students to perform nursing exam operations."""

from core.feature_flags import FeatureFlag
from plugins.base import Plugin, RouteDef, UIManifest
from plugins.physical_exam.routes import perform_exam


class PhysicalExamPlugin(Plugin):
    id = "physical-exam"
    name = "护理查体锚点交互"
    description = "通过专属 Tab 触发体检操作，结果注入 Author's Note"
    feature_flag = FeatureFlag(
        key="physical_exam",
        label="护理查体",
        default=False,
        description="允许学生触发护理操作（测血压/体温/听诊等），操作结果通过 Author's Note 注入 LLM",
    )

    def get_routes(self) -> list[RouteDef]:
        return [
            RouteDef(
                method="POST",
                path="/training/{record_id}/exam/{op_type}",
                handler=perform_exam,
            )
        ]

    def ui_manifest(self) -> UIManifest:
        return UIManifest(
            type="panel",
            tab={"icon": "Stethoscope", "label": "护理查体", "priority": 3},
            actions=[
                {"id": "exam_temp", "label": "体温", "type": "exam", "op_type": "temp"},
                {"id": "exam_bp", "label": "血压", "type": "exam", "op_type": "bp"},
                {"id": "exam_hr", "label": "心率", "type": "exam", "op_type": "hr"},
                {"id": "exam_rr", "label": "呼吸", "type": "exam", "op_type": "rr"},
                {"id": "exam_spo2", "label": "血氧", "type": "exam", "op_type": "spo2"},
                {"id": "exam_vitals", "label": "全套生命体征", "type": "exam", "op_type": "vitals"},
                {"id": "exam_skin", "label": "皮肤检查", "type": "exam", "op_type": "skin"},
                {"id": "exam_pain", "label": "疼痛评估", "type": "exam", "op_type": "pain"},
            ],
        )
