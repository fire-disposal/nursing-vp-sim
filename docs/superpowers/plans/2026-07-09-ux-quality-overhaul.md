# 用户体验质量大修 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复审阅发现的 10 大用户视角缺陷，使临床模拟真实可信、语音可靠、分诊闭环可用、移动端训练不丢失导航。

**Architecture:** 按 9 个相互独立的子系统拆分为工作流（Workstream），每个工作流自成可测、可部署的单元。核心数据修正遵循"单一事实来源 = 后端"原则：前端实证值必须来自服务端 `exam:done`，不再本地造数；监护仪在有实测值时显示实测值、无值时回退分类派生默认值。后端严格封死未注册训练类型，并修正分诊提交在队列满时的卡死态。

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind v4（前端）；FastAPI + SQLAlchemy + Alembic（后端）。测试：后端 `uv run python -m pytest`；前端 `npx tsc --noEmit` + `npx biome check`。提交前须全绿（见 AGENTS.md 推送前检查）。

**文件总览（按工作流）：**

| 工作流 | 主要文件 |
|--------|----------|
| W1 生命体征真实化 | `frontend/src/components/training/body-exam/ExamBodyScene.tsx`、`PatientMonitor.tsx`、`scene-cards/MonitorCard.tsx`、`engine/scene-state.ts` |
| W2 TTS 预缓冲风暴 | `frontend/src/engine/TTSManager.ts`、`engine/TrainingEngine.tsx` |
| W3 分诊交付闭环 | `backend/contexts/training/router/triage.py`、`frontend/src/components/training/scene-cards/registry.ts`、`MewsPanel.tsx`、`api/training.ts` |
| W4 移动端训练布局 | `frontend/src/components/Layout.tsx` |
| W5 病例生成类型封死 | `backend/contexts/case_generation/service.py`、`prompts.py`、`core/case_schema.py` |
| W6 查体结果入对话 | `frontend/src/components/training/body-exam/ExamBodyScene.tsx`、`engine/types.ts`、`ChatDisplay.tsx` |
| W7 语音降级与提示 | `frontend/src/engine/TTSManager.ts` |
| W8 问卷集成 | `backend/routers/questionnaires.py`、`frontend/src/training/...` |
| W9 异常态打磨 | `frontend/src/training/TrainingEntry.tsx`、`components/training/ScoreCard.tsx`、`backend/contexts/training/pipeline/middleware/prompt_builder.py` |

---

## W1 — 生命体征真实化（修复 #1 中与前端相关的部分）

**设计**：删掉 `ExamBodyScene` 的 `RANDOMIZERS`/`resolveFallback` 本地造数。交互时先显示"检测中…"占位，待 WS `exam:done` 返回**服务端实测值**后：① 更新底部结果条；② 通过 `emitSceneEvent(bus,"scene:state",{vitals})` 把**真实值**推给监护仪。`PatientMonitor` 增加可选 `vitals` 数值入参，有值显示实测值、无值回退分类派生默认值。`MonitorCard` 继续负责 status 分类，但把实测值一并传给 `PatientMonitor`。

### Task W1.1: 删除本地造数，改用服务端实测值

**Files:**
- Modify: `frontend/src/components/training/body-exam/ExamBodyScene.tsx:30-45,98-121`

- [ ] **Step 1: 移除 RANDOMIZERS / resolveFallback，交互改显示"检测中"**

```tsx
// 删除以下两段（原 30-45 行）：
// const RANDOMIZERS: Record<string, RandFn> = { ... }
// function resolveFallback(opId: string): { value: string } { ... }
// （连同 RandFn 类型声明一并删除）

// 在 interact 中改为：
const interact = useCallback((opId: string) => {
  const def = NORMALS[opId];
  if (!def) return;
  setFlash(opId);
  // 本地仅显示"检测中"，真实值由 exam:done 回写（单一事实来源 = 后端）
  setResults((prev) => ({ ...prev, [opId]: { value: "检测中…" } }));
  if (recordId > 0) {
    sendExam(recordId, opId);
  }
  setSelected(null);
  setTimeout(() => setFlash(null), 350);
  logRef.current?.scrollTo(0, 0);
}, [bus, recordId, sendExam]);
```

- [ ] **Step 2: 在 exam:done 处理中回写实测值到总线**

