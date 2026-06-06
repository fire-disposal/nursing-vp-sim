# 患者交互范式重构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将患者交互从"关键词管控"重构为"语境塑造"——引入人格模型、情绪状态机、SessionConfig 抽象，取消 hidden_info 关键词解锁，缩减 guard 为仅身份泄露检测。

**Architecture:** 系统层（Python）负责状态计算、意图分类、操作处理；LLM 只负责在受控语境下生成自然语言。通过 Author's Note 在每轮 prompt 中注入一行状态提示。

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy, PostgreSQL, Alembic, DeepSeek (OpenAI-compatible context caching)

---

## File Structure

```
backend/
  models.py                          # MODIFY: add personality JSONB to Case
  schemas.py                         # MODIFY: add personality to CaseManageItem, new SessionConfig/Operation schemas
  prompts/patient_chat.py            # MODIFY: restructure to Character Card format, add Author's Note marker
  services/
    virtual_patient_prompt.py        # MODIFY: extract personality, inject Author's Note, deep_background
    patient_guard.py                 # MODIFY: strip to identity-leak-only, remove all pattern dicts
    emotion_engine.py                # CREATE: port from lab/experiment_02_emotion_state.py
    exam_handler.py                  # CREATE: operation keywork binding and anchor data lookup
  routers/
    chat.py                          # MODIFY: integrate emotion + guard retry + operation detection
    training.py                      # MODIFY: accept config_id, store snapshot
    cases.py                         # MODIFY: validate new JSON fields in case_data
  data/
    session_configs/                 # CREATE: JSON preset configs
      standard-assessment.json
      classroom-practice.json
      free-exploration.json
      scenario-simulation.json
  migrations/versions/               # CREATE: 0007 training_record_config.py

frontend/src/
  components/
    teacher/
      OperationPanel.tsx             # CREATE: vital signs / exam buttons
  pages/
    ChatTraining.tsx                 # MODIFY: add OperationPanel, dual-channel result display

lab/experiment_02_emotion_state.py   # REFERENCE only (no changes)
```

---

## P0: Foundation

### Task 1: Remove guard regex patterns, keep identity-leak only

**Files:**
- Modify: `backend/services/patient_guard.py:1-189`

- [ ] **Step 1: Rewrite `patient_guard.py`**

Replace the entire file content:

```python
"""患者角色守卫 — 仅身份泄露检测。其余行为约束由 prompt 工程负责。"""

IDENTITY_LEAK_PATTERNS = [
    "我是AI",
    "我是人工智能",
    "我是虚拟患者",
    "我是模拟",
    "作为AI",
    "评分标准",
    "教学反馈",
    "该问的",
    "你应该继续问",
    "你的表现",
    "这套系统",
    "训练模式",
    "病例",
]


def has_identity_leak(reply: str) -> bool:
    """检测患者回复是否泄露了 AI/模拟身份。"""
    reply_lower = reply.lower()
    for pattern in IDENTITY_LEAK_PATTERNS:
        if pattern.lower() in reply_lower:
            return True
    return False


def get_identity_correction_note() -> str:
    """返回身份泄露时的 Author's Note 修正提示。"""
    return "【注意：你在扮演真实患者，你是人不是AI。用患者的语气自然回应，不要提及任何关于训练、评分、系统的内容。】"
```

- [ ] **Step 2: Remove old pattern dicts**

Delete in `backend/services/patient_guard.py`:
- `ROLE_LEAK_PATTERNS` (lines 13-24)
- `DIAGNOSIS_PATTERNS` (lines 26-28)
- `TEACHING_LEAK_PATTERNS` (lines 30-32)
- `UNKNOWN_FALLBACKS` (lines 37-40)
- `detect_violations()` (lines 49-54)
- `has_critical_violation()` (lines 57-59)
- `check_role_leak()` (lines 62-66)
- `check_diagnosis_leak()` (lines 69-73)
- `check_teaching_leak()` (lines 76-80)
- `normalize_addressing_to_nurse()` (lines 83-95)
- `correct_via_llm()` (lines 98-139)
- `_keyword_match()` (lines 142-147)
- `get_revealed_topics()` (lines 149-157)
- `get_allowed_hidden_info()` (lines 160-181)
- `sanitize_patient_reply()` (lines 184-189)

Keep only `IDENTITY_LEAK_PATTERNS`, `has_identity_leak()`, `get_identity_correction_note()`.

- [ ] **Step 3: Verify no imports broke**

```bash
rg "from.*patient_guard import" backend/ --no-heading
```

Expected: only `chat.py` imports `sanitize_patient_reply` and `get_allowed_hidden_info`. These will be addressed in following tasks.

- [ ] **Step 4: Commit**

```bash
git add backend/services/patient_guard.py
git commit -m "refactor: strip patient_guard to identity-leak-only, remove regex pattern dicts"
```

---

### Task 2: Add personality and deep_background to Case JSON schema

**Files:**
- Modify: `backend/routers/cases.py:1-292`
- Modify: `backend/schemas.py:107-134`

- [ ] **Step 1: Add personality validation to `create_case` in `cases.py`**

In `backend/routers/cases.py`, after the name validation (line 222), add personality defaults:

```python
# After line 223 (if len(str(cd.get("name", ""))) > 100: ...)
    # Inject personality defaults if missing
    if "personality" not in cd:
        cd["personality"] = {
            "health_literacy": "normal",
            "verbosity": "normal",
            "anxiety_trait": "normal",
            "patience": "normal",
        }
    # Inject empty deep_background if missing
    if "deep_background" not in cd:
        cd["deep_background"] = {}
    # Inject empty exam_anchors if missing
    if "exam_anchors" not in cd:
        cd["exam_anchors"] = {}
```

Apply the same injection in `update_case` (after line 254).

- [ ] **Step 2: Extract personality in `CaseManageItem` and `_to_manage_item`**

In `backend/schemas.py`, add to `CaseManageItem` (after `difficulty`):

```python
    patient_personality: str = ""
```

In `backend/routers/cases.py`, update `_to_manage_item`:

