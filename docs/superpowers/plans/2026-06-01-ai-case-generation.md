# AI-Assisted Case Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow teachers to generate nursing case data via AI from descriptions or reference materials, with per-field AI assist, integrated into the existing case editor.

**Architecture:** New `POST /api/cases/generate` endpoint in cases router uses `call_llm_json()` with `purpose="case_generation"` through the unified LLM pipeline. Prompt is managed via PromptManager with a hardcoded v1 default. Frontend adds a collapsible AI panel in the existing CasesTab editor modal plus per-field sparkle buttons.

**Tech Stack:** FastAPI + SQLAlchemy (backend), React + Vite (frontend), `call_llm_json` for structured LLM output

---

### Task 1: Backend Schemas (Request/Response)

**Files:**
- Modify: `backend/schemas.py` (append new schemas)
- Create: (none)

- [ ] **Step 1: Add CaseGenerateRequest and CaseGenerateResponse schemas**

Append to `backend/schemas.py`:

```python
# ── AI 病例生成 ──

class CaseGenerateRequest(BaseModel):
    mode: str = Field(default="quick", pattern="^(quick|reference)$")
    description: str = Field(..., min_length=1, max_length=4096)
    reference_case_ids: Optional[list[int]] = None
    reference_text: Optional[str] = Field(None, max_length=16384)
    field: Optional[str] = Field(None, pattern="^(scoring_criteria|hidden_info|required_inquiries)$")
    current_case_data: Optional[dict] = None


class CaseGenerateResponse(BaseModel):
    case_data: Optional[dict] = None
    field_value: Optional[dict] = None
    field: Optional[str] = None
```

- [ ] **Step 2: Commit**

```bash
git add backend/schemas.py
git commit -m "feat(schema): add CaseGenerateRequest/Response for AI case generation"
```

---

### Task 2: Hardcoded v1 Prompt + PromptManager Integration

**Files:**
- Modify: `backend/services/prompt_manager.py` (add hardcoded prompt, defaults tuple, fallback branch)

- [ ] **Step 1: Add hardcoded v1 case_generation system prompt constant**

Insert before `def _hardcoded_fallback(purpose: str)` (after `_HARDCODED_SCORING_USER`):