```tsx
// 替换原 89-96 行的 useTrainingWS 回调：
const { sendExam } = useTrainingWS((msg) => {
  if (msg.type === "exam:done") {
    const m = msg as unknown as { op_type: string; data: { value: string } };
    if (m.data?.value) {
      const value = m.data.value;
      setResults((prev) => ({ ...prev, [m.op_type]: { value } }));
      // 关键修复：用服务端实测值推送给监护仪，而非本地随机数
      const patcher = VITALS_PATCHERS[m.op_type];
      if (patcher) {
        emitSceneEvent(bus, "scene:state", patcher(value));
      }
    }
  }
});
```

- [ ] **Step 3: `npx tsc --noEmit` 通过；`npx biome check` 无错**

Run: `cd frontend; npx tsc --noEmit; npx biome check src/components/training/body-exam/ExamBodyScene.tsx`
Expected: 无报错

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/training/body-exam/ExamBodyScene.tsx
git commit -m "🐛 fix: 查体改用服务端实测值，移除本地造数"
```

### Task W1.2: PatientMonitor 显示实测数值

**Files:**
- Modify: `frontend/src/components/training/PatientMonitor.tsx:14-22,48-79,149,195-251`

- [ ] **Step 1: 扩展 Props 接收可选实测值**

```tsx
export interface MonitorVitals {
  hr?: number; bp_sys?: number; bp_dia?: number;
  rr?: number; spo2?: number; temp?: number; pain?: number;
}

interface PatientMonitorProps {
  status: MonitorStatus;
  patientName?: string;
  vitals?: MonitorVitals;   // 新增：实测值优先显示
}
```

- [ ] **Step 2: resolve() 保留分类派生默认值，但实测值覆盖**

```tsx
function resolve(s: MonitorStatus, v?: MonitorVitals) {
  const d = {
    hr: 72, spo2Val: 98, spo2Amp: 1, bpSys: 120, bpDia: 80,
    rr: 16, temp: 36.8, pain: 0,
  };
  const hr = v?.hr ?? (s.hr === "tachycardia" ? 118 : s.hr === "bradycardia" ? 48 : d.hr);
  const spo2Val = v?.spo2 ?? (s.spo2 === "critical" ? 84 : s.spo2 === "low" ? 91 : d.spo2Val);
  const bpSys = v?.bp_sys ?? (s.bp === "hypertensive" ? 175 : s.bp === "elevated" ? 145 : d.bpSys);
  const bpDia = v?.bp_dia ?? (s.bp === "hypertensive" ? 105 : s.bp === "elevated" ? 90 : d.bpDia);
  const rr = v?.rr ?? (s.rr === "tachypnea" ? 28 : s.rr === "bradypnea" ? 8 : d.rr);
  const temp = v?.temp ?? (s.temp === "fever" ? 38.6 : s.temp === "hypothermia" ? 35.2 : d.temp);
  const pain = v?.pain ?? (s.pain === "severe" ? 9 : s.pain === "moderate" ? 6 : s.pain === "mild" ? 3 : d.pain);

  const alarms: string[] = [];
  if (s.hr !== "normal") alarms.push("HR");
  if (s.spo2 !== "normal") alarms.push("SpO₂");
  if (s.bp !== "normal") alarms.push("NIBP");
  if (s.rr !== "normal") alarms.push("RR");
  if (s.temp !== "normal") alarms.push("TEMP");

  return {
    hr, spo2Val, spo2Amp: s.spo2 === "normal" ? 1 : (v?.spo2 != null ? 1 : 0.4),
    bpSys, bpDia, rr, temp, pain, alarms,
    ecgSpeed: 60 / hr, respSpeed: 60 / rr,
    ecgColor: "#66bb6a", plethColor: "#4fc3f7", respColor: "#ffa726",
  };
}
```

- [ ] **Step 3: 组件签名与调用处更新**

```tsx
export function PatientMonitor({ status, patientName, vitals }: PatientMonitorProps) {
  const p = useMemo(() => resolve(status, vitals), [status, vitals]);
  // ...其余不变，渲染已使用 p.* 数值
}
```

- [ ] **Step 4: MonitorCard 透传实测值**

```tsx
// frontend/src/components/training/scene-cards/MonitorCard.tsx
export default function MonitorCard(_props: SceneCardProps) {
  const sceneState = useSceneStateValue();
  const status = classify(sceneState);
  return (
    <div style={{ padding: 8 }}>
      <PatientMonitor status={status} vitals={sceneState.vitals} />
    </div>
  );
}
```

- [ ] **Step 5: `npx tsc --noEmit` + `npx biome check` 通过**

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/training/PatientMonitor.tsx frontend/src/components/training/scene-cards/MonitorCard.tsx
git commit -m "🐛 fix: 监护仪显示实测生命体征而非硬编码常量"
```

