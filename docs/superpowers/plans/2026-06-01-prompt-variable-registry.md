# Prompt Variable Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a centralized VariableRegistry that declares all prompt variables per purpose, validates templates on create/update, and provides rich metadata to the admin UI.

**Architecture:** New `variable_registry.py` module as single source of truth for all variables. Admin API validates against it, PromptManager syncs V1 metadata from it, call sites reference it for defaults, frontend displays its metadata. No DB schema changes.

**Tech Stack:** Python 3.13, FastAPI, React, existing `PromptTemplate` model, existing `{#var#}` syntax.

---

**File Map:**

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/services/variable_registry.py` | **Create** | VariableDef dataclass + VariableRegistry class + per-purpose variable definitions |
| `backend/tests/test_variable_registry.py` | **Create** | Unit tests for registry lookup, validation, sample kwargs |
| `backend/services/prompt_manager.py` | Modify | V1 upsert uses registry JSONB; render() error messages include expected vs actual |
| `backend/routers/admin_prompts.py` | Modify | create/update validates vars against registry; sample-vars endpoint uses registry |
| `backend/prompt_static.py` | Modify | Remove `get_sample_vars()` and `_SAMPLE_VARS` |
| `backend/routers/chat.py` | Modify | Use registry defaults for optional value fallbacks |
| `backend/services/scoring.py` | Modify | Use registry defaults |
| `backend/routers/cases.py` | Modify | Use registry defaults |
| `backend/tests/test_scoring_integration.py` | Modify | Update `get_sample_vars` import to registry |
| `backend/tests/test_variable_registry.py` | **Create** | Unit tests |
| `frontend/src/components/teacher/PromptManagementTab.jsx` | Modify | Variable card UI with desc/source/type/example; inline desc editing |

---

### Task 1: Create VariableRegistry module

**Files:**
- Create: `backend/services/variable_registry.py`

- [ ] **Step 1: Write the module**

```python
"""集中管理所有 prompt purpose 的合法变量定义"""
from dataclasses import dataclass


@dataclass
class VariableDef:
    name: str
    type: str = "string"
    description: str = ""
    source: str = ""
    required: bool = True
    default_example: str = ""


_REGISTRY: dict[str, list[VariableDef]] = {
    "patient_chat": [
        VariableDef(
            name="communication_style",
            type="string",
            description="患者的沟通风格描述，如'友善自然，略带焦虑'",
            source="病例数据 > communication_style",
            default_example="友善自然，略带焦虑",
        ),
        VariableDef(
            name="patient_info",
            type="string",
            description="患者基本信息，格式为'姓名，年龄岁，性别'",
            source="病例数据 > patient_info 拼接",
            default_example="张三，45岁，男",
        ),
        VariableDef(
            name="chief_complaint",
            type="string",
            description="主诉（含部位、性质、持续时间、诱因）",
            source="病例数据 > chief_complaint",
            default_example="咳嗽咳痰3天",
        ),
        VariableDef(
            name="present_illness",
            type="string",
            description="现病史（起病情况、发展经过、诊疗经过）",
            source="病例数据 > present_illness",
            default_example="患者3天前受凉后出现咳嗽，伴少量白痰",
        ),
        VariableDef(
            name="allergy_history",
            type="string",
            description="过敏史",
            source="病例数据 > allergy_history",
            default_example="无",
        ),
        VariableDef(
            name="hidden_info_rules",
            type="text",
            description="本轮可透露的隐藏信息，根据学生消息动态计算",
            source="运行时根据学生触发关键词动态生成",
            default_example="- 关于咯血：最近一周痰中带血丝，量不多",
        ),
    ],
    "scoring": [
        VariableDef(
            name="scoring_rubric",
            type="text",
            description="评分标准（维度、条目、锚点、必需询问项、JSON输出模板）",
            source="prompt_static.build_scoring_rubric() 自动生成",
            default_example="(由 build_scoring_rubric 动态生成)",
        ),
        VariableDef(
            name="conversation_text",
            type="text",
            description="学生与虚拟患者的完整对话记录",
            source="Message 表该训练记录的所有消息拼接",
            default_example="学生：你好，请问你哪里不舒服？\n\n患者：我最近咳嗽得厉害...",
        ),
    ],
    "case_generation": [
        VariableDef(
            name="description",
            type="string",
            description="教师输入的病例生成需求描述",
            source="教师输入 > CaseGenerateRequest.description",
            default_example="生成一个关于高血压患者的病史采集训练病例",
        ),
        VariableDef(
            name="reference_material",
            type="text",
            description="参考病例数据或补充文本",
            source="教师选择的参考病例 + 补充文本",
            default_example="参考病例：患者因高血压入院...",
        ),
    ],
    "qa": [],
}


