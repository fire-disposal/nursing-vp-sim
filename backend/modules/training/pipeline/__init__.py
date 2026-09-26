"""Training Pipeline —— 一轮对话的显式五阶段编排。

顺序契约住在 ``runner.STAGES``（源码顺序即执行顺序）：

  1. ANALYSIS     —— ``emotion_analysis``: 4D 情绪状态 + behavior note
  2. PROMPT       —— ``prompt_builder``: 取料 + ContextAssembler 装配 system/user prompt
  3. LLM          —— ``llm_caller``: 调用 LLM，写调用日志（best-effort）
  4. PERSIST      —— ``persister``: 事务 B（患者消息 + turn 收尾；学生消息已在
                     ``begin_turn`` 的事务 A 落库，见 turn.py）
  5. SIDE_EFFECTS —— ``side_effects``: emotion/initiative 更新、SSE 事件、
                     correction 追踪（best-effort，失败只记日志）

**本包不导入任何子模块**：``pipeline.context`` 被 ``patient_ai.notes`` 等深层模块在
导入期引用，若包初始化顺带拉起 ``runner``（→ 五个中间件 → ``workflows`` → ``profile``），
就会绕回仍在导入中的 ``profile`` 形成环。导入方走具体模块路径：

* ``from modules.training.pipeline.runner import STAGES, run_pipeline, stream_pipeline``
* ``from modules.training.pipeline.builder import build_note_collector``
* ``from modules.training.pipeline.context import PipelineContext, STATE_*``
"""
