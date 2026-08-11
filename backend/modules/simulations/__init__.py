"""Clinical Reasoning Simulation module (MVP-B).

A self-contained, business-isolated longitudinal slice: a single hidden
post-op bleeding case playable to discharge / failure. Shares only
infrastructure (DB, auth, LLM layer, migrations, type generation) with the
main system — it does not touch the training/cases/qa domains or the main UI.

```

患者（腹部术后第 1 日）
 │  隐藏病程 HiddenClinicalState（出血严重度 0~1，每 6min 进展）
 │  时间轴：事件队列 ScheduledEvent（BLEEDING_PROGRESS / LAB_READY / 报警 / 结局）
 │
 ├─ 观察 Observation（Reading 继承体系，均带 minute + abnormal）
 │    ├─ VitalsReading（HR/BP/RR/SpO2/T）      ← /assess vitals
 │    ├─ DrainReading（引流量 ml）              ← /assess drain
 │    ├─ PainReading（VAS）                     ← /assess pain
 │    └─ UrineReading（尿量 ml）                ← /assess urine
 │
 ├─ 检查 Lab（Order → Record 生命周期，采样时状态一次性实例化）
 │    ├─ CBC / ABG / COAG / US（LAB_KINDS 表：费用/周转/材料化）
 │    ├─ PendingTask（PROCESSING→READY）→ ClinicalRecord（result, revealed）
 │    └─ 受预算约束（BUDGET_START，下单扣费）
 │
 ├─ 干预 Intervention（InterventionSpec 表，均争取时间但掩盖线索）
 │    ├─ 补液 FLUIDS（掩盖血压 + 减缓失血）
 │    ├─ 输血 TRANSFUSE（减缓失血）
 │    └─ 镇痛 ANALGESIA（掩盖腹痛）
 │
 ├─ 会诊 Consult（¥150，调 AI 基础设施层 infra/llm，仅基于已知信息）
 ├─ 诊断 Diagnosis（/diag 自由文本，报告时带出）
 │
 └─ 报告 Report → 结局 Outcome
      ├─ SUCCESS：患者出院（及时/迟报两种判定）
      └─ FAILURE：延误/漏诊

```

设计模式（只抽象已有真实重复，不预建空层）：
- **继承**：`Reading` 基类 + 4 个读数子类（共享 minute/abnormal、统一序列化与遍历）。
- **组合**：`AssessSpec`（时长/构建/描述/趋势四要素）统一 4 个评估处理器；
  `InterventionSpec`（时长/效果/提示）统一 3 个干预；`LAB_KINDS` 表驱动检查。
- **表驱动**：`_HANDLERS` 动作分发表、`_ASSESS_SPECS`、`_INTERVENTIONS`、`LAB_KINDS`。

扩展基座（新增业务对象的最小改动）：
- 新观察 → `_ASSESS_SPECS` 加一项（build/describe/trend 三个小函数）。
- 新干预 → `_INTERVENTIONS` 加一项（apply 效果函数）。
- 新检查 → `LAB_KINDS` 加一项（materialize_lab 分支）。
- 引擎保持纯函数：`engine.apply_action(state, action)` 无 DB/HTTP；
  持久化与可见性白名单在 `service`；LLM 边界在 `router`。

模块文件：
- ``case``   病例常量、生理映射、LAB_KINDS、materialize_lab
- ``state``  SessionState 与业务实体（Reading 体系 / Record / Task / Event）
- ``engine`` 核心状态机：时间推进、事件结算、病程、结局
- ``actions`` 临床动作处理器（评估/检查/干预/会诊/报告/等待）
- ``service`` 持久化 + 快照白名单 + 会诊 provider 编排
- ``router`` /api/simulations 三端点 + LLM 边界
"""

from .router import router as simulations_router

__all__ = ["simulations_router"]