```python
def _to_manage_item(case, training_count: int) -> CaseManageItem:
    cd = case.case_data or {}
    personality = cd.get("personality", {})
    personality_label = _personality_label(personality)
    return CaseManageItem(
        id=case.id,
        name=case.name,
        description=case.description,
        patient_name=cd.get("patient_name", ""),
        patient_age=cd.get("patient_age"),
        patient_gender=cd.get("patient_gender", ""),
        chief_complaint=cd.get("chief_complaint", ""),
        time_limit=cd.get("time_limit", 20),
        difficulty=cd.get("difficulty", 1),
        patient_personality=personality_label,
        created_at=case.created_at,
        training_count=training_count,
    )

def _personality_label(p: dict) -> str:
    """人格维度简要标签，如'高素养·絮叨·安宁·耐心'"""
    if not p:
        return ""
    parts = []
    map_lit = {"low": "低素养", "normal": "中等", "high": "高素养"}
    map_verb = {"terse": "寡言", "normal": "正常", "verbose": "絮叨"}
    map_anx = {"calm": "安宁", "normal": "平常", "anxious": "焦虑"}
    map_pat = {"low": "急躁", "normal": "正常", "high": "耐心"}
    if p.get("health_literacy"):
        parts.append(map_lit.get(p["health_literacy"], ""))
    if p.get("verbosity"):
        parts.append(map_verb.get(p["verbosity"], ""))
    if p.get("anxiety_trait"):
        parts.append(map_anx.get(p["anxiety_trait"], ""))
    if p.get("patience"):
        parts.append(map_pat.get(p["patience"], ""))
    return "·".join(filter(None, parts))
```

- [ ] **Step 3: Verify existing case creation still works**

```bash
cd backend && uv run python -c "
from routers.cases import _personality_label
assert _personality_label({'health_literacy':'low','verbosity':'verbose','anxiety_trait':'calm','patience':'high'}) == '低素养·絮叨·安宁·耐心'
assert _personality_label({}) == ''
print('OK')
"
```

- [ ] **Step 4: Commit**

```bash
git add backend/routers/cases.py backend/schemas.py
git commit -m "feat: add personality defaults and labels to Case JSON schema"
```

---

### Task 3: Restructure prompt to Character Card + Author's Note placeholder

**Files:**
- Modify: `backend/prompts/patient_chat.py:1-67`

- [ ] **Step 1: Rewrite `PATIENT_CHAT_SYSTEM`**

Replace content of `backend/prompts/patient_chat.py`:

```python
"""患者角色扮演系统提示 — Character Card 格式"""

PATIENT_CHAT_SYSTEM = """你正在扮演一位真实患者。以下定义了你的身份、性格、和当前状态。

## 你的身份

{#patient_info#}

主诉：{#chief_complaint#}
现病史：{#present_illness#}
过敏史：{#allergy_history#}

## 你的背景（始终知晓，按性格自然使用）

{#deep_background#}

## 你的性格

{#personality#}

## 沟通风格

{#communication_style#}

## 行为规则

1. 你是真实的人，不是 AI。永远不要提起"AI""虚拟""训练""系统""评分"等概念。
2. 按你的性格自然地描述自己的感受和病史。医生无法分辨你来就诊的具体原因。
3. 不要主动说"我来看什么病"——这是医生通过问诊来判断的。
4. 不要一次性说一大堆。每次回答 1-3 句话，像真实聊天一样。
5. 对方可能一次问你多个问题——感到不耐烦或困惑是正常的。
6. 如果听到对方的关心或同理心，自然地放松心情。
7. 如果你不知道的事情，按你的性格如实说"不清楚""不记得"。
8. 不使用表格、列表、医学缩写。不说"患者："或"回答："等前缀。
9. 用口语表达，不要说"我作为患者"。你就是你。

## 当前状态

{#author_note#}

现在，以患者的身份回应下面这句话："""

PATIENT_CACHE_SPLIT_MARKER = "## 你的背景"
```

### important: The cache split marker changes from `## 患者资料` to `## 你的背景`. This affects `virtual_patient_prompt.py`.

- [ ] **Step 2: Verify the template variable count matches `build_patient_context_kwargs`**

```bash
cd backend && uv run python -c "
from prompts.patient_chat import PATIENT_CHAT_SYSTEM
vars = ['patient_info', 'chief_complaint', 'present_illness', 'allergy_history', 'deep_background', 'personality', 'communication_style', 'author_note']
for v in vars:
    assert f'{{#{v}#}}' in PATIENT_CHAT_SYSTEM, f'Missing variable: {v}'
print('All 8 variables present')
"
```

Expected: `All 8 variables present`

- [ ] **Step 3: Commit**

```bash
git add backend/prompts/patient_chat.py
git commit -m "refactor: restructure patient prompt as Character Card with Author's Note"
```

---

### Task 4: Update `virtual_patient_prompt.py` for new fields

**Files:**
- Modify: `backend/services/virtual_patient_prompt.py:1-102`

- [ ] **Step 1: Update `build_patient_context_kwargs` to extract new fields**

Replace `build_patient_context_kwargs` in `backend/services/virtual_patient_prompt.py`:

```python
def build_patient_context_kwargs(
    case_data: dict,
    author_note: str = "",
) -> dict[str, str]:
    """从 case_data 构建患者 prompt 的模板变量。"""

    def _get(key: str, default: str = "无") -> str:
        return str(case_data.get(key, "")).strip() or default

    def _format_personality(p: dict) -> str:
        if not p:
            return "普通患者，正常配合。"
        parts = []
        lit = {"low": "不太会描述病情", "normal": "能正常描述", "high": "能精准描述"}
        verb = {"terse": "寡言少语，问一句答一句", "normal": "正常交流", "verbose": "话多，容易跑题"}
        anx = {"calm": "心态平和", "normal": "适度担心", "anxious": "容易焦虑，常反问病情严重程度"}
        pat = {"low": "耐心不足，容易急躁", "normal": "有耐心", "high": "非常耐心"}
        if p.get("health_literacy"):
            parts.append(lit.get(p["health_literacy"], ""))
        if p.get("verbosity"):
            parts.append(verb.get(p["verbosity"], ""))
        if p.get("anxiety_trait"):
            parts.append(anx.get(p["anxiety_trait"], ""))
        if p.get("patience"):
            parts.append(pat.get(p["patience"], ""))
        return "，".join(filter(None, parts)) + "。"

    def _format_deep_background(db: dict) -> str:
        if not db:
            return "（无额外背景）"
        lines = []
        for key, value in db.items():
            lines.append(f"- {key}: {value}")
        return "\n".join(lines)

    personality = case_data.get("personality", {})
    deep_bg = case_data.get("deep_background", {})

    return {
        "patient_info": _get("patient_info", f"{case_data.get('patient_name','未知')}，{case_data.get('patient_age','?')}岁，{case_data.get('patient_gender','未知')}"),
        "chief_complaint": _get("chief_complaint"),
        "present_illness": _get("present_illness"),
        "allergy_history": _get("allergy_history", "无已知过敏史"),
        "communication_style": _get("communication_style", "用口语化、真实患者的口吻交流。"),
        "personality": _format_personality(personality),
        "deep_background": _format_deep_background(deep_bg),
        "author_note": author_note if author_note.strip() else "（常规状态，正常配合）",
    }
```

