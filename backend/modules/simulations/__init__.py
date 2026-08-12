"""Clinical Reasoning Simulation module (MVP-B).

A self-contained, business-isolated longitudinal slice: a single hidden
post-op bleeding case playable to discharge / failure. Shares only
infrastructure (DB, auth, LLM layer, migrations, type generation) with the
main system — it does not touch the training/cases/qa domains or the main UI.

```

患者（腹部术后第 1 日）
 │  隐藏病程 HiddenClinicalState
 │    ├─ values：疾病轴 dict（出血严重度 0~1，每 6min 进展；可带多轴，如 infection）
 │    └─ physio：舱室状态（vol 血容量 / svr 外周阻力 / lactate 乳酸 / hb 血红蛋白）
 │  时间轴：事件队列 ScheduledEvent（BLEEDING_PROGRESS / LAB_READY / 报警 / 结局）
 │  生理引擎：每 tick 经 PhysiologySpec.step 差分推进舱室（确定性，无随机）
 │
 ├─ 观察 Observation（Reading 继承体系，均带 minute + abnormal）
 │    ├─ VitalsReading（HR/BP/RR/SpO2/T，由 vol/svr 派生）  ← /assess vitals
 │    ├─ DrainReading（引流量 ml，出血轴直接测量）          ← /assess drain
 │    ├─ PainReading（VAS，出血轴 + 镇痛掩盖）              ← /assess pain
 │    └─ UrineReading（尿量 ml，肾灌注随 vol 下降）         ← /assess urine
 │
 ├─ 检查 Lab（Order → Record 生命周期，采样时状态一次性实例化）
 │    ├─ CBC / ABG / COAG / US（LAB_KINDS 表：检查点/周转/材料化）
 │    ├─ PendingTask（PROCESSING→READY）→ ClinicalRecord（result, revealed）
 │    └─ 耗检查点（DIAG_BUDGET_START），下单扣费
 │
 ├─ 干预 Intervention（InterventionSpec 表，耗治疗点，作用于舱室）
 │    ├─ 补液 FLUIDS（扩容 vol：提血压但掩盖失血，乳酸随之清除）
 │    ├─ 输血 TRANSFUSE（提升 hb + 扩容 vol，减缓失血）
 │    └─ 镇痛 ANALGESIA（掩盖腹痛）
 │
 ├─ 会诊 Consult（120 检查点，调 AI 基础设施层 infra/llm，仅基于已知信息）
 ├─ 对话 Talk（/talk patient|family <你的话>，2min/次）
 │    └─ LLM 扮演患者/家属角色，仅基于已知观察作答，不泄露隐藏病程
 ├─ 诊断 Diagnosis（/diag 自由文本，报告时带出）
 │
 └─ 报告 Report → 结局 Outcome
      ├─ SUCCESS：患者出院（及时/迟报两种判定）
      └─ FAILURE：延误/漏诊

资源模型：三种资源——检查点（实验室+会诊，400）、治疗点（干预，100）、时间（分钟）。

```

设计模式（只抽象已有真实重复，不预建空层）：
- **继承**：`Reading` 基类 + 4 个读数子类（共享 minute/abnormal、统一序列化与遍历）。
- **组合**：`AssessSpec`（时长/构建/描述/趋势四要素）统一 4 个评估处理器；
  `InterventionSpec`（时长/效果/提示）统一 3 个干预；
  `LabSpec`（费用/周转/材料化）统一 4 项检查；
  `PhysiologySpec`（initial/step/vitals/…）构成离散舱室生理引擎，随病例绑定：
  vol/svr/lactate/hb 四舱室差分推进，反馈环（压力感受器、乳酸积分、扩容/输血作用力）。
- **表驱动**：`_HANDLERS` 动作分发表、`_EVENT_HANDLERS` 事件分发表、
  `_ASSESS_SPECS`、`_INTERVENTIONS`、`LAB_KINDS`、`_LAB_FORMATTERS` 结果显示表。
- **会话级解析**：引擎/动作层经 `case_of(state)` 读当前病例的
  course/physiology/narrative——切换病例即换生理与文案。
- **病例工厂**：`CompartmentPhysiology(axis, params)` 关闭共享舱室引擎 + `_make_lab_kinds`
  构建实验室目录，新病例 = 一个 `_build_case(...)` 调用（现有 mvpb-1 出血 / mvpi-1 感染）。

扩展基座（新增业务对象的最小改动）：
- 新病例 → `_build_case(...)` 一行 + `CASES` 注册（含轴参数表与叙事文案）。
- 新观察 → `_ASSESS_SPECS` 加一项（build/describe/trend 三个小函数）。
- 新干预 → `_INTERVENTIONS` 加一项（apply 效果函数）。
- 新检查 → 病例参数表 + `_make_lab_kinds` 内加一项 LabSpec（materialize 函数）。
- 引擎保持纯函数：`engine.apply_action(state, action)` 无 DB/HTTP；
  LLM 边界（会诊/对话）在 `service` provider 编排 + `router`；持久化与白名单在 `service`。

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
