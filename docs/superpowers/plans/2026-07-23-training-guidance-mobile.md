# 训练页引导与移动端体验优化 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **注意**: 本仓库规则 — 未经用户明确要求**禁止 git commit**，所有"验证检查点"只跑测试与 lint，不提交。

**Goal:** 恢复护理记录评分维度并修复其工具加载卡死问题；以 v0 问诊进度列表为蓝本升级问诊引导（进度 chip 与情绪栏共用一条状态栏）；修复训练页移动端体验。

**Architecture:** 后端精确回滚 `e94d7701` 的禁用（rubric_builder 维度追加 + score_engine sheet_data 注入）；前端新增纯函数模块 `inquiryProgress.ts` 复用 v0 bigram 匹配，`InquiryProgressChip` 通过 EmotionIndicator 的 `trailing` 插槽注入，点击经 bus 事件 `tool:open` 打开问诊指引面板；移动端 h-screen→h-dvh + 工具栏文字标签 + WelcomeScreen 流程引导。

**Tech Stack:** FastAPI + SQLAlchemy + pytest（backend）；React 19 + TS + vitest + testing-library（frontend）。

**Spec:** `docs/superpowers/specs/2026-07-23-training-guidance-mobile-design.md`

---

### Task 1: 恢复 rubric_builder 护理记录维度

**Files:**
- Modify: `backend/contexts/training/rubric_builder.py:63-82`
- Test: `backend/tests/scoring/test_rubric_builder.py`

- [ ] **Step 1: 先翻转测试（红）**

修改 `backend/tests/scoring/test_rubric_builder.py` 中两个 [DISABLED] 测试：

```python
    def test_with_nursing_record_enabled(self):
        result = build_final_rubric(BASE_RUBRIC, features={"nursing_record": True})
        assert result["raw_max"] == 72  # 57 + 15
        assert len(result["dimensions"]) == 2
        dim_ids = [d["id"] for d in result["dimensions"]]
        assert "nursing_record" in dim_ids
        nr_dim = next(d for d in result["dimensions"] if d["id"] == "nursing_record")
        assert nr_dim["max"] == 15
        assert len(nr_dim["items"]) == 5
        assert len(BASE_RUBRIC["dimensions"]) == 1  # original untouched
        assert BASE_RUBRIC["raw_max"] == 57
```

```python
    def test_idempotent_double_call(self):
        r1 = build_final_rubric(BASE_RUBRIC, features={"nursing_record": True})
        r2 = build_final_rubric(r1, features={"nursing_record": True})
        assert len(r2["dimensions"]) == 2  # 不重复追加
        assert r2["raw_max"] == 72
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend; uv run pytest tests/scoring/test_rubric_builder.py -x -q`
Expected: FAIL（`test_with_nursing_record_enabled` 断言 72 != 57）

- [ ] **Step 3: 取消注释恢复实现**

`backend/contexts/training/rubric_builder.py` 的 `build_final_rubric` 改为：

```python
def build_final_rubric(base_rubric: dict, features: dict | None = None) -> dict:
    """返回最终评分 rubric（深拷贝，不修改入参）。

    Args:
        base_rubric: profile.rubric 或 load_rubric() 返回的基准 rubric dict
        features: resolve_features 后的能力开关 dict（检查 nursing_record 键）

    Returns:
        深拷贝后的 rubric dict；若 nursing_record 开启则追加护理记录维度并调高 raw_max
    """
    rubric = deepcopy(base_rubric)
    if features and features.get("nursing_record"):
        existing_ids = {d.get("id") for d in rubric.get("dimensions", [])}
        if "nursing_record" not in existing_ids:
            rubric.setdefault("dimensions", []).append(deepcopy(_NURSING_RECORD_DIMENSION))
            rubric["raw_max"] = rubric.get("raw_max", 57) + 15
    return rubric
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend; uv run pytest tests/scoring/test_rubric_builder.py -x -q`
Expected: PASS（6 passed）

- [ ] **Step 5: 验证检查点** — `cd backend; uv run ruff check contexts/training/rubric_builder.py`

---

### Task 2: 恢复 score_engine 护理记录注入

**Files:**
- Modify: `backend/contexts/training/score_engine.py`（imports、新增 helper、`_build_history_messages`、`evaluate_training`）
- Test: `backend/tests/scoring/test_nursing_record_injection.py`（新建）

- [ ] **Step 1: 写失败测试（红）**

新建 `backend/tests/scoring/test_nursing_record_injection.py`：

