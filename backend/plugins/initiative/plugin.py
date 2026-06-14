"""InitiativePlugin — patient proactively sends messages based on personality/emotion/wait time."""

from core.feature_flags import FeatureFlag
from plugins.base import EndContext, Plugin, RecordCreateContext, UIManifest


class InitiativePlugin(Plugin):
    id = "initiative"
    name = "患者主动回复"
    description = "患者根据性格/情绪/等待时长主动发言"
    requires = ["emotion"]
    feature_flag = FeatureFlag(
        key="patient_initiative",
        label="患者主动追问",
        default=False,
        description="患者根据性格/情绪/等待时长主动发言（催促、担忧、非语言线索等）",
    )

    async def on_record_create(self, ctx: RecordCreateContext) -> None:
        from contexts.patient.initiative import update_initiative_timer

        update_initiative_timer(ctx.record.id, ctx.initiative_cache)

    async def on_training_end(self, ctx: EndContext) -> None:
        from contexts.patient.initiative import cleanup_initiative

        cleanup_initiative(ctx.record.id, ctx.initiative_cache)

    def ui_manifest(self) -> UIManifest:
        return UIManifest(
            type="panel",
            tab={"icon": "MessageCircle", "label": "主动追问", "priority": 6},
        )