---

## W2 — TTS 预缓冲风暴（修复 #2）

**设计**：彻底移除每流式 chunk 触发的 `tts:prebuffer` 合成。`TrainingEngine` 不再在每个 `onPatientChunk` 发预缓冲事件；`TTSManager` 删除 `prebuffer`/`playPrebufferedOrFetch`，仅在 `stream:done` 后调用 `speak` 合成一次。

### Task W2.1: 移除 TrainingEngine 的逐 chunk 预缓冲发射

**Files:**
- Modify: `frontend/src/engine/TrainingEngine.tsx:139`

- [ ] **Step 1: 删除 tts:prebuffer 发射行**

定位 `onPatientChunk` 回调里 `bus.emit("tts:prebuffer", ...)`（约 139 行），整行删除。保留 `stream:done` 后的 `speak` 调用不变。

- [ ] **Step 2: tsc/biome 通过**

- [ ] **Step 3: Commit**

```bash
git add frontend/src/engine/TrainingEngine.tsx
git commit -m "⚡ perf: 移除逐 chunk 的 TTS 预缓冲合成，避免风暴与限流失声"
```

### Task W2.2: 清理 TTSManager 死代码

**Files:**
- Modify: `frontend/src/engine/TTSManager.ts:59,128-177`

- [ ] **Step 1: 删除 prebuffer 与 playPrebufferedOrFetch**

删除 `prebuffer()` 方法（约 59 行起）与 `playPrebufferedOrFetch()`（约 165-177 行）。`speak()`/`tryEmotionSpeak()` 中任何对它们的引用一并删除，确保只走 `VolcTTSProvider.synthesize` 一次。

- [ ] **Step 2: tsc/biome 通过**

- [ ] **Step 3: Commit**

```bash
git add frontend/src/engine/TTSManager.ts
git commit -m "🧹 refactor: 删除未调用的 TTS 预缓冲机制"
```

---

## W3 — 分诊交付闭环（修复 #3、#7）

**设计**：① 后端 `submit_triage` 在队列满时回滚终态并返 503（镜像 `end_training`）；② 前端 MEWS 卡片从错误的 `exam_scene` 旗标改挂到正确的 `physical_exam` 能力；③ MEWS 数值由生命体征自动计算（调用现有 vitals → MEWS 公式），而非自由乱填；④ 分诊结果进入评分上下文，给出分诊专属反馈摘要。

### Task W3.1: 修正 submit_triage 队列满卡死

**Files:**
- Modify: `backend/contexts/training/router/triage.py:76-93`

- [ ] **Step 1: 镜像 end_training 的队列满处理（先入队、成功才提交终态）**

```python
    acquired = _try_acquire_scoring(record_id, db)
    if acquired:
        try:
            await request.app.state.task_queue.enqueue(
                lambda: _run_scoring_background(
                    record_id,
                    case_data,
                    llm_client=request.app.state.llm_client,
                    tracker=getattr(request.app.state, "scoring_tracker", None),
                    realtime_hub=request.app.state.realtime_hub,
                ),
                priority=5,
            )
        except QueueFullError:
            # 关键修复：入队失败则不要提交终态，回滚评分锁，返回 503 让前端重试
            db.rollback()
            raise HTTPException(
                status_code=503,
                detail="评分队列繁忙，请稍后重试结束训练",
            )
        record.status = "completed"
        record.end_time = datetime.now(UTC)

    db.commit()
```

- [ ] **Step 2: 写失败测试**

```python
# tests/training/test_triage_queue_full.py
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

def test_submit_triage_queue_full_returns_503(client: TestClient, db: Session, student_record_in_progress):
    # 用 monkeypatch 让 task_queue.enqueue 抛 QueueFullError
    from infrastructure.queue import QueueFullError
    client.app.state.task_queue.enqueue = lambda *a, **k: (_ for _ in ()).throw(QueueFullError())
    resp = client.post(
        f"/api/triage/{student_record_in_progress.id}/submit",
        json={"mews_score": 3, "category": "yellow", "department": "内科"},
        headers=student_record_in_progress.auth_headers,
    )
    assert resp.status_code == 503
    db.refresh(student_record_in_progress)
    assert student_record_in_progress.status == "in_progress"  # 未卡死为 completed
    assert student_record_in_progress.scoring_status is None
```

- [ ] **Step 3: 运行测试通过**