class VariableRegistry:
    """集中管理所有 purpose 的合法变量定义"""

    def get_variables(self, purpose: str) -> list[VariableDef]:
        """返回某 purpose 的所有变量定义"""
        return _REGISTRY.get(purpose, [])

    def get_variable_names(self, purpose: str) -> set[str]:
        """返回某 purpose 的变量名集合"""
        return {v.name for v in self.get_variables(purpose)}

    def get_variable_map(self, purpose: str) -> dict[str, VariableDef]:
        """返回 {name: VariableDef} 映射"""
        return {v.name: v for v in self.get_variables(purpose)}

    def validate_template_vars(self, purpose: str, template_vars: set[str]) -> list[str]:
        """校验模板中使用的变量是否在注册表中。返回错误列表，空列表表示通过。"""
        known = self.get_variable_names(purpose)
        unknown = template_vars - known
        errors: list[str] = []
        if unknown:
            known_display = ", ".join(sorted(known)) if known else "无"
            errors.append(
                f"未知变量: {', '.join(sorted(unknown))}"
                f"（{purpose} 模板的合法变量: {known_display}）"
            )
        return errors

    def get_sample_kwargs(self, purpose: str) -> dict[str, str]:
        """获取某 purpose 的示例变量值，供预览使用。
        scoring_rubric 特殊处理：调用 build_scoring_rubric 动态生成。"""
        result: dict[str, str] = {}
        for v in self.get_variables(purpose):
            if v.name == "scoring_rubric":
                from prompt_static import build_scoring_rubric
                result[v.name] = build_scoring_rubric({}, [])
            else:
                result[v.name] = v.default_example
        return result

    def get_variables_jsonb(self, purpose: str) -> list[dict]:
        """返回适合存入 PromptTemplate.variables JSONB 的变量元数据列表"""
        return [
            {
                "name": v.name,
                "desc": v.description,
                "source": v.source,
                "type": v.type,
                "example": v.default_example,
            }
            for v in self.get_variables(purpose)
        ]

    def get_defaults(self, purpose: str) -> dict[str, str]:
        """返回某 purpose 所有变量的 default_example 映射"""
        return {v.name: v.default_example for v in self.get_variables(purpose)}


_registry = VariableRegistry()


def get_registry() -> VariableRegistry:
    return _registry
```

- [ ] **Step 2: Verify module imports cleanly**

```bash
& "D:\repo\dev\nursing-vp-sim\backend\.venv\Scripts\python.exe" -c "from services.variable_registry import get_registry; r = get_registry(); assert len(r.get_variables('patient_chat')) == 6; assert len(r.get_variables('qa')) == 0; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/services/variable_registry.py
git commit -m "✨ feat: add VariableRegistry for centralized prompt variable definitions"
```

---

### Task 2: Write registry unit tests

**Files:**
- Create: `backend/tests/test_variable_registry.py`

- [ ] **Step 1: Write tests**

```python
"""Tests for VariableRegistry"""
from services.variable_registry import get_registry, VariableDef


class TestRegistryLookup:
    def test_patient_chat_has_six_variables(self):
        r = get_registry()
        vars_ = r.get_variables("patient_chat")
        assert len(vars_) == 6

    def test_qa_has_no_variables(self):
        r = get_registry()
        assert r.get_variables("qa") == []

    def test_unknown_purpose_returns_empty(self):
        r = get_registry()
        assert r.get_variables("nonexistent") == []

    def test_get_variable_names(self):
        r = get_registry()
        names = r.get_variable_names("patient_chat")
        assert "patient_info" in names
        assert "hidden_info_rules" in names

    def test_get_variable_map(self):
        r = get_registry()
        m = r.get_variable_map("scoring")
        assert "scoring_rubric" in m
        assert isinstance(m["scoring_rubric"], VariableDef)

    def test_get_defaults(self):
        r = get_registry()
        defaults = r.get_defaults("case_generation")
        assert "description" in defaults
        assert "reference_material" in defaults

    def test_get_sample_kwargs_scoring_has_rubric(self):
        r = get_registry()
        kwargs = r.get_sample_kwargs("scoring")
        assert "scoring_rubric" in kwargs
        assert "conversation_text" in kwargs
        assert len(kwargs["scoring_rubric"]) > 100

    def test_get_sample_kwargs_qa_empty(self):
        r = get_registry()
        assert r.get_sample_kwargs("qa") == {}