- [ ] **Step 2: Update `build_patient_chat_messages` for new cache split marker**

Change the split logic in `build_patient_chat_messages` to use the new marker:

```python
from prompts.patient_chat import PATIENT_CACHE_SPLIT_MARKER

def build_patient_chat_messages(
    system_prompt: str,
    history_messages: list[dict],
    student_content: str,
    max_rounds: int = 8,
) -> list[dict]:
    """构建患者聊天的 messages 数组。

    使用 cache-split 策略：
    - messages[0] = 静态角色规则（缓存）
    - messages[1] = 背景/性格/当前状态（~200 tokens）
    """
    parts = system_prompt.split(PATIENT_CACHE_SPLIT_MARKER)
    if len(parts) == 2:
        static_part = parts[0].rstrip()
        dynamic_part = PATIENT_CACHE_SPLIT_MARKER + parts[1]
    else:
        static_part = system_prompt
        dynamic_part = ""

    messages = [{"role": "system", "content": static_part}]
    if dynamic_part:
        messages.append({"role": "system", "content": dynamic_part})

    relevant = history_messages[-max_rounds * 2:]
    for msg in relevant:
        role = "user" if msg.get("role") == "student" else "assistant"
        messages.append({"role": role, "content": msg["content"]})

    messages.append({"role": "user", "content": student_content})
    return messages
```

- [ ] **Step 3: Remove unused imports**

Remove `VariableRegistry` import if no longer needed after removing hidden_info_rules logic.

- [ ] **Step 4: Verify template rendering works**

```bash
cd backend && uv run python -c "
from services.virtual_patient_prompt import build_patient_context_kwargs
from prompts.patient_chat import PATIENT_CHAT_SYSTEM

# Test with minimal case data
case = {
    'name': 'test',
    'personality': {'health_literacy': 'low', 'verbosity': 'terse'},
    'deep_background': {'smoking': '30年吸烟史'},
    'patient_name': '张三',
    'patient_age': 45,
    'patient_gender': '男',
    'chief_complaint': '胸痛3天',
}
kwargs = build_patient_context_kwargs(case, '【情绪：relaxed】')
rendered = PATIENT_CHAT_SYSTEM
for k, v in kwargs.items():
    rendered = rendered.replace('{#' + k + '#}', v)
assert '【情绪：relaxed】' in rendered
assert '30年吸烟史' in rendered
assert '不太会描述病情' in rendered
print('OK')
"
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/services/virtual_patient_prompt.py
git commit -m "refactor: update prompt builder for personality, deep_background, Author's Note injection"
```

---

### Task 5: Update `chat.py` for guard integration changes

**Files:**
- Modify: `backend/routers/chat.py:1-253`

- [ ] **Step 1: Update imports in `chat.py`**

Replace:
```python
from services.patient_guard import get_allowed_hidden_info, sanitize_patient_reply
```
With:
```python
from services.patient_guard import has_identity_leak, get_identity_correction_note
```

- [ ] **Step 2: Rewrite `_build_llm_context` to remove hidden_info logic**

Replace `_build_llm_context` with simplified version:

```python
def _build_llm_context(
    record: TrainingRecord,
    student_content: str,
    db: Session,
    emotion_note: str = "",
    operation_note: str = "",
) -> list[dict]:
    """构建 LLM 上下文。不再使用 hidden_info 关键词解锁。"""
    case = record.case
    case_data = case.case_data or {}

    # Compose Author's Note
    author_parts = []
    if emotion_note:
        author_parts.append(emotion_note)
    if operation_note:
        author_parts.append(operation_note)
    author_note = "；".join(author_parts) if author_parts else ""

    kwargs = build_patient_context_kwargs(case_data, author_note)
    
    prompt_manager = PromptManager(db)
    system_prompt = prompt_manager.render_prompt("patient_chat", **kwargs)

    history = _flatten_history(record.messages)
    return build_patient_chat_messages(system_prompt, history, student_content)
```

Remove `chat_session` imports related to `restore_topics` and `add_topic`.

- [ ] **Step 3: Add identity leak + retry in `_generate_patient_reply`**

Add a new helper function after `_build_llm_context`:

```python
async def _generate_patient_reply(
    messages: list[dict],
    max_retries: int = 1,
) -> str:
    """调用 LLM 生成患者回复。身份泄露时追加 Author's Note 重试一次。"""
    reply = await call_llm(messages, purpose="patient_chat")
    
    for attempt in range(max_retries):
        if not has_identity_leak(reply):
            break
        log.warning(f"身份泄露检测到，追加 Author's Note 重试 (attempt {attempt + 1})")
        corrected_note = get_identity_correction_note()
        messages_with_note = list(messages)
        messages_with_note.insert(-1, {"role": "system", "content": corrected_note})
        reply = await call_llm(messages_with_note, purpose="patient_chat")
    
    return reply
```

- [ ] **Step 4: Update `POST /{record_id}/message` to use new pipeline**

Replace the LLM call section (lines 80-110 approximately):

```python
# Old:
# patient_reply = await call_llm(messages, purpose="patient_chat")
# normalized, violations, needs_correction = sanitize_patient_reply(patient_reply, case_data)
# if needs_correction:
#     patient_reply = await correct_via_llm(patient_reply, violations, case_data)

# New:
emotion_note = _get_emotion_note(record, student_content) if EMOTION_ENABLED else ""
patient_reply = await _generate_patient_reply(messages)
```

Add `_get_emotion_note` as a stub for Task 12:

```python
def _get_emotion_note(record, student_msg: str) -> str:
    """Stub — will be replaced by emotion engine in Task 12."""
    return ""
```

- [ ] **Step 5: Update streaming endpoint similarly**

Apply the same changes to `POST /{record_id}/message/stream` (lines 132-250).

- [ ] **Step 6: Commit**

```bash
git add backend/routers/chat.py
git commit -m "refactor: update chat pipeline—remove hidden_info, add identity-leak retry, Author's Note stub"
```

---

## P1: SessionConfig + Knowledge Injection

### Task 6: SessionConfig JSON presets