```python
_HARDCODED_CASE_GENERATION = """你是一名资深的护理学教育专家和临床病例编写专家。你的任务是根据用户提供的描述，生成一份完整的护理病史采集训练病例。

## 输出格式要求
必须输出**严格的 JSON**（不含 markdown 代码块标记），结构如下：

```json
{
  "name": "病例名称（20字以内，基于主诉概括）",
  "difficulty": 1,
  "time_limit": 20,
  "description": "训练目标描述（一句话）",
  "patient_info": {"name": "患者姓名（中文名）", "age": 0, "gender": "男/女"},
  "chief_complaint": "主诉（含部位、性质、持续时间、诱因）",
  "opening_line": "开场白（患者对护士说的第一句话，口语化）",
  "present_illness": "现病史（起病情况、发展经过、诊疗经过）",
  "past_history": "既往史",
  "medication_history": "用药史",
  "allergy_history": "过敏史",
  "family_history": "家族史",
  "social_history": "社会史/生活习惯",
  "communication_style": "沟通风格描述（友善自然/紧张焦虑/含糊其辞+细节）",
  "hidden_info": ["隐藏信息列表（患者不会主动透露但学生应该通过问诊发现的线索）"],
  "hidden_info_rules": [
    {"topic": "话题名", "content": "患者可以透露的具体信息", "trigger_keywords": ["关键词1", "关键词2"]}
  ],
  "required_inquiries": ["必须采集到的关键内容"],
  "scoring_criteria": {
    "沟通技能": {
      "max": 42,
      "description": "评估学生的沟通能力",
      "items": [
        {"id": "comm_1", "name": "主动问候与自我介绍", "anchors": {"1": "未问候", "2": "部分问候", "3": "完整问候与自我介绍"}},
        {"id": "comm_2", "name": "使用通俗易懂的语言", "anchors": {"1": "使用大量专业术语", "2": "部分通俗", "3": "语言通俗易懂"}},
        {"id": "comm_3", "name": "表达关怀与尊重", "anchors": {"1": "缺乏关怀", "2": "偶尔表达", "3": "全程表达关怀"}}
      ]
    },
    "病史采集": {
      "max": 15,
      "description": "评估病史采集的系统性和完整性",
      "items": [
        {"id": "hist_1", "name": "主诉信息采集完整性", "anchors": {"1": "仅问名称", "2": "问部分细节", "3": "完整采集部位/性质/时间/诱因"}},
        {"id": "hist_2", "name": "现病史采集", "anchors": {"1": "未问", "2": "部分采集", "3": "系统采集起病、经过、诊疗"}},
        {"id": "hist_3", "name": "既往史采集", "anchors": {"1": "未问", "2": "简单提及", "3": "系统询问"}},
        {"id": "hist_4", "name": "过敏史采集", "anchors": {"1": "未问", "2": "简单提及", "3": "具体询问过敏史"}},
        {"id": "hist_5", "name": "用药史采集", "anchors": {"1": "未问", "2": "简单提及", "3": "详细询问"}}
      ]
    }
  }
}
```

## 用户描述
{#description#}

## 参考资料
{#reference_material#}

## 临床生成指南
1. **真实可信**：症状描述、时间线、流行病学特征（年龄、性别高发）需符合临床实际
2. **教育价值**：隐藏信息和必须采集清单应有挑战性但不过于冷门，适合护理学生训练
3. **评分标准**：根据病例的临床特点微调 scoring_criteria 的 items，确保与 required_inquiries 对应
4. **语言口语化**：opening_line 和 communication_style 要有真实患者的口吻
5. **患者信息多样化**：姓名随机生成，年龄与疾病特征匹配

## 字段生成指南
- 如果用户指定了 field 为非 null，只生成并返回对应字段的值（如 {"field_value": [...]}）
- 如果 field 为 null，生成完整病例

直接输出 JSON，不要任何解释、前言或后记。"""
```

- [ ] **Step 2: Add case_generation to _upsert_v1_defaults**

In `_upsert_v1_defaults`, add the tuple after scoring:

```python
            ("case_generation", "v1-默认病例生成", _HARDCODED_CASE_GENERATION, None),
```

So the full defaults list becomes:

```python
        defaults = [
            ("qa", "v1-默认QA", _HARDCODED_QA, None),
            ("patient_chat", "v1-默认患者对话", _HARDCODED_PATIENT_CHAT, None),
            ("scoring", "v1-默认评分", _HARDCODED_SCORING_SYSTEM, _HARDCODED_SCORING_USER),
            ("case_generation", "v1-默认病例生成", _HARDCODED_CASE_GENERATION, None),
        ]
```

- [ ] **Step 3: Add case_generation branch to _hardcoded_fallback**

In `_hardcoded_fallback`, add before the `else: raise ValueError`:

```python
    elif purpose == "case_generation":
        return PromptTemplateObj(0, "case_generation", 0, _HARDCODED_CASE_GENERATION, None)
```

- [ ] **Step 4: Commit**

```bash
git add backend/services/prompt_manager.py
git commit -m "feat(prompt): add case_generation v1 default prompt and fallback"
```

---

### Task 3: Sample Variables for Preview

**Files:**
- Modify: `backend/prompt_static.py` (add case_generation entry)

- [ ] **Step 1: Add case_generation sample vars**

In `get_sample_vars()`, add after the `qa` entry:

```python
            "case_generation": {
                "description": "糖尿病足溃疡老年患者，有10年糖尿病史，近期足部出现溃疡不愈合",
                "reference_material": "患者长期血糖控制不佳，HbA1c 9.2%。参考标准糖尿病足护理评估流程。",
            },
```