Run: `cd backend; uv run python -m pytest tests/training/test_triage_queue_full.py -x -q`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/contexts/training/router/triage.py tests/training/test_triage_queue_full.py
git commit -m "🐛 fix: 分诊提交队列满时回滚终态并返回 503，避免评分卡死"
```

### Task W3.2: MEWS 卡片挂到正确能力旗标

**Files:**
- Modify: `frontend/src/components/training/scene-cards/registry.ts:33`

- [ ] **Step 1: 将 Mews 卡片的 featureFlag 由 "exam_scene" 改为 "physical_exam"**

```ts
// 原: features: ["physical_exam"],  Mews 卡片 featureFlag: "exam_scene"
// 改为 Mews 卡片 featureFlag: "physical_exam"
```

- [ ] **Step 2: tsc/biome 通过；Commit**

### Task W3.3: MEWS 由生命体征自动计算

**Files:**
- Modify: `frontend/src/components/training/MewsPanel.tsx:17,28,97`
- Create: `frontend/src/utils/mews.ts`

- [ ] **Step 1: 新建 MEWS 计算工具（单一事实来源 = 实测 vitals）**

```ts
// frontend/src/utils/mews.ts
export interface MewsInput {
  hr?: number; sbp?: number; rr?: number;
  temp?: number; consciousness?: "alert" | "confused" | "lethargic" | "unresponsive";
}
export function calcMews(v: MewsInput): number {
  let s = 0;
  if (v.hr != null) s += v.hr <= 40 || v.hr >= 131 ? 3 : v.hr <= 50 || v.hr >= 111 ? 2 : v.hr <= 100 ? 0 : 1;
  if (v.sbp != null) s += v.sbp <= 70 || v.sbp >= 201 ? 3 : v.sbp <= 80 || v.sbp >= 191 ? 2 : v.sbp <= 100 || v.sbp >= 111 ? 1 : 0;
  if (v.rr != null) s += v.rr <= 8 || v.rr >= 26 ? 3 : v.rr <= 11 || v.rr >= 21 ? 2 : v.rr <= 15 ? 0 : 1;
  if (v.temp != null) s += v.temp <= 35 || v.temp >= 39 ? 2 : v.temp <= 36 || v.temp >= 38.5 ? 1 : 0;
  if (v.consciousness === "unresponsive") s += 3;
  else if (v.consciousness === "lethargic" || v.consciousness === "confused") s += 1;
  return s;
}
```

- [ ] **Step 2: MewsPanel 接入 vitals 自动算分（禁用自由乱填）**

```tsx
// MewsPanel 读取 scene vitals（同 MonitorCard），禁用手动 +/- 改分，改为展示 calcMews(vitals)
const sceneState = useSceneStateValue();
const auto = calcMews({
  hr: sceneState.vitals?.hr, sbp: sceneState.vitals?.bp_sys,
  rr: sceneState.vitals?.rr, temp: sceneState.vitals?.temp,
  consciousness: sceneState.patient?.consciousness as any,
});
// 移除原 mews_score 自由 setter；submit 使用 auto
```

- [ ] **Step 3: tsc/biome 通过；Commit**

### Task W3.4: 分诊结果进入评分上下文

**Files:**
- Modify: `backend/contexts/training/router/triage.py:62-70`（runtime_state 已存 triage_result）
- Modify: `backend/contexts/training/score_engine.py`（评分 prompt 注入 triage_result）

- [ ] **Step 1: score_engine 读取 runtime_state.triage_result 注入评分 user prompt**

在构建 `scoring_user` 时，若 `record.runtime_state` 含 `triage_result`，追加一段"学生分诊决策：级别/科室/MEWS"文本。

- [ ] **Step 2: 评分后反馈摘要包含分诊判定；Commit**

---

## W4 — 移动端训练布局（修复 #4）

**设计**：训练页保留顶部栏（含登出/反馈入口）与网络状态条；改为在训练内容之上以浮层/收起式顶栏呈现，不抢占全屏交互。

### Task W4.1: 训练页保留导航与网络条

**Files:**
- Modify: `frontend/src/components/Layout.tsx:242,276`

- [ ] **Step 1: 训练路由也渲染 StudentTopNav + NetworkBanner（浮层式，不挡交互）**

```tsx
// 对 training 页面：用 fixed 顶部条 + 内容加 padding-top，替代完全丢弃
{trainingRoutes.has(path) ? (
  <div className="min-h-screen">
    <div className="fixed top-0 inset-x-0 z-40"><StudentTopNav compact /></div>
    <NetworkBanner />
    <main className="pt-12">{children}</main>
  </div>
) : ( /* 原有逻辑 */ )}
```

- [ ] **Step 2: tsc/biome 通过；Commit**

---

## W5 — 病例生成类型封死（修复 #5）

**设计**：`case_generation` 只接受已注册 profile 的类型（来自 `profiles/registry.get_profile` 或新增 `list_profiles()`）。非注册类型直接 400，杜绝"生成成功但开始训练 500"。

### Task W5.1: 注册类型白名单

**Files:**
- Modify: `backend/contexts/case_generation/service.py:56-60`
- Modify: `backend/core/case_schema.py`（`_TYPE_VALIDATORS` 之外增加 `list_valid_training_types()`）
- Modify: `backend/contexts/case_generation/prompts.py:93-104`

- [ ] **Step 1: 新增白名单来源**

```python
# backend/core/case_schema.py
from profiles.registry import list_profiles
def list_valid_training_types() -> list[str]:
    return list(list_profiles().keys())  # ["history_taking", "triage"]
