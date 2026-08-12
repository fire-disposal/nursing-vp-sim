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
 │  分片化时间：病例声明起始时钟（早班 08:30 / 急诊夜班 22:00 / ICU 凌晨 02:00），
 │   模拟分钟映射到各自墙钟（clock_text(minute, start_clock)）
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
 ├─ 给药 Give（/give <药物> [剂量]，耗治疗点）
 │    ├─ 药物动力学：每药血浆浓度按半衰期衰减，累积量驱动过量检测
 │    ├─ 副作用：吗啡→呼吸抑制/镇静/过量事件；补液→容量超负荷；
 │    │   抗生素→过敏；给氧→纠正低氧但掩盖呼吸问题
 │    └─ 病例 surface 声明备药：出血病例有输血，感染病例有抗生素
 ├─ 意识 Consciousness（0..1，由灌注/氧合/镇静驱动）
 │    └─ 嗜睡/昏迷：患者无法对话，需处理病因（低灌注/缺氧/药物过量）
 │
 ├─ 会诊 Consult（120 检查点，调 AI 基础设施层 infra/llm，仅基于已知信息）
 ├─ 对话 Talk（/talk patient|family <你的话>，2min/次；昏迷时不可用）
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
  `DrugSpec`（药代动力学/剂量/副作用/过量阈值）统一给药；
  `LabSpec`（费用/周转/材料化）统一 4 项检查；
  `PhysiologySpec`（initial/step/vitals/…）构成离散舱室生理引擎，随病例绑定：
  vol/svr/lactate/hb 四舱室 + meds 药物浓度 + conscious 意识轴差分推进，
  反馈环（压力感受器、乳酸积分、呼吸抑制、镇静）。
- **表驱动**：`_HANDLERS` 动作分发表、`_EVENT_HANDLERS` 事件分发表、
  `_ASSESS_SPECS`、`DRUGS`、`LAB_KINDS`、`_LAB_FORMATTERS` 结果显示表。
- **命令面声明（SurfaceSpec）**：病例声明自己的评估目标/备药/对话角色/等待目标，
  引擎与前端面板都按 surface 渲染——新专科是数据，不是改命令层。
- **会话级解析**：引擎/动作层经 `case_of(state)` 读当前病例的
  course/physiology/narrative/surface——切换病例即换生理、文案与命令面。
- **通用内科状态机**：`InternalMedicineKernel(axis, coupling)` 一份固定方程服务所有病例；
  病例 = 初始条件（start_severity）+ 轴耦合表（coupling：轴如何移动共享舱室）+
  叙事 + 备药（surface.drugs）——新病例是数据，不是代码。
- **病例工厂**：`_build_case(...)` 一行定义新病例（现有 mvpb-1 出血 / mvpi-1 感染）。

扩展基座（新增业务对象的最小改动）：
- 新病例 → `_build_case(...)` 一行 + `CASES` 注册（含轴参数表、叙事文案、drug_keys）。
- 新药物 → `DRUGS` 加一项 DrugSpec（药代/副作用/过量阈值）+ 病例 `drug_keys` 声明。
- 新观察 → `_ASSESS_SPECS` 加一项（build/describe/trend 三个小函数）+ surface.assessments。
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