class TestRegistryValidation:
    def test_known_vars_pass(self):
        r = get_registry()
        errors = r.validate_template_vars("patient_chat", {"patient_info", "chief_complaint"})
        assert errors == []

    def test_unknown_var_fails(self):
        r = get_registry()
        errors = r.validate_template_vars("patient_chat", {"patient_info", "made_up_var"})
        assert len(errors) == 1
        assert "made_up_var" in errors[0]

    def test_all_unknown_vars_fail(self):
        r = get_registry()
        errors = r.validate_template_vars("patient_chat", {"a", "b", "c"})
        assert len(errors) == 1
        assert "a" in errors[0]
        assert "b" in errors[0]
        assert "c" in errors[0]

    def test_empty_set_passes(self):
        r = get_registry()
        errors = r.validate_template_vars("patient_chat", set())
        assert errors == []

    def test_qa_blocks_any_var(self):
        r = get_registry()
        errors = r.validate_template_vars("qa", {"anything"})
        assert len(errors) == 1
        assert "无" in errors[0] or "anything" in errors[0]

    def test_error_message_includes_known_vars(self):
        r = get_registry()
        errors = r.validate_template_vars("scoring", {"bad_var"})
        assert "scoring_rubric" in errors[0]
        assert "conversation_text" in errors[0]


class TestVariablesJsonb:
    def test_jsonb_has_required_fields(self):
        r = get_registry()
        data = r.get_variables_jsonb("patient_chat")
        assert len(data) == 6
        for entry in data:
            assert "name" in entry
            assert "desc" in entry
            assert "source" in entry
            assert "type" in entry
            assert "example" in entry
            assert entry["desc"] != ""

    def test_jsonb_qa_empty(self):
        r = get_registry()
        assert r.get_variables_jsonb("qa") == []
```

- [ ] **Step 2: Run tests**

```bash
& "D:\repo\dev\nursing-vp-sim\backend\.venv\Scripts\python.exe" -m pytest tests/test_variable_registry.py -v
```
Expected: 13 passed

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_variable_registry.py
git commit -m "✅ test: add VariableRegistry unit tests"
```

---

### Task 3: Integrate registry into PromptManager

**Files:**
- Modify: `backend/services/prompt_manager.py:91-130` (`_upsert_v1_defaults`)
- Modify: `backend/services/prompt_manager.py:37-41` (`PromptTemplateObj.render`)

- [ ] **Step 1: Update `_upsert_v1_defaults` variables field**

Replace the variable extraction logic (lines 111-114) with registry lookup.

Find:
```python
                v1.variables = [
                    {"name": v, "desc": ""}
                    for v in sorted(_re.findall(r"\{#([^}#]+)#\}", system_prompt + (user_prompt or "")))
                ]
```
Replace with:
```python
                from services.variable_registry import get_registry
                v1.variables = get_registry().get_variables_jsonb(purpose)
```

Also update the same pattern in the `else` branch (lines 121-124) where a new `PT(...)` is created:

Find:
```python
                db.add(PT(
                    purpose=purpose, version=1, name=name,
                    system_prompt=system_prompt, user_prompt=user_prompt,
                    variables=[
                        {"name": v, "desc": ""}
                        for v in sorted(_re.findall(r"\{#([^}#]+)#\}", system_prompt + (user_prompt or "")))
                    ],
                    is_active=True, created_by="system",
                ))
```
Replace with:
```python
                from services.variable_registry import get_registry
                db.add(PT(
                    purpose=purpose, version=1, name=name,
                    system_prompt=system_prompt, user_prompt=user_prompt,
                    variables=get_registry().get_variables_jsonb(purpose),
                    is_active=True, created_by="system",
                ))
```

The import line `import re as _re` can now be removed since it was only used for variable extraction.

- [ ] **Step 2: Enhance `PromptTemplateObj.render` error message**