```python
"""护理记录评分注入测试：sheet_data → 评分 prompt"""

from copy import deepcopy
from types import SimpleNamespace

from contexts.training.score_engine import _build_history_messages, _load_nursing_record_text
from models import NursingRecord, TrainingRecord

CASE_DATA_WITH_NR = {
    "patient_info": {"name": "张大妈", "age": 62, "gender": "女"},
    "chief_complaint": "胸闷三天",
    "opening_line": "医生你好...",
    "present_illness": "胸闷三天",
    "required_inquiries": ["胸闷持续时间"],
    "capabilities": {"nursing_record": True},
    "personality": {"health_literacy": "normal", "verbosity": "normal"},
}


def _start_record(client, student, test_case, db_session, capabilities):
    _user, token = student
    case_data = deepcopy(CASE_DATA_WITH_NR)
    case_data["capabilities"] = capabilities
    test_case.case_data = case_data
    test_case.is_open = True
    db_session.commit()
    resp = client.post(
        "/api/training/start",
        json={"case_id": test_case.id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    record_id = resp.json()["record_id"]
    record = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    return record, _user


class TestLoadNursingRecordText:
    def test_enabled_with_sheet_data_returns_formatted(self, client, student, test_case, db_session):
        record, user = _start_record(client, student, test_case, db_session, {"nursing_record": True})
        db_session.add(NursingRecord(
            record_id=record.id, user_id=user.id,
            sheet_data={"subjective": "患者诉胸闷", "objective": "BP 130/80", "assessment": "", "plan": "卧床休息", "evaluation": ""},
            status="draft",
        ))
        db_session.commit()
        text = _load_nursing_record_text(db_session, record)
        assert "SUBJECTIVE: 患者诉胸闷" in text
        assert "OBJECTIVE: BP 130/80" in text
        assert "PLAN: 卧床休息" in text
        assert "ASSESSMENT" not in text  # 空字段跳过

    def test_enabled_without_record_returns_empty(self, client, student, test_case, db_session):
        record, _user = _start_record(client, student, test_case, db_session, {"nursing_record": True})
        assert _load_nursing_record_text(db_session, record) == ""

    def test_disabled_returns_empty(self, client, student, test_case, db_session):
        record, user = _start_record(client, student, test_case, db_session, {"nursing_record": False})
        db_session.add(NursingRecord(
            record_id=record.id, user_id=user.id,
            sheet_data={"subjective": "患者诉胸闷"}, status="draft",
        ))
        db_session.commit()
        assert _load_nursing_record_text(db_session, record) == ""


class TestBuildHistoryMessagesInjection:
    def _build(self, nursing_record_text=""):
        record = SimpleNamespace(runtime_state={})
        msgs, _exam, nr_text = _build_history_messages(
            record, "评分标准TEXT", "清单TEXT", "schemaTEXT", "对话TEXT",
            nursing_record_text=nursing_record_text,
        )
        return msgs, nr_text

    def test_appends_record_to_criteria(self):
        msgs, nr_text = self._build("SUBJECTIVE: 患者诉胸闷")
        system = msgs[0]["content"]
        assert "## 学生提交的护理评估记录" in system
        assert "SUBJECTIVE: 患者诉胸闷" in system
        assert nr_text == "SUBJECTIVE: 患者诉胸闷"

    def test_empty_text_no_append(self):
        msgs, _ = self._build("")
        system = msgs[0]["content"]
        assert "学生提交的护理评估记录" not in system
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend; uv run pytest tests/scoring/test_nursing_record_injection.py -x -q`
Expected: FAIL（`ImportError: cannot import name '_load_nursing_record_text'` 或 TypeError）

- [ ] **Step 3: 实现**

`backend/contexts/training/score_engine.py`：

a) imports 行恢复 `NursingRecord`：
```python
from models import Message, NursingRecord, Score, TrainingRecord
```

b) 在 `_build_history_messages` 之前新增 helper：

```python
def _load_nursing_record_text(db: Session, record: TrainingRecord) -> str:
    """护理记录评分注入：nursing_record 能力开启时，读取学生填写的 sheet_data 并格式化。"""
    features = (record.practice_snapshot or {}).get("features", {})
    if not features.get("nursing_record"):
        return ""
    nr = db.query(NursingRecord).filter(NursingRecord.record_id == record.id).first()
    if not nr or not nr.sheet_data:
        return ""
    parts = []
    for field_name in ("subjective", "objective", "assessment", "plan", "evaluation"):
        val = nr.sheet_data.get(field_name, "")
        if val:
            parts.append(f"{field_name.upper()}: {val}")
    return "\n\n".join(parts)
```

c) `_build_history_messages` 签名与注入改为：