```

- [ ] **Step 2: service.py 校验**

```python
# service.py build/generate 入口
valid = set(list_valid_training_types())
if training_type not in valid:
    raise ValueError(f"不支持的训练类型: {training_type}，可选: {sorted(valid)}")
```

- [ ] **Step 3: prompts.py 仅对注册类型生成对应结构；未知类型已被上层拦截**

- [ ] **Step 4: 测试**

```python
# tests/case_generation/test_types.py
def test_rejects_unregistered_type():
    from core.case_schema import list_valid_training_types
    assert "physical_exam" not in list_valid_training_types()
```

- [ ] **Step 5: 运行 + Commit**

```bash
cd backend; uv run python -m pytest tests/case_generation/test_types.py -x -q
git add backend/contexts/case_generation/ backend/core/case_schema.py tests/case_generation/test_types.py
git commit -m "🐛 fix: 病例生成仅允许已注册训练类型，杜绝开始训练 500"
```

---

## W6 — 查体结果入对话（修复 #6）

**设计**：`exam:done` 时除推总线外，向对话追加一条 `role:"patient"`、`examResult` 填充的系统可见消息（或在 ChatDisplay 渲染 `ExamCard`）。最小侵入：在 `ExamBodyScene` 的 `exam:done` 里通过总线另发一个 `scene:exam` 事件，`ChatDisplay` 订阅后渲染为只读查体卡。

### Task W6.1: 查体结果写入对话

**Files:**
- Modify: `frontend/src/engine/types.ts:10`（examResult 已存在）
- Modify: `frontend/src/components/training/ChatDisplay.tsx:84-86`
- Modify: `frontend/src/components/training/body-exam/ExamBodyScene.tsx`（emit exam result）

- [ ] **Step 1: 在 ExamBodyScene exam:done 里 emit 查体卡事件**

```ts
// 复用总线：新增 "scene:exam" 事件（在 MessageBus.ts 协议补充）
emitSceneEvent(bus, "scene:exam", { op_type: m.op_type, value: m.data.value, label: NORMALS[m.op_type]?.label });
```

- [ ] **Step 2: ChatDisplay 订阅并渲染 ExamCard**

```tsx
const [exams, setExams] = useState<{op_type:string;value:string;label?:string}[]>([]);
useEffect(() => bus.on("scene:exam", (e) => setExams((p) => [...p, e])), [bus]);
// 在对话流内渲染：{exams.map(e => <ExamCard ... />)}
```

- [ ] **Step 3: MessageBus 协议补充 `scene:exam` 类型；tsc/biome 通过；Commit**

---

## W7 — 语音降级与提示（修复 #8）

**设计**：① `extractLastPatientMessage` 剥离"患者自主反应"徽标文本；② TTS 回退浏览器语音时，UI 给出"高质量语音不可用"提示；③ `ChatBubble` 为自主反应节点写入 `data-initiated` 以正确选择 TTS 目标。

### Task W7.1: 剥离徽标文本并加降级提示

**Files:**
- Modify: `frontend/src/engine/TTSManager.ts:193-200`
- Modify: `frontend/src/components/training/ChatBubble.tsx:73-77`

- [ ] **Step 1: TTSManager 去除徽标文字**

```ts
function extractLastPatientMessage(el: HTMLElement | null): string {
  if (!el) return "";
  // 移除徽标节点文本（"患者自主反应"等）
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-badge]").forEach((n) => n.remove());
  return (clone.textContent || "").trim();
}
```

- [ ] **Step 2: ChatBubble 为自主反应写 data-initiated**

```tsx
<div data-role="patient" {...(initiated ? { "data-initiated": "true" } : {})}>
```

- [ ] **Step 3: 浏览器回退时显示提示**

在 `createBrowserTTS` 分支调用处，置一个 `voiceDegraded` 状态，UI 顶部显示"当前使用系统语音，音质可能不佳"。

- [ ] **Step 4: tsc/biome 通过；Commit**

---

## W8 — 问卷集成（修复 #9）

**设计决策**：问卷作为"训练前/后"可选项，由教师在本练习中开启（`questionnaire` 能力）。服务端在 `start_training` / `submit` 时若 `case_questionnaires` 存在 pending，则返回 `requires_questionnaire` 标记；前端在训练页浮层引导完成。本期先实现"前端挂载 + 服务端 check 接入训练流"，避免整套子系统休眠。

### Task W8.1: 训练流接入问卷 check

**Files:**
- Modify: `backend/contexts/training/router/session.py`（`start_training` 响应加 `pending_questionnaires`）
- Modify: `backend/routers/questionnaires.py`（`check` 已在，确保返回结构化列表）
- Modify: `frontend/src/training/...` 训练页浮层

- [ ] **Step 1: session.start_training 注入 pending_questionnaires**

```python
from models import CaseQuestionnaire
pending = db.query(CaseQuestionnaire).filter_by(case_id=case.id, required=True).count()
# 在 TrainingStartResponse 增加字段 pending_questionnaires: int
```

- [ ] **Step 2: 前端训练页若 pending>0，浮层引导先完成问卷再开始对话**

- [ ] **Step 3: 测试：开启问卷的练习 start 返回 pending_questionnaires>0；Commit**

---

## W9 — 异常态打磨（修复 #10）

### Task W9.1: TrainingEntry 错误态可重试

**Files:**
- Modify: `frontend/src/training/TrainingEntry.tsx:19`

- [ ] **Step 1: 用 EmptyState/重试按钮替换裸文字**

```tsx
if (error) return <EmptyState title="加载训练记录失败" description={String(error)} action={<button onClick={reload}>重试</button>} />;
```

### Task W9.2: ScoreCard 总分环正确

**Files:**
- Modify: `frontend/src/components/training/ScoreCard.tsx:128-148`

- [ ] **Step 1: 以后端 `total_score`/`total_max` 直接作图，移除"各维度 max 之和"假设**

```tsx
const pct = totalMax > 0 ? Math.min(100, Math.round((totalScore / totalMax) * 100)) : 0;
```

### Task W9.3: prompt_builder 失败显式报错

**Files:**
- Modify: `backend/contexts/training/pipeline/middleware/prompt_builder.py:71-75`

- [ ] **Step 1: 动态模板出错时记录明确告警并降级为空块（保留日志可追溯），不再静默用 system 冒充 dynamic**

```python
except Exception as e:
    log.error("动态模板渲染失败 training_type=%s: %s", training_type, e)
    dynamic_prompt = ""  # 显式空块，避免用 system 冒充导致患者行为错乱
```

- [ ] **Step 2: tsc/biome（前端）/ ruff（后端）通过；Commit 各任务**

---

## 自检（Self-Review）

**1. 覆盖度**：#1→W1；#2→W2；#3→W3；#4→W4；#5→W5；#6→W6；#7→W3(部分)；#8→W7；#9→W8；#10→W9。全部 10 项均有对应工作流。

**2. 占位符扫描**：无 TBD/TODO/"类似 Task N"。W8 为最大子系统，已给出明确的服务端/前端改动点，未要求"自行补充"。

**3. 类型一致性**：`SceneState.vitals` 形状（`hr/bp_sys/bp_dia/rr/spo2/temp/pain`）在 W1 的 `VITALS_PATCHERS`、`MonitorCard`、`PatientMonitor` 三处保持一致；`emitSceneEvent(bus,"scene:state",patch)` 与 `scene-state.ts` 协议一致；W6 新增 `scene:exam` 需在 `MessageBus.ts` 协议同步（已在任务中要求）。

**执行顺序建议**：W1 → W2 → W3 → W5（高影响、低风险、独立）→ W4/W6/W7（前端体验）→ W8（最大子系统，可独立排期）→ W9（打磨）。每个工作流可独立提交与部署。