Find in `prompt_manager.py`:
```python
class PromptTemplateObj:
    def render(self, **kwargs) -> str:
        try:
            return render_template(self.system_prompt, **kwargs)
        except RuntimeError as e:
            raise RuntimeError(f"{e} (purpose={self.purpose}, v{self.version})")
```
Replace with:
```python
class PromptTemplateObj:
    def render(self, **kwargs) -> str:
        try:
            return render_template(self.system_prompt, **kwargs)
        except RuntimeError as e:
            import re as _re
            expected = sorted(set(_re.findall(r"\{#([^}#]+)#\}", self.system_prompt)))
            provided = sorted(kwargs.keys())
            missing = [v for v in expected if v not in kwargs]
            raise RuntimeError(
                f"{e} (purpose={self.purpose}, v{self.version}, "
                f"期望变量: {expected}, 实际传入: {provided}, 缺失: {missing})"
            )
```

- [ ] **Step 3: Verify with existing tests**

```bash
& "D:\repo\dev\nursing-vp-sim\backend\.venv\Scripts\python.exe" -m pytest tests/test_render_template.py tests/test_scoring_integration.py -v
```
Expected: all pass (render tests + scoring integration tests)

- [ ] **Step 4: Commit**

```bash
git add backend/services/prompt_manager.py
git commit -m "✨ feat: sync V1 prompt variables from VariableRegistry; enhance render error messages"
```

---

### Task 4: Integrate registry into Admin API

**Files:**
- Modify: `backend/routers/admin_prompts.py`

- [ ] **Step 1: Add registry import**

Add at top imports:
```python
from services.variable_registry import get_registry
```

- [ ] **Step 2: Add validation to create endpoint**

In the `create_prompt` function (around L39), after extracting variables, add validation before `db.add`:

Find the section that creates `pt = PromptTemplate(...)` and insert before it:
```python
    template_vars = set(_re.findall(r"\{#([^}#]+)#\}", data.system_prompt + (data.user_prompt or "")))
    errors = get_registry().validate_template_vars(data.purpose, template_vars)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))
```

- [ ] **Step 3: Add validation to update endpoint**

In the `update_prompt` function (around L67), after computing the new template text, add validation:

```python
    system_prompt = data.system_prompt if data.system_prompt is not None else pt.system_prompt
    user_prompt = data.user_prompt if data.user_prompt is not None else pt.user_prompt
    combined = system_prompt + (user_prompt or "")
    template_vars = set(_re.findall(r"\{#([^}#]+)#\}", combined))
    errors = get_registry().validate_template_vars(pt.purpose, template_vars)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))
```

- [ ] **Step 4: Replace sample-vars endpoint**

Replace the `get_sample_vars` function body (around L160-161):

Find:
```python
from prompt_static import get_sample_vars as _get_sample_vars

@router.get("/sample-vars")
def get_sample_vars(purpose: str, current_user: User = Depends(require_teacher)):
    sample = _get_sample_vars().get(purpose)
    if sample is None:
        raise HTTPException(status_code=400, detail=f"未知的 purpose: {purpose}")
    return sample
```

Replace with:
```python
@router.get("/sample-vars")
def get_sample_vars(purpose: str, current_user: User = Depends(require_teacher)):
    registry = get_registry()
    if purpose not in {"patient_chat", "scoring", "qa", "case_generation"}:
        raise HTTPException(status_code=400, detail=f"未知的 purpose: {purpose}")
    return registry.get_sample_kwargs(purpose)
```

Remove the `from prompt_static import get_sample_vars as _get_sample_vars` import line.

- [ ] **Step 5: Update the active/preview endpoint**

The preview endpoint (around L167) calls `get_sample_vars()` internally. Update the import/usage:

Find:
```python
    sample = get_sample_vars().get(purpose, {})
```
Replace with:
```python
    sample = get_registry().get_sample_kwargs(purpose)
```

- [ ] **Step 6: Run admin prompts tests**

```bash
& "D:\repo\dev\nursing-vp-sim\backend\.venv\Scripts\python.exe" -m pytest tests/test_llm_configs_api.py -v
```
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add backend/routers/admin_prompts.py
git commit -m "✨ feat: validate prompt variables against registry on create/update; use registry for sample vars"
```

---

### Task 5: Clean up prompt_static.py

**Files:**
- Modify: `backend/prompt_static.py` (remove `get_sample_vars` and `_SAMPLE_VARS`)
- Modify: `backend/tests/test_scoring_integration.py` (update import for sample vars)

- [ ] **Step 1: Remove `_SAMPLE_VARS` and `get_sample_vars` from prompt_static.py**

Remove lines 90-113 (the `_SAMPLE_VARS` dict and `get_sample_vars` function):

```python
# Delete these lines:
def get_sample_vars() -> dict:
    ...