- [ ] **Step 2: Commit**

```bash
git add backend/prompt_static.py
git commit -m "feat(prompt): add case_generation sample vars for preview"
```

---

### Task 4: Case Generation API Endpoint

**Files:**
- Modify: `backend/routers/cases.py` (add generate endpoint)

- [ ] **Step 1: Add imports at top of cases.py**

Find existing imports and add:

```python
import logging
from services.llm_service import call_llm_json
from services.prompt_manager import get_prompt_manager
from schemas import CaseGenerateRequest, CaseGenerateResponse
```

Ensure `CaseGenerateRequest` and `CaseGenerateResponse` are imported alongside existing schema imports.

- [ ] **Step 2: Add POST /api/cases/generate endpoint**

Before the final line of the file, add:

```python
_logger = logging.getLogger("nursing")


@router.post("/generate", response_model=CaseGenerateResponse)
async def generate_case(
    data: CaseGenerateRequest,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    if not data.description.strip():
        raise HTTPException(400, "描述不能为空")

    reference_material = ""
    if data.mode == "reference":
        parts = []
        if data.reference_case_ids:
            ref_cases = db.query(Case).filter(Case.id.in_(data.reference_case_ids)).all()
            found_ids = {c.id for c in ref_cases}
            missing = [cid for cid in data.reference_case_ids if cid not in found_ids]
            if missing:
                raise HTTPException(404, f"参考病例不存在: {missing}")
            for c in ref_cases:
                parts.append(f"--- 参考病例: {c.name} ---\n{_format_case_for_prompt(c.case_data)}")
        if data.reference_text:
            parts.append(f"--- 补充参考资料 ---\n{data.reference_text}")
        reference_material = "\n\n".join(parts)

    pm = await get_prompt_manager()
    tmpl = await pm.get("case_generation")
    system_content = tmpl.render(
        description=data.description,
        reference_material=reference_material or "无",
    )

    if data.field:
        system_content += f"\n\n当前任务：只生成字段「{data.field}」。"
        if data.current_case_data:
            system_content += f"\n\n当前病例上下文：\n{_format_case_for_prompt(data.current_case_data)}"

    messages = [{"role": "system", "content": system_content}]

    try:
        result = await call_llm_json(
            messages, temperature=0.3, max_tokens=4096, timeout=120, max_retries=3,
            purpose="case_generation", user_id=current_user.id,
        )
    except Exception as e:
        _logger.exception("case_generation LLM call failed")
        raise HTTPException(500, f"AI 生成失败: {str(e)}")

    if data.field:
        field_value = result.get("field_value") or result.get(data.field)
        return CaseGenerateResponse(field_value=field_value, field=data.field)

    return CaseGenerateResponse(case_data=result)


def _format_case_for_prompt(case_data: dict) -> str:
    """将 case_data 格式化为 prompt 友好的文本。"""
    info = case_data.get("patient_info", {})
    lines = [
        f"名称: {case_data.get('name', '')}",
        f"患者: {info.get('name', '')}, {info.get('age', '')}岁, {info.get('gender', '')}",
        f"主诉: {case_data.get('chief_complaint', '')}",
        f"开场白: {case_data.get('opening_line', '')}",
        f"现病史: {case_data.get('present_illness', '')}",
        f"既往史: {case_data.get('past_history', '')}",
        f"用药史: {case_data.get('medication_history', '')}",
        f"过敏史: {case_data.get('allergy_history', '')}",
        f"家族史: {case_data.get('family_history', '')}",
        f"社会史: {case_data.get('social_history', '')}",
        f"沟通风格: {case_data.get('communication_style', '')}",
    ]
    hidden_info = case_data.get("hidden_info", [])
    if hidden_info:
        lines.append(f"隐藏信息: {'; '.join(hidden_info)}")
    required = case_data.get("required_inquiries", [])
    if required:
        lines.append(f"必须采集: {'; '.join(required)}")
    return "\n".join(lines)
```