```python
def _build_history_messages(
    record: TrainingRecord,
    scoring_criteria_text: str,
    required_inquiries_text: str,
    scoring_json_schema_text: str,
    conversation_text: str,
    nursing_record_text: str = "",
) -> tuple[list[dict], str, str]:
    exam_results_raw = (record.runtime_state or {}).get("exam_results", [])
    exam_results_text = (
        json.dumps(exam_results_raw, ensure_ascii=False, indent=2) if exam_results_raw else "学生未执行任何查体操作"
    )

    # 使护理记录内容对 LLM 可见（追加在评分标准之后，LLM 据此对 rubric 维度对照打分）
    if nursing_record_text:
        scoring_criteria_text = f"{scoring_criteria_text}\n\n## 学生提交的护理评估记录\n{nursing_record_text}"

    pc = PromptContext()
    # …（其余不变）
```

（删除旧的 `# [DISABLED] … nursing_record_text = ""` 两行。）

d) `evaluate_training` 调用处改为：

```python
    if training_type == "triage":
        score_messages, exam_results_text, nursing_record_text = _build_triage_messages(record, case_data)
    else:
        nursing_record_text = _load_nursing_record_text(db, record)
        score_messages, exam_results_text, nursing_record_text = _build_history_messages(
            record, scoring_criteria_text, required_inquiries_text, scoring_json_schema_text, conversation_text,
            nursing_record_text=nursing_record_text,
        )
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend; uv run pytest tests/scoring/test_nursing_record_injection.py -x -q`
Expected: PASS（5 passed）

- [ ] **Step 5: 翻转快照集成测试**

`backend/tests/training/test_snapshot_isolation.py:89-114`，`test_nursing_record_enabled_stores_full_rubric` 改为：

```python
    def test_nursing_record_enabled_stores_full_rubric(self, client, student, test_case, db_session):
        """开启 nursing_record 时，rubric_snapshot 含护理维度且 raw_max +15"""
        _user, token = student

        case_data = deepcopy(ORIGINAL_CASE_DATA)
        case_data["capabilities"] = {"nursing_record": True}
        test_case.case_data = case_data
        test_case.is_open = True
        db_session.commit()

        resp = client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.text
        record_id = resp.json()["record_id"]

        record = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        assert record.rubric_snapshot is not None
        assert record.case_snapshot is not None

        dims = record.rubric_snapshot.get("dimensions", [])
        dim_ids = [d["id"] for d in dims]
        assert "nursing_record" in dim_ids, "开启 nursing_record 后 rubric_snapshot 应含护理维度"
        assert record.rubric_snapshot.get("raw_max") == 72
```

- [ ] **Step 6: 跑相关测试 + lint**

Run: `cd backend; uv run pytest tests/training/test_snapshot_isolation.py tests/scoring/ -x -q; uv run ruff check contexts/training/score_engine.py; uv run ty check contexts/training/score_engine.py`
Expected: 全 PASS，lint/type 干净

---

### Task 3: NursingRecordTool 错误态与超时（修「加载不出来」）

**Files:**
- Modify: `frontend/src/components/training/tools/NursingRecordTool.tsx`
- Test: `frontend/src/__tests__/training/NursingRecordTool.test.tsx`（新建）

- [ ] **Step 1: 写失败测试（红）**

新建 `frontend/src/__tests__/training/NursingRecordTool.test.tsx`：

```tsx
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NursingRecordTool from "@/components/training/tools/NursingRecordTool";

type Handler = (payload: Record<string, unknown>) => void;

function makeBus() {
	const handlers = new Map<string, Set<Handler>>();
	const invoked: Array<Record<string, unknown>> = [];
	return {
		invoked,
		emit(event: string, payload?: unknown) {
			if (event === "tool:invoke") invoked.push(payload as Record<string, unknown>);
			handlers.get(event)?.forEach((h) => h(payload as Record<string, unknown>));
		},
		on(event: string, h: Handler) {
			if (!handlers.has(event)) handlers.set(event, new Set());
			handlers.get(event)!.add(h);
			return () => { handlers.get(event)?.delete(h); };
		},
		off(event: string, h: Handler) { handlers.get(event)?.delete(h); },
		listEvents() { return [...handlers.keys()]; },
		fireResult(payload: Record<string, unknown>) {
			handlers.get("tool:result")?.forEach((h) => h(payload));
		},
	};
}

describe("NursingRecordTool", () => {
	beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: false }); });
	afterEach(() => { vi.useRealTimers(); });

	it("mount 时发出 load 请求", () => {
		const bus = makeBus();
		render(<NursingRecordTool recordId="1" bus={bus} recordDetail={null} />);
		expect(bus.invoked.some((p) => p.action === "load")).toBe(true);
	});

	it("load 成功时渲染表单并回填 sheet_data", () => {
		const bus = makeBus();
		render(<NursingRecordTool recordId="1" bus={bus} recordDetail={null} />);
		act(() => {
			bus.fireResult({ tool: "nursing_record", action: "load", ok: true, data: { sheet_data: { subjective: "患者诉胸闷" } } });
		});
		expect(screen.getByDisplayValue("患者诉胸闷")).toBeTruthy();
	});

	it("load ok=false 时显示错误与重试，重试重新发出 load", async () => {
		const bus = makeBus();
		render(<NursingRecordTool recordId="1" bus={bus} recordDetail={null} />);
		act(() => {
			bus.fireResult({ tool: "nursing_record", action: "load", ok: false, data: {}, error: "本次训练未启用护理评估记录" });
		});
		expect(screen.getByText("本次训练未启用护理评估记录")).toBeTruthy();
		const before = bus.invoked.filter((p) => p.action === "load").length;
		await userEvent.click(screen.getByText("重试"));
		expect(bus.invoked.filter((p) => p.action === "load").length).toBe(before + 1);
	});

	it("8 秒无响应时显示超时错误", () => {
		const bus = makeBus();
		render(<NursingRecordTool recordId="1" bus={bus} recordDetail={null} />);
		act(() => { vi.advanceTimersByTime(8000); });
		expect(screen.getByText(/加载超时/)).toBeTruthy();
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend; npx vitest run src/__tests__/training/NursingRecordTool.test.tsx`
Expected: FAIL（错误态不存在、超时不触发）