```

- [ ] **Step 2: Update test that references `get_sample_vars`**

In `backend/tests/test_scoring_integration.py`:

Find:
```python
from prompt_static import build_scoring_rubric, get_sample_vars

# ... in test_sample_vars_are_renderable (around L359):
sample = get_sample_vars().get("scoring", {})
```

Replace with:
```python
from prompt_static import build_scoring_rubric
from services.variable_registry import get_registry

# ... in test_sample_vars_are_renderable:
sample = get_registry().get_sample_kwargs("scoring")
```

- [ ] **Step 3: Run tests**

```bash
& "D:\repo\dev\nursing-vp-sim\backend\.venv\Scripts\python.exe" -m pytest tests/test_scoring_integration.py -v
```
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add backend/prompt_static.py backend/tests/test_scoring_integration.py
git commit -m "♻️ refactor: remove get_sample_vars from prompt_static, delegate to VariableRegistry"
```

---

### Task 6: Integrate registry defaults at call sites

**Files:**
- Modify: `backend/routers/chat.py:41,53-58`
- Modify: `backend/services/scoring.py:39-46`
- Modify: `backend/routers/cases.py:140-143`

- [ ] **Step 1: chat.py — use registry defaults for fallback values**

In `backend/routers/chat.py`, in `_build_llm_context`, add registry import and use defaults:

At top, add:
```python
from services.variable_registry import get_registry
```

In `_build_llm_context`, before the `tmpl.render` call, add:
```python
    defaults = get_registry().get_defaults("patient_chat")
```

Then change the render call to use registry defaults as fallback:

```python
    system_prompt = tmpl.render(
        communication_style=str(case_data.get("communication_style") or defaults.get("communication_style", "")),
        patient_info=patient_info_str or defaults.get("patient_info", ""),
        chief_complaint=str(case_data.get("chief_complaint") or defaults.get("chief_complaint", "")),
        present_illness=str(case_data.get("present_illness") or defaults.get("present_illness", "")),
        allergy_history=str(case_data.get("allergy_history") or defaults.get("allergy_history", "")),
        hidden_info_rules=hidden_info_rules or defaults.get("hidden_info_rules", ""),
    )
```

- [ ] **Step 2: scoring.py — add registry defaults**

In `backend/services/scoring.py`, add import:
```python
from services.variable_registry import get_registry
```

In `evaluate_training`, before the render call, add:
```python
    defaults = get_registry().get_defaults("scoring")
```

Then in the render call, add fallback:
```python
    system_content, user_content = tmpl.render_pair(
        scoring_rubric=scoring_rubric or defaults.get("scoring_rubric", ""),
        conversation_text=conversation_text or defaults.get("conversation_text", ""),
    )
```

- [ ] **Step 3: cases.py — add registry defaults**

In `backend/routers/cases.py`, add import:
```python
from services.variable_registry import get_registry
```

Find the render call and add defaults:
```python
    defaults = get_registry().get_defaults("case_generation")
    system_content = tmpl.render(
        description=data.description or defaults.get("description", ""),
        reference_material=reference_material or defaults.get("reference_material", "无"),
    )
```

- [ ] **Step 4: Run full test suite**

```bash
& "D:\repo\dev\nursing-vp-sim\backend\.venv\Scripts\python.exe" -m pytest tests/ -v -q
```
Expected: all 136+ tests pass

- [ ] **Step 5: Commit**

```bash
git add backend/routers/chat.py backend/services/scoring.py backend/routers/cases.py
git commit -m "✨ feat: use VariableRegistry defaults at prompt call sites for centralized fallback values"
```

---

### Task 7: Frontend variable card UI enhancements

**Files:**
- Modify: `frontend/src/components/teacher/PromptManagementTab.jsx`

- [ ] **Step 1: Replace flat variable tags with expandable variable cards**

Replace the current variable display section (lines 543-584) with a card-based layout that shows `desc`, `source`, `type`, and `example` from the `variables` JSONB data. Add inline editing for `desc`.