**Files:**
- Create: `backend/data/session_configs/standard-assessment.json`
- Create: `backend/data/session_configs/classroom-practice.json`
- Create: `backend/data/session_configs/free-exploration.json`
- Create: `backend/data/session_configs/scenario-simulation.json`

- [ ] **Step 1: Create directory and config files**

```bash
mkdir -p backend/data/session_configs
```

**`standard-assessment.json`:**

```json
{
  "id": "standard-assessment",
  "name": "标准化考核",
  "mode": "assessment",
  "features": {
    "scoring": true,
    "hints": false,
    "patient_initiative": false,
    "physical_exam": false,
    "nursing_documentation": false,
    "dynamic_events": false
  },
  "behavior": {
    "emotion_model": true,
    "time_limit_minutes": 20,
    "max_rounds": 30
  },
  "assessment": {
    "rubric_id": 1,
    "auto_settlement": true,
    "settlement_timeout_min": 30
  }
}
```

**`classroom-practice.json`:**

```json
{
  "id": "classroom-practice",
  "name": "课堂练习",
  "mode": "training",
  "features": {
    "scoring": true,
    "hints": true,
    "patient_initiative": false,
    "physical_exam": true,
    "nursing_documentation": false,
    "dynamic_events": false
  },
  "behavior": {
    "emotion_model": true,
    "time_limit_minutes": 30,
    "max_rounds": 40
  },
  "assessment": {
    "rubric_id": 1,
    "auto_settlement": true,
    "settlement_timeout_min": 30
  }
}
```

**`free-exploration.json`:**

```json
{
  "id": "free-exploration",
  "name": "自由探索",
  "mode": "free_play",
  "features": {
    "scoring": false,
    "hints": true,
    "patient_initiative": false,
    "physical_exam": true,
    "nursing_documentation": false,
    "dynamic_events": false
  },
  "behavior": {
    "emotion_model": true,
    "time_limit_minutes": 60,
    "max_rounds": 60
  },
  "assessment": null
}
```

**`scenario-simulation.json`:**

```json
{
  "id": "scenario-simulation",
  "name": "情境模拟",
  "mode": "training",
  "features": {
    "scoring": true,
    "hints": false,
    "patient_initiative": true,
    "physical_exam": true,
    "nursing_documentation": false,
    "dynamic_events": true
  },
  "behavior": {
    "emotion_model": true,
    "time_limit_minutes": 30,
    "max_rounds": 45
  },
  "assessment": {
    "rubric_id": 1,
    "auto_settlement": true,
    "settlement_timeout_min": 30
  }
}
```

- [ ] **Step 2: Create config loader `backend/services/session_config.py`**

```python
"""SessionConfig loader — 从 JSON 预设文件加载会话配置。"""

import json
from pathlib import Path

_CONFIG_DIR = Path(__file__).parent.parent / "data" / "session_configs"
_CACHE: dict[str, dict] = {}


def load_config(config_id: str) -> dict:
    """加载指定 ID 的会话配置预设。"""
    if config_id in _CACHE:
        return _CACHE[config_id]

    path = _CONFIG_DIR / f"{config_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"SessionConfig 不存在: {config_id}")

    with open(path, encoding="utf-8") as f:
        config = json.load(f)

    _CACHE[config_id] = config
    return config


def list_configs() -> list[dict]:
    """列出所有可用配置预设（不含快照细节）。"""
    configs = []
    for path in sorted(_CONFIG_DIR.glob("*.json")):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        configs.append({
            "id": data["id"],
            "name": data["name"],
            "mode": data["mode"],
        })
    return configs


def get_default_config_id() -> str:
    """默认配置（无配置时使用标准化考核）。"""
    return "standard-assessment"
```

- [ ] **Step 3: Verify configs parse correctly**

```bash
cd backend && uv run python -c "
from services.session_config import load_config, list_configs
configs = list_configs()
assert len(configs) == 4, f'Expected 4 configs, got {len(configs)}'
for c in configs:
    cfg = load_config(c['id'])
    assert cfg['mode'] in ('assessment', 'training', 'free_play')
print(f'All {len(configs)} configs valid')
"
```

Expected: `All 4 configs valid`

- [ ] **Step 4: Commit**

```bash
git add backend/data/session_configs/ backend/services/session_config.py
git commit -m "feat: add SessionConfig JSON presets and loader"
```

---

### Task 7: TrainingRecord config_id migration + link

**Files:**
- Create: `backend/migrations/versions/0007_training_record_config.py`
- Modify: `backend/models.py:122-131`
- Modify: `backend/schemas.py` (TrainingRecord schemas)
- Modify: `backend/routers/training.py:1-491`

- [ ] **Step 1: Add columns to `TrainingRecord` model**

In `backend/models.py`, add to `TrainingRecord`:

```python
# After line 131 (before the relationship definitions):
    config_id: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)
    config_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True, default=None)
```

- [ ] **Step 2: Create migration**

```bash
cd backend && uv run alembic revision --autogenerate -m "add training_record config_id and config_snapshot"
```

Verify the generated migration file is at `backend/migrations/versions/0007_training_record_config.py` and adds the two columns.

```bash
cd backend && uv run alembic upgrade head
```

Expected: migration applies without error.

- [ ] **Step 3: Update `POST /api/training/start` in `training.py`**

In `backend/routers/training.py`, update the start endpoint to accept `config_id` and store the snapshot:

```python
class TrainingStartRequest(BaseModel):
    case_id: int
    config_id: str | None = None

@router.post("/start", response_model=TrainingStartResponse)
def start_training(
    req: TrainingStartRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permission("training_access"))],
):
    case = db.query(Case).filter(Case.id == req.case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")

    # Load config
    config_id = req.config_id or get_default_config_id()
    try:
        config = load_config(config_id)
    except FileNotFoundError:
        raise HTTPException(status_code=400, detail=f"会话配置不存在: {config_id}")

    record = TrainingRecord(
        user_id=current_user.id,
        case_id=case.id,
        config_id=config_id,
        config_snapshot=config,
        status="in_progress",
        time_limit=config.get("behavior", {}).get("time_limit_minutes", 20),
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    # greeting message...
    # (existing code continues)
```

Update the greeting message generation to use personality from case_data.

- [ ] **Step 4: Update `TrainingRecordDetail` schema**

In `backend/schemas.py`, add to the detail schema:

```python
    config_id: str | None = None
    config_snapshot: dict | None = None
```

- [ ] **Step 5: Run existing tests to verify no regressions**

```bash
cd backend && uv run pytest tests/ -x -q 2>&1 | tail -20
```

