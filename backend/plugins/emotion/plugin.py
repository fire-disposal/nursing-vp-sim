"""EmotionPlugin — 2D trust-comfort emotional state machine."""

from core.feature_flags import FeatureFlag
from plugins.base import EndContext, PipelineStage, Plugin, UIManifest
from plugins.emotion.middleware import emotion_tracker


class EmotionPlugin(Plugin):
    id = "emotion"
    name = "患者情绪状态机"
    description = "2D 信赖-舒适情绪模型，根据学生用语动态变化"
    feature_flag = FeatureFlag(
        key="emotion",
        label="患者情绪状态机",
        default=False,
        description="5态情绪模型（withdrawn/defensive/neutral/relaxed/open），根据学生用语动态变化，注入 author_note 影响患者表现",
    )

    def get_middleware(self):
        return [(PipelineStage.PLUGIN_EARLY, emotion_tracker)]

    async def on_training_end(self, ctx: EndContext) -> None:
        from contexts.patient.emotion import cleanup_emotion

        cleanup_emotion(ctx.record.id, ctx.emotion_cache)

    def ui_manifest(self) -> UIManifest:
        return UIManifest(
            type="panel",
            tab={"icon": "Smile", "label": "情绪状态", "priority": 5},
        )