- [ ] **Step 3: Verify route ordering**

The `POST /api/cases/generate` route must be registered BEFORE `GET /api/cases/{case_id}` in the router to avoid path capture. Check the current router declaration order. If `/generate` is after `/{case_id}`, move it before.

- [ ] **Step 4: Commit**

```bash
git add backend/routers/cases.py
git commit -m "feat(api): add POST /api/cases/generate endpoint for AI case generation"
```

---

### Task 5: Backend Tests

**Files:**
- Modify: `backend/tests/test_cases.py` (add TestGenerateCase class)

- [ ] **Step 1: Add test class for case generation**

Append to `backend/tests/test_cases.py`:

```python
from unittest.mock import AsyncMock, patch


class TestGenerateCase:
    def test_generate_requires_teacher(self, client, student):
        _, token = student
        resp = client.post(
            "/api/cases/generate",
            json={"mode": "quick", "description": "高血压患者"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403

    def test_generate_requires_description(self, client, teacher):
        _, token = teacher
        resp = client.post(
            "/api/cases/generate",
            json={"mode": "quick", "description": ""},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 422

    def test_generate_reference_cases_not_found(self, client, teacher):
        _, token = teacher
        resp = client.post(
            "/api/cases/generate",
            json={"mode": "reference", "description": "测试", "reference_case_ids": [999]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404

    @patch("routers.cases.call_llm_json", new_callable=AsyncMock)
    @patch("routers.cases.get_prompt_manager")
    def test_generate_quick_mode_success(self, mock_pm_get, mock_call_llm, client, teacher):
        mock_tmpl = AsyncMock()
        mock_tmpl.render.return_value = "system prompt content"
        mock_pm = AsyncMock()
        mock_pm.get.return_value = mock_tmpl
        mock_pm_get.return_value = mock_pm

        mock_call_llm.return_value = {
            "name": "测试生成病例",
            "difficulty": 1,
            "time_limit": 20,
            "patient_info": {"name": "张先生", "age": 55, "gender": "男"},
            "chief_complaint": "头晕3天",
            "opening_line": "护士，我最近总头晕",
            "present_illness": "3天前无明显诱因头晕",
            "past_history": "高血压5年",
            "medication_history": "硝苯地平 30mg qd",
            "allergy_history": "无",
            "family_history": "父亲高血压",
            "social_history": "吸烟20年",
            "communication_style": "友善自然，略带焦虑",
            "hidden_info": ["未规律服药"],
            "hidden_info_rules": [],
            "required_inquiries": ["血压值"],
            "scoring_criteria": {},
        }

        _, token = teacher
        resp = client.post(
            "/api/cases/generate",
            json={"mode": "quick", "description": "高血压患者"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["case_data"]["name"] == "测试生成病例"
        assert data["case_data"]["patient_info"]["name"] == "张先生"
        assert data["field"] is None

    @patch("routers.cases.call_llm_json", new_callable=AsyncMock)
    @patch("routers.cases.get_prompt_manager")
    def test_generate_field_mode(self, mock_pm_get, mock_call_llm, client, teacher):
        mock_tmpl = AsyncMock()
        mock_tmpl.render.return_value = "system prompt content"
        mock_pm = AsyncMock()
        mock_pm.get.return_value = mock_tmpl
        mock_pm_get.return_value = mock_pm

        mock_call_llm.return_value = {
            "field_value": ["吸烟史", "饮酒史", "运动习惯"],
        }

        _, token = teacher
        resp = client.post(
            "/api/cases/generate",
            json={
                "mode": "quick",
                "description": "高血压患者",
                "field": "required_inquiries",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["field"] == "required_inquiries"
        assert len(data["field_value"]) == 3
```

- [ ] **Step 2: Run tests to verify they pass with mocks**

```bash
cd backend && uv run pytest tests/test_cases.py::TestGenerateCase -v
```