Expected: existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add backend/models.py backend/migrations/versions/0007_*.py backend/routers/training.py backend/schemas.py
git commit -m "feat: add config_id/snapshot to TrainingRecord, accept on session start"
```

---

### Task 8: Add SessionConfig list endpoint + assessment decoupling audit

**Files:**
- Modify: `backend/schemas.py:1-861`
- Create: `backend/routers/session_configs.py`
- Modify: `backend/main.py:1-417`

- [ ] **Step 1: Add SessionConfig schemas**

In `backend/schemas.py`, add:

```python
class SessionConfigBrief(BaseModel):
    model_config = _RESP_CFG
    id: str
    name: str
    mode: str


class SessionConfigDetail(BaseModel):
    model_config = _RESP_CFG
    id: str
    name: str
    mode: str
    features: dict
    behavior: dict
    assessment: dict | None = None
```

- [ ] **Step 2: Create `backend/routers/session_configs.py`**

```python
"""SessionConfig API endpoints."""

from fastapi import APIRouter

from schemas import SessionConfigBrief, SessionConfigDetail
from services.session_config import list_configs, load_config

router = APIRouter(prefix="/api/session-configs", tags=["session-configs"])


@router.get("", response_model=list[SessionConfigBrief])
def get_configs():
    """列出所有会话配置预设（简要）。"""
    return list_configs()


@router.get("/{config_id}", response_model=SessionConfigDetail)
def get_config(config_id: str):
    """获取单个会话配置详情。"""
    try:
        return load_config(config_id)
    except FileNotFoundError:
        from fastapi.exceptions import HTTPException
        raise HTTPException(status_code=404, detail=f"配置不存在: {config_id}")
```

- [ ] **Step 3: Register router in `main.py`**

In `backend/main.py`, add import and router registration:

```python
from routers.session_configs import router as session_configs_router
# Add near other router registrations:
app.include_router(session_configs_router)
```

- [ ] **Step 4: Assessment decoupling audit**

Create `docs/superpowers/specs/2026-06-06-assessment-decoupling-audit.md`:

```markdown
# Assessment Decoupling Audit

## Current state
- `training.py` triggers `_run_scoring_background` in a BackgroundTasks thread
- Scoring reads all messages from TrainingRecord, scores independently
- No scoring logic in `chat.py`

## Verdict: Already decoupled. No code changes needed.

The interaction pipeline (chat.py) only writes messages and returns replies.
The scoring pipeline (training.py + scoring.py) reads completed messages as a batch.
Neither detects or references the other.

## Future guard
When adding new features (operation results, nursing documentation),
ensure they're stored as Message types or separate tables that scoring.py can read.
```

- [ ] **Step 5: Commit**

```bash
git add backend/schemas.py backend/routers/session_configs.py backend/main.py docs/superpowers/specs/2026-06-06-assessment-decoupling-audit.md
git commit -m "feat: add SessionConfig list/detail API + assessment decoupling audit"
```

---

## P2: Operations + Emotion Engine

### Task 9: Port emotion engine from lab

**Files:**
- Create: `backend/services/emotion_engine.py`
- Test: `backend/tests/test_emotion_engine.py`

- [ ] **Step 1: Write tests**

```python
# backend/tests/test_emotion_engine.py
import pytest
from services.emotion_engine import EmotionState, classify_intent


def test_classify_empathy():
    assert classify_intent("您辛苦了一直忍着") == "empathy"
    assert classify_intent("别担心，会好起来的") == "empathy"
    assert classify_intent("坚持一下") == "empathy"


def test_classify_rude():
    assert classify_intent("你怎么不早说") == "rude"
    assert classify_intent("你这个人怎么什么都不知道") == "rude"


def test_classify_neutral():
    assert classify_intent("您哪里不舒服？") == "neutral"
    assert classify_intent("早上吃的什么药？") == "neutral"


def test_classify_explanation():
    assert classify_intent("我给您检查一下，这是为了看看肺部的情况") == "explanation"
    assert classify_intent("量个血压，看一下正不正常") == "explanation"


def test_emotion_state_initial():
    state = EmotionState()
    assert state.score == 0
    assert state.name == "neutral"


def test_emotion_state_improves_with_empathy():
    state = EmotionState()
    state.update("empathy")
    assert state.score > 0


def test_emotion_state_worsens_with_rude():
    state = EmotionState()
    state.update("rude")
    assert state.score == -2  # max penalty


def test_emotion_state_clamped():
    state = EmotionState(score=2)
    state.update("empathy")
    assert state.score == 2  # capped


def test_emotion_state_author_note():
    state = EmotionState()
    note = state.author_note()
    assert note == ""  # neutral = no note

    state.update("empathy")
    state.update("empathy")
    assert "relaxed" in state.author_note().lower() or "open" in state.author_note().lower()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && uv run pytest tests/test_emotion_engine.py -v
```

Expected: ImportError or all FAIL (module not found)

- [ ] **Step 3: Port `emotion_engine.py` from lab**

Create `backend/services/emotion_engine.py`:

```python
"""5态情绪引擎 — 规则驱动的患者情绪状态机。

从 lab/experiment_02_emotion_state.py 移植并适配 Web 环境。
"""

STATES = {-2: "withdrawn", -1: "defensive", 0: "neutral", 1: "relaxed", 2: "open"}

INTENT_KEYWORDS = {
    "empathy": ["辛苦", "别担心", "会好的", "坚持一下", "没事的", "理解你", "体谅", "放松", "没关系", "慢慢来"],
    "explanation": ["检查一下", "看一下", "量个血压", "为了", "是因为", "确认一下"],
    "rude": ["怎么不早说", "什么都不", "不会说", "不知道还", "你这个人", "麻烦你配合"],
    "prying": ["你到底", "你确定", "再说一遍", "到底是怎么回事", "肯定有隐瞒"],
}

INTENT_TO_DELTA = {
    "empathy": 1,
    "explanation": 1,
    "neutral": 0,
    "prying": -1,
    "rude": -2,
}

STATE_NOTES = {
    -2: "【情绪：withdrawn】患者沉默敷衍。回答至多5字。必须先表达关心来赢回信任。",
    -1: "【情绪：defensive】患者有防御情绪。回答简短、绕开问题。需要学生先安抚。",
    0: "",
    1: "【情绪：relaxed】患者放松配合，愿意多聊一些。",
    2: "【情绪：open】患者信任你，会主动补充未问到的细节。",
}