- [ ] **Step 3: 实现**

`frontend/src/components/training/tools/NursingRecordTool.tsx` 改动点（其余逻辑不变）：

a) imports 加 `AlertCircle`：
```tsx
import { AlertCircle, FileText, Loader2, Save } from "lucide-react";
```

b) 组件顶部加常量与状态：
```tsx
const LOAD_TIMEOUT_MS = 8000;
```
```tsx
	const [loadError, setLoadError] = useState<string | null>(null);
	const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

c) 替换原 `useEffect(() => { bus.emit(...load...) }, [bus, rid])` 为：
```tsx
	const requestLoad = useCallback(() => {
		setLoading(true);
		setLoadError(null);
		bus.emit("tool:invoke", { tool: "nursing_record", action: "load", params: {}, recordId: rid });
		if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
		loadTimeoutRef.current = setTimeout(() => {
			setLoading(false);
			setLoadError("加载超时：实时连接可能已中断，请检查网络后重试");
		}, LOAD_TIMEOUT_MS);
	}, [bus, rid]);

	useEffect(() => {
		requestLoad();
		return () => {
			if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
		};
	}, [requestLoad]);
```

d) `onResult` 改为（load 分支清定时器 + 失败分支；save 分支加失败处理）：
```tsx
		const onResult = (payload: { tool: string; action: string; ok: boolean; data: Record<string, unknown>; error?: string }) => {
			if (payload.tool !== "nursing_record") return;
			if (payload.action === "load") {
				if (loadTimeoutRef.current) {
					clearTimeout(loadTimeoutRef.current);
					loadTimeoutRef.current = null;
				}
				if (payload.ok) {
					const sd = (payload.data.sheet_data as SheetData) || {};
					setSheet((prev) => {
						if (dirtyRef.current) return prev;
						if (Object.keys(prev).length > 0) return prev;
						return sd;
					});
					setLoading(false);
				} else {
					setLoading(false);
					setLoadError(payload.error || "加载护理记录失败");
				}
			}
			if (payload.action === "save") {
				if (payload.ok) {
					setSaveStatus("saved");
					setLastSavedAt(
						new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
					);
				} else {
					setSaveStatus("error");
				}
			}
		};
```

e) 在 loading 分支后加错误态渲染：
```tsx
	if (loadError) {
		return (
			<div className="flex flex-col items-center justify-center gap-2 h-32 text-muted-foreground p-3">
				<AlertCircle size={18} className="text-danger" />
				<span className="text-xs text-center">{loadError}</span>
				<button
					type="button"
					onClick={requestLoad}
					className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted"
				>
					重试
				</button>
			</div>
		);
	}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd frontend; npx vitest run src/__tests__/training/NursingRecordTool.test.tsx`
Expected: PASS（4 passed）

- [ ] **Step 5: 验证检查点** — `cd frontend; npx tsc --noEmit; npx biome check src/components/training/tools/NursingRecordTool.tsx src/__tests__/training/NursingRecordTool.test.tsx`

---

### Task 4: 问诊进度共享逻辑（v0 bigram 算法）

**Files:**
- Create: `frontend/src/components/training/tools/inquiryProgress.ts`
- Test: `frontend/src/__tests__/training/inquiryProgress.test.ts`（新建）

- [ ] **Step 1: 写失败测试（红）**

新建 `frontend/src/__tests__/training/inquiryProgress.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { computeCovered, extractKeywords, getInquiryLabel } from "@/components/training/tools/inquiryProgress";