Expected: all 5 tests PASS

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_cases.py
git commit -m "test(cases): add AI case generation endpoint tests"
```

---

### Task 6: Frontend API Function

**Files:**
- Modify: `frontend/src/api.js` (add generateCase function)

- [ ] **Step 1: Add generateCase function**

Append before the last line of `frontend/src/api.js`:

```javascript
export function generateCase(data) {
  return api.post("/cases/generate", data);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api.js
git commit -m "feat(frontend): add generateCase API function"
```

---

### Task 7: PromptManagementTab — Add case_generation Purpose

**Files:**
- Modify: `frontend/src/components/teacher/PromptManagementTab.jsx` (add to PURPOSES and PURPOSE_LABELS)

- [ ] **Step 1: Add case_generation to PURPOSES and PURPOSE_LABELS**

Change line 18:
```javascript
const PURPOSES = ["patient_chat", "scoring", "qa"];
```
to:
```javascript
const PURPOSES = ["patient_chat", "scoring", "qa", "case_generation"];
```

Change line 19:
```javascript
const PURPOSE_LABELS = { patient_chat: "患者对话", scoring: "评分", qa: "问答" };
```
to:
```javascript
const PURPOSE_LABELS = { patient_chat: "患者对话", scoring: "评分", qa: "问答", case_generation: "病例生成" };
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/teacher/PromptManagementTab.jsx
git commit -m "feat(frontend): add case_generation to prompt management purposes"
```

---

### Task 8: MonitorTab — Add case_generation Label

**Files:**
- Modify: `frontend/src/components/teacher/MonitorTab.jsx` (add to PURPOSE_LABELS)

- [ ] **Step 1: Add case_generation to PURPOSE_LABELS**

Change line 6:
```javascript
const PURPOSE_LABELS = { patient_chat: "患者对话", scoring: "评分", qa: "问答", summary: "总结", other: "其他" };
```
to:
```javascript
const PURPOSE_LABELS = { patient_chat: "患者对话", scoring: "评分", qa: "问答", case_generation: "病例生成", summary: "总结", other: "其他" };
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/teacher/MonitorTab.jsx
git commit -m "feat(frontend): add case_generation label to monitor tab"
```

---

### Task 9: CasesTab — AI Panel + Per-Field AI Buttons

**Files:**
- Modify: `frontend/src/components/teacher/CasesTab.jsx` (add AI panel, per-field buttons, new state)

- [ ] **Step 1: Add imports**

Replace the import line for lucide icons:
```javascript
import { ChevronDown, ChevronUp, ClipboardList, Edit3, Plus, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
```
Add the AI api import:
```javascript
import { generateCase } from "../../api";
```
(also ensure it's imported from `../../api` alongside the existing case imports)

The existing import is:
```javascript
import { createCase, deleteCase, getCaseDetail, getManageCases, updateCase } from "../../api";
```
Change to:
```javascript
import { createCase, deleteCase, generateCase, getCaseDetail, getManageCases, updateCase } from "../../api";
```

- [ ] **Step 2: Add new state variables**

In the `CasesTab` component, add these states after `const [showAdvanced, setShowAdvanced] = useState(false);`:

```javascript
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiMode, setAiMode] = useState("quick");
  const [aiDescription, setAiDescription] = useState("");
  const [aiReferenceCaseIds, setAiReferenceCaseIds] = useState([]);
  const [aiReferenceText, setAiReferenceText] = useState("");
  const [aiError, setAiError] = useState("");
```

- [ ] **Step 3: Add AI generation handler**

After the `handleJsonImport` function:

```javascript
  const handleAiGenerate = async (field) => {
    setAiError("");
    if (!field && !aiDescription.trim()) {
      setAiError("请输入病例描述");
      return;
    }
    setAiGenerating(true);
    try {
      const payload = {
        mode: aiMode,
        description: aiDescription || caseForm.chief_complaint || caseForm.description || "护理病史采集训练病例",
        reference_case_ids: aiMode === "reference" ? aiReferenceCaseIds : undefined,
        reference_text: aiMode === "reference" && aiReferenceText ? aiReferenceText : undefined,
        field: field || null,
      };
      if (field) {
        payload.current_case_data = buildCaseData(caseForm);
      }
      const { data } = await generateCase(payload);
      if (field) {
        updateField(field, data.field_value);
        toast.success(`已生成 ${field} 建议`);
      } else {
        setCaseForm(parseCaseData(data.case_data));
        toast.success("病例生成成功，请检查并保存");
      }
    } catch (err) {
      const detail = err.response?.data?.detail || "AI 生成失败";
      setAiError(field ? `生成「${field}」失败: ${detail}` : detail);
    } finally {
      setAiGenerating(false);
    }
  };
```

- [ ] **Step 4: Add "AI 生成病例" button alongside "添加病例"**

In the action bar, add the AI button after the "添加病例" button:

```jsx
        <button className="btn btn-primary" onClick={openNew}>
          <Plus size={16} /> 添加病例
        </button>
        <button
          className="btn"
          onClick={() => {
            openNew();
            setShowAiPanel(true);
            setAiMode("quick");
            setAiDescription("");
            setAiReferenceCaseIds([]);
            setAiReferenceText("");
            setAiError("");
          }}
          style={{ background: "var(--purple-50)", border: "1px solid var(--purple-300)", color: "var(--purple-700)", display: "flex", alignItems: "center", gap: 6 }}
        >
          <Wand2 size={16} /> AI 生成病例
        </button>
```

- [ ] **Step 5: Add AI panel inside the editor modal**

After the `{caseMsg && ...}` line and before `<form onSubmit={handleSave}>`, add the AI panel:

```jsx
        <div style={{ marginBottom: "var(--space-4)" }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setShowAiPanel(!showAiPanel);
              setAiError("");
            }}
            style={{ display: "flex", alignItems: "center", gap: 4, background: showAiPanel ? "var(--purple-50)" : "transparent", border: "1px solid var(--purple-300)", color: "var(--purple-700)" }}
          >
            <Wand2 size={14} /> {showAiPanel ? "收起 AI 面板" : "展开 AI 面板"}
          </button>
          {showAiPanel && (
            <div className="card" style={{ marginTop: "var(--space-3)", padding: "var(--space-4)", background: "var(--purple-25)", border: "1px solid var(--purple-100)" }}>
              <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
                <button
                  type="button"
                  className={`btn btn-sm ${aiMode === "quick" ? "btn-primary" : ""}`}
                  onClick={() => setAiMode("quick")}
                >
                  快速生成
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${aiMode === "reference" ? "btn-primary" : ""}`}
                  onClick={() => setAiMode("reference")}
                >
                  参考资料生成
                </button>
              </div>
              <div className="form-group">
                <label>病例描述 *</label>
                <textarea
                  rows={2}
                  value={aiDescription}
                  onChange={(e) => setAiDescription(e.target.value)}
                  placeholder="一句话描述，如：糖尿病足溃疡老年患者，有10年糖尿病史..."
                />
              </div>
              {aiMode === "reference" && (
                <>
                  <div className="form-group">
                    <label>参考现有病例（多选）</label>
                    <select
                      multiple
                      value={aiReferenceCaseIds.map(String)}
                      onChange={(e) => setAiReferenceCaseIds(Array.from(e.target.selectedOptions, (o) => Number(o.value)))}
                      style={{ minHeight: 100 }}
                    >
                      {cases.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}{c.chief_complaint ? ` — ${c.chief_complaint}` : ""}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>自由参考资料</label>
                    <textarea
                      rows={3}
                      value={aiReferenceText}
                      onChange={(e) => setAiReferenceText(e.target.value)}
                      placeholder="粘贴临床笔记、文献摘要等参考内容..."
                    />
                  </div>
                </>
              )}
              {aiError && <div className="error-msg" style={{ marginBottom: "var(--space-2)" }}>{aiError}</div>}
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleAiGenerate(null)}
                disabled={aiGenerating}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                {aiGenerating ? (
                  <>⟳ 生成中...</>
                ) : (
                  <><Sparkles size={14} /> 生成完整病例</>
                )}
              </button>
            </div>
          )}
        </div>
```

- [ ] **Step 6: Add per-field AI buttons**

In the advanced fields section (inside `{showAdvanced && (<>`), add sparkle buttons next to the three complex field labels.

For `hidden_info` label area, wrap the label and add a sparkle button:

```jsx
                <div className="form-group">
                  <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    隐藏信息（一行一条）
                    <button
                      type="button"
                      disabled={aiGenerating}
                      onClick={() => {
                        if (!showAiPanel) setShowAiPanel(true);
                        handleAiGenerate("hidden_info");
                      }}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--purple-500)", display: "flex", alignItems: "center" }}
                      title="AI 建议"
                    >
                      <Sparkles size={13} />
                    </button>
                  </label>
                  <textarea rows={4} value={(caseForm.hidden_info || []).join("\n")} onChange={(e) => updateList("hidden_info", e.target.value)} />
                </div>
```

For `required_inquiries`:

```jsx
                <div className="form-group">
                  <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    必须问到的内容（一行一条）
                    <button
                      type="button"
                      disabled={aiGenerating}
                      onClick={() => {
                        if (!showAiPanel) setShowAiPanel(true);
                        handleAiGenerate("required_inquiries");
                      }}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--purple-500)", display: "flex", alignItems: "center" }}
                      title="AI 建议"
                    >
                      <Sparkles size={13} />
                    </button>
                  </label>
                  <textarea rows={4} value={(caseForm.required_inquiries || []).join("\n")} onChange={(e) => updateList("required_inquiries", e.target.value)} />
                </div>
```

For `scoring_criteria`:

```jsx
                <div className="form-group">
                  <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    评分标准 (JSON)
                    <button
                      type="button"
                      disabled={aiGenerating}
                      onClick={() => {
                        if (!showAiPanel) setShowAiPanel(true);
                        handleAiGenerate("scoring_criteria");
                      }}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--purple-500)", display: "flex", alignItems: "center" }}
                      title="AI 建议"
                    >
                      <Sparkles size={13} />
                    </button>
                  </label>
                  <textarea rows={6} style={{ fontFamily: "monospace", fontSize: "0.8rem" }} value={JSON.stringify(caseForm.scoring_criteria, null, 2)} onChange={(e) => { try { updateField("scoring_criteria", JSON.parse(e.target.value)); } catch { /* editing in progress */ } }} />
                </div>
```

- [ ] **Step 7: Modify openNew and openEdit to reset AI state**

In `openNew`, add after `setShowAdvanced(false);`:
```javascript
    setShowAiPanel(false);
    setAiDescription("");
    setAiReferenceCaseIds([]);
    setAiReferenceText("");
    setAiError("");
```

In `openEdit`, add after `setShowAdvanced(false);`:
```javascript
    setShowAiPanel(false);
    setAiDescription("");
    setAiReferenceCaseIds([]);
    setAiReferenceText("");
    setAiError("");
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/teacher/CasesTab.jsx
git commit -m "feat(frontend): add AI case generation panel and per-field AI buttons to CasesTab"
```

---

### Task 10: Final Verification

- [ ] **Step 1: Run backend tests**

```bash
cd backend && uv run pytest tests/test_cases.py -v
```

Expected: all tests pass (including new TestGenerateCase tests)

- [ ] **Step 2: Verify frontend builds**

```bash
cd frontend && npm run build
```

Expected: build succeeds with no errors

- [ ] **Step 3: Final commit (if any format/lint fixes needed)**

```bash
git add -A
git commit -m "chore: final verification fixes"
```