def classify_intent(msg: str) -> str:
    """规则匹配学生消息的意图。返回 empathy/explanation/rude/prying/neutral。"""
    msg_lower = msg.lower()
    for intent, keywords in INTENT_KEYWORDS.items():
        for kw in keywords:
            if kw in msg_lower:
                return intent
    return "neutral"


class EmotionState:
    def __init__(self, score: int = 0):
        self.score = max(-2, min(2, score))
        self._consecutive_same_direction = 0

    @property
    def name(self) -> str:
        return STATES.get(self.score, "neutral")

    @property
    def author_note(self) -> str:
        return STATE_NOTES.get(self.score, "")

    def update(self, intent_or_delta: str | int) -> None:
        """根据学生意图更新情绪分数。返回新的 author_note。"""
        if isinstance(intent_or_delta, int):
            delta = intent_or_delta
        else:
            delta = INTENT_TO_DELTA.get(intent_or_delta, 0)

        # 累计同向趋势，防止一次共情就立刻 open
        if delta > 0:
            if self._consecutive_same_direction > 0:
                self._consecutive_same_direction += 1
            else:
                self._consecutive_same_direction = 1
            effective = 1 if self._consecutive_same_direction >= 2 else 0.5
        elif delta < 0:
            if self._consecutive_same_direction < 0:
                self._consecutive_same_direction -= 1
            else:
                self._consecutive_same_direction = -1
            effective = -1 if self._consecutive_same_direction <= -2 else -0.5
        else:
            self._consecutive_same_direction = 0
            effective = 0

        self.score = max(-2, min(2, self.score + effective))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && uv run pytest tests/test_emotion_engine.py -v
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/emotion_engine.py backend/tests/test_emotion_engine.py
git commit -m "feat: port emotion state machine from lab experiment_02"
```

---

### Task 10: Integrate emotion engine into chat pipeline

**Files:**
- Modify: `backend/routers/chat.py` — the `_get_emotion_note` stub
- Modify: `backend/services/chat_session.py:1-24` — add emotion state storage

- [ ] **Step 1: Add emotion state tracking to `chat_session.py`**

```python
# In backend/services/chat_session.py, add:
from services.emotion_engine import EmotionState, classify_intent

_emotion_states: dict[int, EmotionState] = {}


def get_emotion_state(record_id: int) -> EmotionState:
    """获取或创建指定 record 的情绪状态。"""
    if record_id not in _emotion_states:
        _emotion_states[record_id] = EmotionState()
    return _emotion_states[record_id]


def compute_emotion_note(record_id: int, student_msg: str) -> str:
    """计算并更新情绪状态，返回 Author's Note。"""
    state = get_emotion_state(record_id)
    intent = classify_intent(student_msg)
    state.update(intent)
    return state.author_note


def cleanup_emotion_state(record_id: int) -> None:
    """会话结束时清理情绪状态。"""
    _emotion_states.pop(record_id, None)
```

- [ ] **Step 2: Replace `_get_emotion_note` stub in `chat.py`**

```python
# In backend/routers/chat.py, replace the stub:
from services.chat_session import compute_emotion_note, cleanup_emotion_state

def _get_emotion_note(record_id: int, student_msg: str) -> str:
    return compute_emotion_note(record_id, student_msg)
```

- [ ] **Step 3: Add cleanup call in non-streaming endpoint**

In the `POST /{record_id}/message` endpoint, at the end (after saving messages), add cleanup when `status` changes to `completed`:

```python
# After existing end-of-session logic:
if record.status == "completed":
    cleanup_emotion_state(record.id)
```

- [ ] **Step 4: Verify emotion injection works**

```bash
cd backend && uv run python -c "
from services.emotion_engine import EmotionState, classify_intent
state = EmotionState()
assert state.author_note == ''
state.update('empathy')
state.update('empathy')
assert 'relaxed' in state.author_note()
state.update('rude')
state.update('rude')
assert 'defensive' in state.author_note() or 'withdrawn' in state.author_note()
print('Emotion engine: OK')
from services.chat_session import compute_emotion_note, cleanup_emotion_state
note = compute_emotion_note(999, '您辛苦了')
cleanup_emotion_state(999)
print('Chat session integration: OK')
"
```

Expected: `Emotion engine: OK` / `Chat session integration: OK`

- [ ] **Step 5: Commit**

```bash
git add backend/services/chat_session.py backend/routers/chat.py
git commit -m "feat: integrate emotion state machine into chat pipeline"
```

---

### Task 11: Exam operation handler

**Files:**
- Create: `backend/services/exam_handler.py`
- Test: `backend/tests/test_exam_handler.py`

- [ ] **Step 1: Write tests**

```python
# backend/tests/test_exam_handler.py
import pytest
from services.exam_handler import detect_operation, execute_operation, get_available_operations

SAMPLE_CASE_DATA = {
    "exam_anchors": {
        "vital_signs": {
            "temperature": "36.5-37.0°C",
            "pulse": "72-80次/分",
            "blood_pressure": "120/80-130/85 mmHg"
        },
        "auscultation": {
            "lungs": "双肺呼吸音清，无干湿啰音",
            "heart": "心率规整，各瓣膜听诊区未闻及病理性杂音"
        }
    }
}


def test_detect_slash_command():
    assert detect_operation("/查体") == "physical_exam"
    assert detect_operation("/测体温") == "vital_signs"
    assert detect_operation("/听诊") == "auscultation"
    assert detect_operation("您好，哪里不舒服？") is None


def test_execute_vital_signs():
    result, note = execute_operation("vital_signs", SAMPLE_CASE_DATA)
    assert "temperature" in result or "体温" in result
    assert "患者配合测量生命体征" in note or "查体" in note


def test_execute_auscultation():
    result, note = execute_operation("auscultation", SAMPLE_CASE_DATA)
    assert "lung" in result.lower() or "肺" in result
    assert "听诊" in note


def test_execute_unknown_operation():
    result, note = execute_operation("nonexistent", SAMPLE_CASE_DATA)
    assert "不支持" in result
    assert note == ""


def test_get_available_operations():
    ops = get_available_operations(SAMPLE_CASE_DATA)
    assert len(ops) >= 2
    names = [op["id"] for op in ops]
    assert "vital_signs" in names
    assert "auscultation" in names


def test_get_available_operations_empty():
    ops = get_available_operations({})
    assert ops == []
```

- [ ] **Step 2: Run tests expecting failure**

```bash
cd backend && uv run pytest tests/test_exam_handler.py -v
```

Expected: ImportError

- [ ] **Step 3: Create `exam_handler.py`**

```python
"""查体操作处理器 — 操作关键词识别和锚点数据查询。"""