describe("extractKeywords（v0 bigram）", () => {
	it("生成去重 2 字 token", () => {
		const kws = extractKeywords("胸闷持续时间");
		expect(kws).toContain("胸闷");
		expect(kws).toContain("持续");
		expect(kws).toContain("时间");
	});

	it("括号内容被剔除", () => {
		const kws = extractKeywords("既往史（高血压、糖尿病）");
		expect(kws).toContain("既往");
		expect(kws.some((k) => k.includes("高"))).toBe(false);
	});
});

describe("getInquiryLabel", () => {
	it("去除括号说明并截断", () => {
		expect(getInquiryLabel("疼痛性质（刺痛/钝痛/放射痛）")).toBe("疼痛性质");
	});
});

describe("computeCovered", () => {
	it("任一大词条命中学生发言即覆盖", () => {
		const covered = computeCovered(["胸闷持续时间", "既往心脏病史"], "请问您胸闷多久了");
		expect(covered.has(0)).toBe(true);
		expect(covered.has(1)).toBe(false);
	});

	it("无学生发言时零覆盖", () => {
		expect(computeCovered(["胸闷持续时间"], "").size).toBe(0);
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend; npx vitest run src/__tests__/training/inquiryProgress.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

新建 `frontend/src/components/training/tools/inquiryProgress.ts`（算法移植自首个提交 `0cc1d661` `ChatTraining.jsx` 的 `InquirySidebar`）：

```ts
/**
 * 问诊进度匹配 — 移植自本系统首个提交（v0 ChatTraining.jsx InquirySidebar）。
 * 双字 bigram 滑窗：问诊项去括号后取全部相邻 2 字 token，
 * 任一 token 出现在学生全部发言拼接文本中即视为该项已覆盖。
 * 宽松匹配、仅供参考，用于实时引导而非评分。
 */

export function extractKeywords(inquiry: string): string[] {
	const cleaned = inquiry.replace(/[（）()]/g, " ");
	const tokens: string[] = [];
	for (let i = 0; i < cleaned.length - 1; i++) {
		tokens.push(cleaned.slice(i, i + 2));
	}
	return [...new Set(tokens.filter((t) => t.trim().length === 2))];
}

export function getInquiryLabel(inquiry: string): string {
	return inquiry.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").slice(0, 18);
}

/** 返回已覆盖项的索引集合 */
export function computeCovered(inquiries: string[], studentText: string): Set<number> {
	const result = new Set<number>();
	if (!studentText) return result;
	inquiries.forEach((inquiry, idx) => {
		const keywords = extractKeywords(inquiry);
		if (keywords.length > 0 && keywords.some((kw) => studentText.includes(kw))) {
			result.add(idx);
		}
	});
	return result;
}

/** 进度配色阈值（沿用 v0）：<40 红 / <80 琥珀 / >=80 绿 */
export function progressColor(pct: number): "danger" | "warning" | "success" {
	if (pct >= 80) return "success";
	if (pct >= 40) return "warning";
	return "danger";
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd frontend; npx vitest run src/__tests__/training/inquiryProgress.test.ts`
Expected: PASS（5 passed）

- [ ] **Step 5: 验证检查点** — `cd frontend; npx tsc --noEmit`

---

### Task 5: InquiryTool 升级为 v0 风格进度列表

**Files:**
- Modify: `frontend/src/components/training/tools/InquiryTool.tsx`

- [ ] **Step 1: 重写组件**

`frontend/src/components/training/tools/InquiryTool.tsx` 全文替换为：

```tsx
import { CheckCircle2, Circle } from "lucide-react";
import { useMemo } from "react";
import type { TrainingToolProps } from "@/engine/TrainingTool";
import { useTrainingContext } from "@/engine/TrainingContext";
import type { ChatMessage } from "@/engine/types";
import { cn } from "@/utils/cn";
import { computeCovered, getInquiryLabel, progressColor } from "./inquiryProgress";

export default function InquiryTool(props: TrainingToolProps) {
	const { messages } = useTrainingContext();

	const inquiries: string[] = useMemo(() => {
		const cd = (props.recordDetail?.case_data as Record<string, unknown>) ?? {};
		return (cd.required_inquiries as string[]) ?? [];
	}, [props.recordDetail]);

	const studentText = useMemo(
		() =>
			(messages as ChatMessage[])
				.filter((m) => m.role === "student")
				.map((m) => String(m.content || ""))
				.join(""),
		[messages],
	);

	const covered = useMemo(() => computeCovered(inquiries, studentText), [inquiries, studentText]);

	if (inquiries.length === 0) {
		return <div className="text-sm text-muted-foreground text-center py-8 p-3">该病例未配置问诊清单</div>;
	}

	const doneCount = covered.size;
	const total = inquiries.length;
	const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
	const color = progressColor(pct);

	return (
		<div className="p-3">
			{/* 进度条（v0 配色阈值） */}
			<div className="mb-3">
				<div className="flex items-center justify-between mb-1">
					<span className="text-xs text-muted-foreground">关键问诊内容覆盖</span>
					<span
						className={cn(
							"text-xs font-bold tabular-nums",
							color === "success" && "text-success-foreground",
							color === "warning" && "text-warning",
							color === "danger" && "text-danger",
						)}
					>
						{doneCount}/{total}
					</span>
				</div>
				<div className="h-1.5 rounded-full bg-muted overflow-hidden">
					<div
						className={cn(
							"h-full rounded-full transition-all duration-500",
							color === "success" && "bg-success",
							color === "warning" && "bg-warning",
							color === "danger" && "bg-danger",
						)}
						style={{ width: `${pct}%` }}
					/>
				</div>
			</div>

			{/* 清单 */}
			<div className="space-y-1">
				{inquiries.map((inq, i) => {
					const done = covered.has(i);
					return (
						<div key={i} className="flex items-start gap-2 py-1.5">
							{done ? (
								<CheckCircle2 size={14} className="text-success-foreground mt-0.5 shrink-0" />
							) : (
								<Circle size={14} className="text-muted-foreground/30 mt-0.5 shrink-0" />
							)}
							<span
								className={cn(
									"text-sm leading-snug",
									done ? "line-through text-muted-foreground" : "text-foreground",
								)}
								title={inq}
							>
								{getInquiryLabel(inq)}
							</span>
						</div>
					);
				})}
			</div>

			<p className="mt-3 pt-2 border-t border-border text-[11px] text-muted-foreground/70 leading-relaxed">
				提示：系统根据对话关键词自动匹配，仅供参考。建议按护理评估框架全面采集病史。
			</p>
		</div>
	);
}
```

- [ ] **Step 2: 验证检查点**

Run: `cd frontend; npx tsc --noEmit; npx biome check src/components/training/tools/InquiryTool.tsx`
Expected: 干净

---

### Task 6: InquiryProgressChip + EmotionIndicator trailing + tool:open 打通

**Files:**
- Create: `frontend/src/components/training/InquiryProgressChip.tsx`
- Modify: `frontend/src/components/training/EmotionIndicator.tsx`（props + 两处布局注入）
- Modify: `frontend/src/components/training/ChatArea.tsx`（注入 chip）
- Modify: `frontend/src/components/training/SceneRenderer.tsx`（监听 tool:open）
- Modify: `frontend/src/components/training/SceneToolbar.tsx`（监听 tool:open）

- [ ] **Step 1: 新建 InquiryProgressChip**

`frontend/src/components/training/InquiryProgressChip.tsx`：

```tsx
import { ListChecks } from "lucide-react";
import { useMemo } from "react";
import { useTrainingContext } from "@/engine/TrainingContext";
import { computeCovered } from "./tools/inquiryProgress";

/**
 * 问诊进度徽章 — 注入 EmotionIndicator trailing 插槽，与情绪栏共用一条状态栏。
 * 点击经 bus 发出 tool:open，由 SceneRenderer（桌面）/ SceneToolbar（移动）打开问诊指引面板。
 */
export function InquiryProgressChip() {
	const { bus, messages, recordDetail } = useTrainingContext();

	const inquiries: string[] = useMemo(() => {
		const cd = (recordDetail?.case_data as Record<string, unknown>) ?? {};
		return (cd.required_inquiries as string[]) ?? [];
	}, [recordDetail]);

	const studentText = useMemo(
		() =>
			messages
				.filter((m) => m.role === "student")
				.map((m) => String(m.content || ""))
				.join(""),
		[messages],
	);

	const covered = useMemo(() => computeCovered(inquiries, studentText), [inquiries, studentText]);

	if (inquiries.length === 0) return null;

	const done = covered.size;
	const total = inquiries.length;

	return (
		<button
			type="button"
			onClick={() => bus.emit("tool:open", { id: "inquiry" })}
			className="flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-border bg-card text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
			title={`问诊目标 ${done}/${total}，点击查看指引`}
		>
			<ListChecks size={12} />
			<span className="tabular-nums">{done}/{total}</span>
			{done < total && <span className="size-1.5 rounded-full bg-warning" />}
		</button>
	);
}
```

- [ ] **Step 2: EmotionIndicator 加 trailing 插槽**

`frontend/src/components/training/EmotionIndicator.tsx`：

a) imports 加 `import type { ReactNode } from "react";`（并入现有 react import：`import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";`）

b) props 接口加：
```tsx
interface EmotionIndicatorProps {
	bus: MessageBus;
	capabilities: Record<string, boolean>;
	recordId: number;
	compact?: boolean;
	/** 右侧注入位（如问诊进度 chip），与情绪栏共用一条状态栏 */
	trailing?: ReactNode;
}
```
函数签名加 `trailing` 解构。

c) compact 布局（第 190 行附近的 flex row）改为：
```tsx
				<div className="flex items-center gap-1.5">
					<span
						className={cn(
							"text-sm leading-none transition-transform duration-300",
							emojiPop && "scale-125",
						)}
					>
						{EMOTION_ICONS[emotion]}
					</span>
					<span className="text-[11px] text-muted-foreground truncate">{label}</span>
					<div className="ml-auto flex items-center gap-2">
						{showInitiative && initPercent > 0 && (
							<div className="h-1 w-12 rounded-full bg-muted overflow-hidden shrink-0">
								<div
									className={cn(
										"h-full rounded-full transition-all duration-1000",
										initPercent > 80 ? "bg-danger" : initPercent > 50 ? "bg-warning" : "bg-success",
									)}
									style={{ width: `${Math.min(100, initPercent)}%` }}
								/>
							</div>
						)}
						{trailing}
					</div>
				</div>
```

d) 完整布局：在 initiative 块（`{showInitiative && initPercent > 0 && (...)}`，第 254-267 行）之后、`</div>` 收尾前加：
```tsx
				{trailing}
```

