"""临床判断训练（Clinical Reasoning V2）—— 证据驱动的训练格式。

复用 workflow id ``clinical_reasoning``，与 ``history_taking`` 并存：**不改**老问诊的
任何阶段链、提示词与评分。V2 只复用基础设施——chat 准入 / durable turn
(``pipeline.turn``)、``TrainingRecord`` / ``TrainingAction`` / ``Score``。

模块职责（一个事实一个 owner）：

| 模块 | 职责 |
|---|---|
| :mod:`state` | ``runtime_state["clinical_reasoning"]`` 读写契约 + **唯一**公有投影 ``PublicClinicalState`` |
| :mod:`tools` | ``clinical_judgment`` Activity handler（``load`` / ``observe`` / ``act``） |
| :mod:`llm` | 患者回合的独立 LLM 核心 :func:`run_clinical_reasoning_turn`（含输出过滤与同事务持久化） |
| :mod:`prompts` | V2 患者提示词与原文锚定 JSON 契约（人物背景/历史/现场状态，不含评分材料） |
| :mod:`rubric` | :func:`build_clinical_rubric`：病例锚点 → 现有 ``dimensions/items/raw_scale`` 结构 |
| :mod:`scoring` | :func:`evaluate_clinical_reasoning`：同步**确定性**评分，落现有 ``Score`` |

父代理已接入的三处（本模块只提供符号，不改既有文件）：

* ``modules/training/activities.py`` —— ``ACTIVITY_IDS``/``ACTIVITY_BINDINGS`` 已登记
  ``clinical_judgment``（handler ``ClinicalJudgmentHandler()``，入参 schema
  ``finding_id``/``objective_id``，出参 ``state``，``requires_case_config=False``）。
* ``modules/training/profile.py`` —— ``CLINICAL_REASONING`` 白名单含 ``clinical_judgment``，
  冻结评分域走 :func:`build_clinical_rubric`（``scoring_profile == "clinical_reasoning.base"``）。
* ``modules/training/router/chat.py`` —— 非流式回合按 workflow 分叉到
  :func:`run_clinical_reasoning_turn`；流式入口对 V2 返回 400（V2 不做增量流）。
* ``infra/llm/profile.py`` —— 已登记 ``clinical_reasoning_turn``（``json_object``）。

* ``modules/training/scoring/engine.py`` —— 加载冻结记录后按 workflow 调
  :func:`evaluate_clinical_reasoning`，老问诊评分器不改。
* ``session/finalize.py`` —— V2 至少完成一轮学生对话；零学生消息的无效训练仍 discarded。

集成注意点：

1. **证据与患者消息必须同事务**：V2 通过 ``complete_turn(..., before_commit=...)``
   在患者消息 flush 后写入引用它的证据，再由公共回合接口一次 commit。
2. **``patch_runtime_state`` 先 flush 再重读**：证据钩子只改 ``clinical_reasoning``
   顶层键，不覆盖并发的其他运行态。
3. **病例不要声明 ``activities``**：``modules/cases/validator._check_clinical_reasoning``
   当前仍拒绝 clinical 病例里的 ``activities`` 声明；Activity 可用性用
   ``requires_case_config=False`` 因此不依赖病例 config。
"""

from __future__ import annotations

from .llm import build_turn_messages, filter_reply, run_clinical_reasoning_turn
from .rubric import build_clinical_rubric
from .scoring import evaluate_clinical_reasoning, score_for_record
from .state import public_state_for, read_state, seed_state
from .tools import ACTIVITY_ID, HANDLER, ClinicalJudgmentHandler

__all__ = [
    "ACTIVITY_ID",
    "HANDLER",
    "ClinicalJudgmentHandler",
    "build_clinical_rubric",
    "build_turn_messages",
    "evaluate_clinical_reasoning",
    "filter_reply",
    "public_state_for",
    "read_state",
    "run_clinical_reasoning_turn",
    "score_for_record",
    "seed_state",
]