import random
import re

SLASH_COMMANDS = {
    "physical_exam": ["/查体", "/检查"],
    "vital_signs": ["/测体温", "/测生命体征", "/量血压", "/体征"],
    "auscultation": ["/听诊", "/听肺部", "/听心音"],
    "inspection": ["/视诊"],
    "palpation": ["/触诊"],
}

OPERATION_LABELS = {
    "physical_exam": "体格检查",
    "vital_signs": "生命体征",
    "auscultation": "听诊",
    "inspection": "视诊",
    "palpation": "触诊",
}

ANCHOR_LABELS = {
    "temperature": "体温",
    "pulse": "脉搏",
    "blood_pressure": "血压",
    "lungs": "肺部",
    "heart": "心脏",
    "general": "一般情况",
}


def detect_operation(msg: str) -> str | None:
    """检测学生消息是否触发操作。返回操作 ID 或 None。"""
    msg_clean = msg.strip()
    for op_id, commands in SLASH_COMMANDS.items():
        for cmd in commands:
            if msg_clean.startswith(cmd) or msg_clean == cmd:
                return op_id
    return None


def execute_operation(op_id: str, case_data: dict) -> tuple[str, str]:
    """执行操作，返回 (数据结果, Author's Note 片段)。"""
    exam_anchors = case_data.get("exam_anchors", {})

    if op_id == "physical_exam":
        return _format_physical_exam(exam_anchors), "刚完成体格检查，患者配合。"

    if op_id == "vital_signs":
        anchor = exam_anchors.get("vital_signs", {})
        if not anchor:
            return "无可用体征数据。", ""
        return _format_vital_signs(anchor), "刚完成生命体征测量，患者配合。"

    if op_id == "auscultation":
        anchor = exam_anchors.get("auscultation", {})
        if not anchor:
            return "无可用听诊数据。", ""
        return _format_auscultation(anchor), "刚完成听诊，患者配合。"

    if op_id == "inspection":
        anchor = exam_anchors.get("inspection", {})
        if not anchor:
            return "无可用视诊数据。", ""
        return _format_generic(anchor), "刚完成视诊，患者配合。"

    if op_id == "palpation":
        anchor = exam_anchors.get("palpation", {})
        if not anchor:
            return "无可用触诊数据。", ""
        return _format_generic(anchor), "刚完成触诊，患者配合。"

    return f"不支持的操作：{op_id}", ""


def get_available_operations(case_data: dict) -> list[dict]:
    """返回当前病例可用的操作列表。"""
    exam_anchors = case_data.get("exam_anchors", {})
    if not exam_anchors:
        return []

    ops = []
    for op_id in SLASH_COMMANDS:
        if op_id in ("physical_exam",):
            ops.append({"id": op_id, "label": OPERATION_LABELS[op_id], "slash": SLASH_COMMANDS[op_id][0]})
            continue
        category_key = _category_key(op_id)
        if category_key and category_key in exam_anchors:
            ops.append({"id": op_id, "label": OPERATION_LABELS[op_id], "slash": SLASH_COMMANDS[op_id][0]})

    return ops


def _category_key(op_id: str) -> str | None:
    if op_id == "vital_signs":
        return "vital_signs"
    if op_id == "auscultation":
        return "auscultation"
    if op_id == "inspection":
        return "inspection"
    if op_id == "palpation":
        return "palpation"
    return None


def _pick_value(anchor: str) -> str:
    """从锚点范围中随机取值。支持如 '36.5-37.0°C' 或 '120/80-130/85 mmHg'。"""
    m = re.match(r"([\d.]+)-([\d.]+)(.*)", anchor)
    if m:
        lo, hi, suffix = float(m.group(1)), float(m.group(2)), m.group(3)
        val = round(random.uniform(lo, hi), 1)
        return f"{val}{suffix}"
    return anchor


def _format_vital_signs(anchor: dict) -> str:
    lines = []
    for key, label in [("temperature", "体温"), ("pulse", "脉搏"), ("blood_pressure", "血压")]:
        if key in anchor:
            lines.append(f"{label}: {_pick_value(anchor[key])}")
    return "\n".join(lines) if lines else "无体征数据"


def _format_auscultation(anchor: dict) -> str:
    lines = []
    if "lungs" in anchor:
        lines.append(f"肺部: {anchor['lungs']}")
    if "heart" in anchor:
        lines.append(f"心脏: {anchor['heart']}")
    return "\n".join(lines) if lines else "无听诊数据"


def _format_physical_exam(anchor: dict) -> str:
    parts = []
    if "vital_signs" in anchor:
        parts.append(_format_vital_signs(anchor["vital_signs"]))
    if "auscultation" in anchor:
        parts.append(_format_auscultation(anchor["auscultation"]))
    return "\n".join(parts) if parts else "无查体数据"


def _format_generic(anchor: dict) -> str:
    lines = []
    for key, value in anchor.items():
        label = ANCHOR_LABELS.get(key, key)
        lines.append(f"{label}: {value}")
    return "\n".join(lines)
```

- [ ] **Step 4: Run tests**

```bash
cd backend && uv run pytest tests/test_exam_handler.py -v
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/exam_handler.py backend/tests/test_exam_handler.py
git commit -m "feat: add exam operation handler with slash command detection and anchor data lookup"
```

---

### Task 12: Integrate operation channel into chat pipeline

**Files:**
- Modify: `backend/routers/chat.py` — add operation detection before LLM call
- Modify: `backend/schemas.py` — add operation response schemas

- [ ] **Step 1: Add operation schemas**

In `backend/schemas.py`, add:

```python
class AvailableOperation(BaseModel):
    model_config = _RESP_CFG
    id: str
    label: str
    slash: str


class OperationResponse(BaseModel):
    model_config = _RESP_CFG
    type: str = "operation"
    operation_id: str
    result: str
    patient_reaction: str | None = None
```

- [ ] **Step 2: Update `POST /{record_id}/message` with operation detection**

In `backend/routers/chat.py`, add at the beginning of the message handler (before LLM context building):

```python
# In POST /{record_id}/message:

from services.exam_handler import detect_operation, execute_operation
from services.session_config import load_config

# ... (existing validation code) ...