- [ ] **Step 3: ChatArea 注入 chip**

`frontend/src/components/training/ChatArea.tsx`：两处 EmotionIndicator 调用加 trailing：

```tsx
						{isCompact ? (
							<EmotionIndicator bus={bus} capabilities={capabilities} recordId={recordId} compact trailing={<InquiryProgressChip />} />
						) : (
							<EmotionIndicator bus={bus} capabilities={capabilities} recordId={recordId} trailing={<InquiryProgressChip />} />
						)}
```
并加 import：`import { InquiryProgressChip } from "./InquiryProgressChip";`

- [ ] **Step 4: SceneRenderer / SceneToolbar 监听 tool:open**

`SceneRenderer.tsx`：imports 加 `useEffect`；组件内 `useToolBridge(bus);` 后加：

```tsx
  useEffect(() => {
    const handler = (payload: { id: string }) => {
      // 仅桌面端响应（移动端由 SceneToolbar 处理），避免双面板同开
      if (!window.matchMedia("(min-width: 768px)").matches) return;
      if (tools.some((t) => t.id === payload.id)) setActiveId(payload.id);
    };
    return bus.on("tool:open", handler);
  }, [bus, tools]);
```

`SceneToolbar.tsx`：同样位置加（条件相反）：

```tsx
  useEffect(() => {
    const handler = (payload: { id: string }) => {
      // 仅移动端响应（桌面端由 SceneRenderer 处理）
      if (window.matchMedia("(min-width: 768px)").matches) return;
      if (tools.some((t) => t.id === payload.id)) setActiveId(payload.id);
    };
    return bus.on("tool:open", handler);
  }, [bus, tools]);
```

