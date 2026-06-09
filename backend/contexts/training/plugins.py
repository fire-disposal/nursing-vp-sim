# contexts/training/plugins.py
from contexts.patient.emotion import cleanup_emotion
from contexts.patient.initiative import cleanup_initiative, update_initiative_timer

from .pipeline.middleware.emotion_tracker import emotion_tracker
from .pipeline.middleware.initiative_timer_reset import initiative_timer_reset
from .pipeline.middleware.operation_detector import operation_detector
from .pipeline.middleware.operation_executor import operation_executor
from .pipeline.plugin import PipelinePlugin, PipelinePluginMeta, register_plugin


emotion_plugin = PipelinePlugin(
    id="emotion",
    name="患者情绪状态机",
    feature_flag="emotion",
    requires=[],
    meta=PipelinePluginMeta(
        description="5态情绪模型（withdrawn/defensive/neutral/relaxed/open），根据学生用语动态变化",
        tags=["patient", "emotion"],
    ),
    middleware=[emotion_tracker],
    on_end=lambda ctx: cleanup_emotion(ctx.record.id),
)

initiative_plugin = PipelinePlugin(
    id="initiative",
    name="患者主动回复",
    feature_flag="patient_initiative",
    requires=["emotion"],
    meta=PipelinePluginMeta(
        description="患者根据性格/情绪/等待时长主动发言",
        tags=["patient", "initiative"],
    ),
    middleware=[initiative_timer_reset],
    on_record_create=lambda ctx: update_initiative_timer(ctx.record.id),
    on_end=lambda ctx: cleanup_initiative(ctx.record.id),
)

physical_exam_plugin = PipelinePlugin(
    id="physical-exam",
    name="护理查体锚点交互",
    feature_flag="physical_exam",
    requires=[],
    meta=PipelinePluginMeta(
        description="操作检测 + 执行 + 锚点数据注入",
        tags=["exam", "operation"],
    ),
    middleware=[operation_detector, operation_executor],
)


def register_all_plugins():
    for p in [emotion_plugin, initiative_plugin, physical_exam_plugin]:
        register_plugin(p)