Replace:
```jsx
<div style={{ marginBottom: "var(--space-3)", display: "flex", alignItems: "flex-start", gap: "var(--space-3)", flexWrap: "wrap" }}>
  <div style={{ flex: 1, minWidth: 200 }}>
    <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
      <Hash size={12} /> 模板变量 {currentVars.length > 0 && `(${currentVars.length})`}
    </div>
    {currentVars.length > 0 ? (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {currentVars.map((v) => {
          const desc = dbVars.find((d) => d.name === v);
          return (
            <span key={v} title={desc?.desc || ""}
              style={{ padding: "2px 10px", borderRadius: "var(--radius-full)", fontSize: "0.7rem",
                background: "var(--blue-50)", color: "var(--blue-700)", border: "1px solid var(--blue-200)", fontFamily: "monospace" }}>
              {`{#${v}#}`}
            </span>
          );
        })}
      </div>
    ) : (
      <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>无变量（纯静态 prompt）</span>
    )}
  </div>
</div>
```

With:
```jsx
<div style={{ marginBottom: "var(--space-3)" }}>
  <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
    <Hash size={12} /> 模板变量 {currentVars.length > 0 && `(${currentVars.length})`}
  </div>
  {currentVars.length > 0 ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {currentVars.map((vName) => {
        const meta = dbVars.find((d) => d.name === vName) || {};
        const [editing, setEditing] = useState(false);
        const [descDraft, setDescDraft] = useState(meta.desc || "");
        return (
          <div key={vName} style={{
            border: "1px solid var(--border-secondary)", borderRadius: "var(--radius-md)",
            padding: "var(--space-2) var(--space-3)", background: "var(--bg-secondary)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <code style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--blue-700)" }}>
                {"{#"}{vName}{"#}"}
              </code>
              <span style={{ fontSize: "0.65rem", color: "var(--text-tertiary)", background: "var(--bg-tertiary)", padding: "1px 6px", borderRadius: "var(--radius-full)" }}>
                {meta.type || "string"}
              </span>
            </div>
            {meta.desc || editing ? (
              editing ? (
                <div style={{ marginBottom: 4 }}>
                  <input value={descDraft} onChange={(e) => setDescDraft(e.target.value)}
                    onBlur={() => { setEditing(false); handleUpdateVarDesc(vName, descDraft); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { setEditing(false); handleUpdateVarDesc(vName, descDraft); } }}
                    autoFocus placeholder="变量描述..."
                    style={{ width: "100%", fontSize: "0.72rem", padding: "2px 6px", border: "1px solid var(--blue-300)", borderRadius: 4, outline: "none" }} />
                </div>
              ) : (
                <div onClick={() => setEditing(true)}
                  style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginBottom: 4, cursor: "pointer", padding: "2px 0" }}
                  title="点击编辑描述">
                  {meta.desc || "(无描述，点击编辑)"}
                </div>
              )
            ) : (
              <div onClick={() => { setDescDraft(""); setEditing(true); }}
                style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", marginBottom: 4, cursor: "pointer", fontStyle: "italic", padding: "2px 0" }}
                title="点击添加描述">
                点击添加描述...
              </div>
            )}
            <div style={{ fontSize: "0.65rem", color: "var(--text-tertiary)", lineHeight: 1.5 }}>
              {meta.source && <div>来源：{meta.source}</div>}
              {meta.example && <div style={{ whiteSpace: "pre-wrap", maxHeight: 60, overflow: "hidden" }}>示例：{meta.example}</div>}
            </div>
          </div>
        );
      })}
    </div>
  ) : (
    <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>无变量（纯静态 prompt）</span>
  )}