（SceneToolbar 已有 `useCallback, useState` from react — 加 `useEffect`。SceneRenderer 已有 `Suspense, useState` — 加 `useEffect`。）

- [ ] **Step 5: 验证检查点**

Run: `cd frontend; npx tsc --noEmit; npx biome check src/components/training/`
Expected: 干净

---

### Task 7: 移动端训练页体验

**Files:**
- Modify: `frontend/src/components/training/scenes/HistoryTakingScene.tsx`
- Modify: `frontend/src/components/training/scenes/TriageScene.tsx`
- Modify: `frontend/src/engine/TrainingEngine.tsx:297,310`
- Modify: `frontend/src/components/training/SceneToolbar.tsx:47`
- Modify: `frontend/src/components/training/WelcomeScreen.tsx`
- Modify: `frontend/src/components/training/ChatArea.tsx`（传 capabilities 给 WelcomeScreen）

- [ ] **Step 1: h-screen → h-dvh（视口裁切修复）**

- `HistoryTakingScene.tsx` 与 `TriageScene.tsx`：`flex flex-col h-screen overflow-hidden` → `flex flex-col h-dvh overflow-hidden`
- `TrainingEngine.tsx` 第 297 行 `flex flex-col h-screen` → `flex flex-col h-dvh`；第 310 行 `flex h-screen items-center` → `flex h-dvh items-center`