# Check for operation trigger
operation_id = detect_operation(content)
if operation_id and record.config_snapshot:
    features = record.config_snapshot.get("features", {})
    if features.get("physical_exam", False):
        case_data = record.case.case_data or {}
        result, op_note = execute_operation(operation_id, case_data)
        
        # Save operation as a system message
        op_message = Message(
            record_id=record.id,
            role="system",
            content=f"[操作] {operation_id}: {result}",
        )
        db.add(op_message)
        
        # Save student's slash command as a message
        student_msg = Message(
            record_id=record.id,
            role="student",
            content=content,
        )
        db.add(student_msg)
        db.commit()
        
        # Generate patient reaction with operation context
        emotion_note = _get_emotion_note(record.id, "")
        messages = _build_llm_context(record, content, db, emotion_note, op_note)
        patient_reply = await _generate_patient_reply(messages)
        
        patient_msg = Message(
            record_id=record.id,
            role="patient",
            content=patient_reply,
        )
        db.add(patient_msg)
        db.commit()
        
        return OperationResponse(
            operation_id=operation_id,
            result=result,
            patient_reaction=patient_reply,
        )

# ... (existing normal message flow) ...
```

- [ ] **Step 3: Add `GET /{record_id}/operations` endpoint**  

Add to `backend/routers/chat.py`:

```python
@router.get("/{record_id}/operations", response_model=list[AvailableOperation])
def get_available_operations(
    record_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """获取当前记录可用的操作列表。"""
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")
    if record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问")

    if not record.config_snapshot:
        return []
    features = record.config_snapshot.get("features", {})
    if not features.get("physical_exam", False):
        return []

    case_data = record.case.case_data or {}
    return get_available_operations(case_data)
```

- [ ] **Step 4: Commit**

```bash
git add backend/routers/chat.py backend/schemas.py
git commit -m "feat: integrate operation channel into chat pipeline with slash command detection"
```

---

### Task 13: Frontend — Operation panel + dual-channel display

**Files:**
- Create: `frontend/src/components/OperationPanel.tsx`
- Modify: `frontend/src/pages/ChatTraining.tsx:1-600`

- [ ] **Step 1: Create `OperationPanel.tsx`**

```tsx
import { Button } from "@/components/ui/button";
import { Activity, Stethoscope, Eye, Hand } from "lucide-react";

interface Operation {
  id: string;
  label: string;
  slash: string;
}

interface Props {
  operations: Operation[];
  onTrigger: (op: Operation) => void;
  disabled?: boolean;
}

export function OperationPanel({ operations, onTrigger, disabled }: Props) {
  if (operations.length === 0) return null;

  const icons: Record<string, React.ReactNode> = {
    vital_signs: <Activity className="h-4 w-4" />,
    auscultation: <Stethoscope className="h-4 w-4" />,
    inspection: <Eye className="h-4 w-4" />,
    palpation: <Hand className="h-4 w-4" />,
    physical_exam: <Stethoscope className="h-4 w-4" />,
  };

  return (
    <div className="flex gap-1 px-3 py-2 border-b border-border bg-muted/30 overflow-x-auto">
      {operations.map((op) => (
        <Button
          key={op.id}
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onTrigger(op)}
          className="shrink-0 gap-1 text-xs"
        >
          {icons[op.id]}
          {op.label}
        </Button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Fetch and wire operations in `ChatTraining.tsx`**

In `backend/routers/chat.py`, after existing imports:

```tsx
import { OperationPanel } from "@/components/OperationPanel";
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/api/axios-instance";
```

Add operation fetching:

```tsx
// Inside ChatTraining component, after recordId is available:
const { data: operations } = useQuery({
  queryKey: ["operations", recordId],
  queryFn: () => apiClient.get(`/api/chat/${recordId}/operations`).then(r => r.data),
  enabled: !!recordId,
});
```

Add operation trigger handler:

```tsx
const handleOperation = async (op: { id: string; slash: string }) => {
  setSending(true);
  try {
    const res = await apiClient.post(`/api/chat/${recordId}/message`, {
      content: op.slash,
    });
    if (res.data.type === "operation") {
      setOperationResult({ id: res.data.operation_id, result: res.data.result });
      setMessages(prev => [...prev, {
        role: "patient",
        content: res.data.patient_reaction || "",
      }]);
    }
  } finally {
    setSending(false);
  }
};
```

Insert `<OperationPanel>` above the message input area:

```tsx
{operations?.length > 0 && (
  <OperationPanel
    operations={operations}
    onTrigger={handleOperation}
    disabled={sending || status !== "in_progress"}
  />
)}
```

- [ ] **Step 3: Add operation result display area**

After the message list, add:

```tsx
{operationResult && (
  <div className="mx-4 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
    <div className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1">查体结果</div>
    <pre className="text-sm whitespace-pre-wrap font-mono">{operationResult.result}</pre>
  </div>
)}
```

- [ ] **Step 4: Run frontend lint**

```bash
cd frontend && npx biome check src/components/OperationPanel.tsx src/pages/ChatTraining.tsx --write
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/OperationPanel.tsx frontend/src/pages/ChatTraining.tsx
git commit -m "feat: add operation panel and dual-channel display to ChatTraining"
```

---

## P3: Future Work (Outline)

### Task 14: Dynamic event triggers
- Create `backend/services/event_engine.py` — random event selection based on case context + elapsed rounds
- Events: 患者疼痛加重, 家属进入, 患者反问, 拒绝回答
- Inject event context into Author's Note, no separate LLM call
- Frontend: event notification banner

### Task 15: Nursing documentation
- Create `frontend/src/components/NursingDocPanel.tsx` — editable nursing record form
- Backend: save/load doc entries as Message with role="documentation"
- Scoring: add documentation completeness check in scoring.py
- Enable/disable via SessionConfig feature flag

### Task 16: Frontend SessionConfig selector
- Add config picker dropdown at session start (`/cases` → case list → start dialog)
- Load config list from `GET /api/session-configs`
- Pass `config_id` to `POST /api/training/start`

---

## Dependency Order

```
Task  1 (guard reduction)
  ↓
Task  2 (Case JSON personality)
  ↓
Task  3 (prompt restructure)
  ↓
Task  4 (prompt builder update)    Task  6 (SessionConfig JSON)
  ↓                                 ↓
Task  5 (chat pipeline update)     Task  7 (config migration)
  ↓                                 ↓
  ├── Task  8 (config API + audit)
  ↓
Task  9 (emotion engine port)
  ↓
Task 10 (emotion integration)
  ↓
Task 11 (exam handler)
  ↓
Task 12 (operation in chat)
  ↓
Task 13 (frontend operation panel)

Tasks 14-16: depend on all P0-P2 completion
```