</div>
```

- [ ] **Step 2: Add `handleUpdateVarDesc` function**

Add to the component (near other handler functions):

```javascript
const handleUpdateVarDesc = (varName, newDesc) => {
  if (!editorData) return;
  const updatedVars = (editorData.variables || []).map((v) =>
    v.name === varName ? { ...v, desc: newDesc } : v
  );
  // Also add entry if not exists
  if (!updatedVars.find((v) => v.name === varName)) {
    updatedVars.push({ name: varName, desc: newDesc });
  }
  setEditorData({ ...editorData, variables: updatedVars });
};
```

Note: Since `useState` is used inside `.map()`, extract the variable card into a separate sub-component `VariableCard` to avoid hooks-in-loop issues:

```jsx
const VariableCard = ({ vName, meta, onUpdateDesc }) => {
  const [editing, setEditing] = React.useState(false);
  const [descDraft, setDescDraft] = React.useState(meta.desc || "");
  const commit = () => {
    setEditing(false);
    if (descDraft !== (meta.desc || "")) {
      onUpdateDesc(vName, descDraft);
    }
  };
  return (
    <div style={{ border: "1px solid var(--border-secondary)", borderRadius: "var(--radius-md)",
      padding: "var(--space-2) var(--space-3)", background: "var(--bg-secondary)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <code style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--blue-700)" }}>
          {"{#"}{vName}{"#}"}
        </code>
        <span style={{ fontSize: "0.65rem", color: "var(--text-tertiary)", background: "var(--bg-tertiary)",
          padding: "1px 6px", borderRadius: "var(--radius-full)" }}>
          {meta.type || "string"}
        </span>
      </div>
      {editing ? (
        <div style={{ marginBottom: 4 }}>
          <input value={descDraft} onChange={(e) => setDescDraft(e.target.value)}
            onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
            autoFocus placeholder="变量描述..."
            style={{ width: "100%", fontSize: "0.72rem", padding: "2px 6px",
              border: "1px solid var(--blue-300)", borderRadius: 4, outline: "none" }} />
        </div>
      ) : (
        <div onClick={() => setEditing(true)}
          style={{ fontSize: "0.7rem", color: meta.desc ? "var(--text-secondary)" : "var(--text-tertiary)",
            marginBottom: 4, cursor: "pointer", padding: "2px 0", fontStyle: meta.desc ? "normal" : "italic" }}
          title="点击编辑描述">
          {meta.desc || "点击添加描述..."}
        </div>
      )}
      <div style={{ fontSize: "0.65rem", color: "var(--text-tertiary)", lineHeight: 1.5 }}>
        {meta.source && <div>来源：{meta.source}</div>}
        {meta.example && <div style={{ whiteSpace: "pre-wrap", maxHeight: 60, overflow: "hidden" }}>示例：{meta.example}</div>}
      </div>
    </div>
  );
};
```

Then in the JSX, replace the variable map with:
```jsx
{currentVars.map((vName) => {
  const meta = dbVars.find((d) => d.name === vName) || {};
  return <VariableCard key={vName} vName={vName} meta={meta} onUpdateDesc={handleUpdateVarDesc} />;
})}
```

- [ ] **Step 3: Verify frontend builds**

```bash
npm run build
```
Expected: build succeeds without errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/teacher/PromptManagementTab.jsx
git commit -m "💄 style: enhance prompt variable display with desc/source/type/example cards and inline editing"
```

---

### Task 8: Final integration verification

**Files:**
- No new files — verify everything works together

- [ ] **Step 1: Run full backend test suite**

```bash
& "D:\repo\dev\nursing-vp-sim\backend\.venv\Scripts\python.exe" -m pytest tests/ -v -q
```
Expected: all tests pass (136+ tests)

- [ ] **Step 2: Run ruff lint on modified files**

```bash
uv run ruff check services/variable_registry.py services/prompt_manager.py routers/admin_prompts.py prompt_static.py routers/chat.py services/scoring.py routers/cases.py
```
Expected: no new errors (pre-existing warnings acceptable)

- [ ] **Step 3: Verify registry module handles all edge cases**

```bash
& "D:\repo\dev\nursing-vp-sim\backend\.venv\Scripts\python.exe" -c "
from services.variable_registry import get_registry
r = get_registry()
# All purposes return valid data
for p in ['patient_chat', 'scoring', 'case_generation', 'qa']:
    vars_ = r.get_variables(p)
    names = r.get_variable_names(p)
    assert len(vars_) == len(names), f'{p}: vars != names'
    sample = r.get_sample_kwargs(p)
    assert len(sample) == len(vars_), f'{p}: sample mismatched'
    jsonb = r.get_variables_jsonb(p)
    assert len(jsonb) == len(vars_), f'{p}: jsonb mismatched'
    for entry in jsonb:
        assert entry['desc'], f'{p}: {entry[\"name\"]} has empty desc'
        assert entry['source'], f'{p}: {entry[\"name\"]} has empty source'
print('All integration checks passed')
"
```
Expected: `All integration checks passed`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "✅ test: final integration verification of VariableRegistry across all endpoints"
```

---

**Plan complete.**