- [ ] **Step 2: SceneToolbar 图标始终带文字标签**

`SceneToolbar.tsx` 第 47 行：
```tsx
							<span className="hidden sm:inline">{TOOL_META[tool.id]?.title ?? tool.id}</span>
```
改为：
```tsx
							<span>{TOOL_META[tool.id]?.title ?? tool.id}</span>
```

- [ ] **Step 3: WelcomeScreen 流程引导**

`WelcomeScreen.tsx`：

a) props 加 capabilities：
```tsx
interface WelcomeScreenProps {
	patient: PatientData;
	onQuickPrompt?: (text: string) => void;
	capabilities?: Record<string, boolean>;
}
```
函数签名加 `capabilities = {}`。

b) 在 `const prompts = useMemo(...)` 后加步骤定义：
```tsx
	const steps = useMemo(
		() =>
			[
				{ icon: "🗣️", label: "问诊采集", desc: "询问主诉、现病史、既往史" },
				capabilities.physical_exam ? { icon: "💓", label: "护理查体", desc: "测量生命体征" } : null,
				capabilities.nursing_record ? { icon: "📄", label: "护理记录", desc: "填写护理评估记录" } : null,
				{ icon: "✅", label: "结束训练", desc: "系统自动评分并反馈" },
			].filter((s): s is { icon: string; label: string; desc: string } => s !== null),
		[capabilities],
	);
```

c) 在「快捷问句」区块（`<div className="pt-3 border-t border-border">`）之前插入流程区块：
```tsx
				<div className="pt-3 border-t border-border">
					<div className="text-xs font-medium text-muted-foreground mb-2">训练流程</div>
					<ol className="space-y-1.5">
						{steps.map((s, i) => (
							<li key={s.label} className="flex items-center gap-2.5 text-xs">
								<span className="flex items-center justify-center size-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0">
									{i + 1}
								</span>
								<span className="shrink-0">{s.icon} {s.label}</span>
								<span className="text-muted-foreground truncate">{s.desc}</span>
							</li>
						))}
					</ol>
					<p className="mt-2 text-[11px] text-muted-foreground/70">
						对话过程中可随时通过工具栏打开问诊指引、查体与记录工具。
					</p>
				</div>
```

d) `ChatArea.tsx` 中 WelcomeScreen 调用加 prop：
```tsx
						<WelcomeScreen
							patient={patient}
							onQuickPrompt={onSend}
							capabilities={capabilities}
						/>
```

- [ ] **Step 4: 验证检查点**

Run: `cd frontend; npx tsc --noEmit; npx biome check src/components/training/ src/engine/`
Expected: 干净

---

### Task 8: 全量验证

- [ ] **Step 1: 后端**

Run: `cd backend; uv run pytest tests/scoring/ tests/training/ -x -q; uv run ruff check; uv run ty check`
Expected: 全 PASS，lint/type 干净

- [ ] **Step 2: 前端**

Run: `cd frontend; npx vitest run; npx tsc --noEmit; npx biome check src/`
Expected: 全 PASS，lint/type 干净

- [ ] **Step 3: 冒烟路径（人工/可选）**

1. 开启 nursing_record 的病例开始训练 → WelcomeScreen 显示 4 步流程（含查体/记录）
2. 发送一条含「胸闷」的消息 → 情绪栏 chip 显示 1/N → 点击 chip 打开问诊指引（进度条 + 已覆盖项划线）
3. 打开护理记录 → 正常加载；断网/未启用场景 → 错误态 + 重试
4. 手机宽度（<768px）→ 工具栏图标带文字、底部输入不被裁切
5. 结束训练 → 评分含「护理记录」维度（15 分），总分按 72 满分折算

---

## Self-Review

- **Spec 覆盖**: 任务 1（评分恢复 2 处 + 测试翻转 2 处 + 前端错误/超时）→ Task 1/2/3 ✓；任务 2（共享 bigram + chip + trailing + tool:open + InquiryTool 进度条）→ Task 4/5/6 ✓；任务 3（h-dvh、工具栏标签、流程引导）→ Task 7 ✓；验证 → Task 8 ✓
- **类型一致**: `computeCovered(inquiries, studentText)` 签名在 chip 与 InquiryTool 中一致；`tool:open` payload `{ id: string }` 在 emit 与两处 handler 一致；`_load_nursing_record_text(db, record)` 与 `_build_history_messages(..., nursing_record_text=)` 与测试调用一致
- **无占位符**: 所有代码块完整
- **仓库合规**: 无 commit 步骤；`.gen.ts` 未触碰（capabilities 未变更，无需 `api:update`）
