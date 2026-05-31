# AI-Assisted Case Generation Design

## Overview

Allow teachers to generate nursing case data via AI from short descriptions or reference materials, fully integrated into the existing case editor. A new `case_generation` AI purpose type flows through the unified LLM infrastructure (routing, logging, prompt management).

## Architecture

```
UI: CasesTab.jsx (existing case list + editor modal)
  ├── "AI 生成病例" button → opens editor with AI panel expanded
  ├── AI panel (collapsible, inside editor modal)
  │   ├── Mode toggle: 快速生成 / 参考资料生成
  │   ├── Description input
  │   ├── Reference case selector + free-text area (reference mode only)
  │   └── "生成" button → POST /api/cases/generate → populate form
  └── Per-field AI buttons (sparkle icon) on:
      scoring_criteria, hidden_info, required_inquiries

API: POST /api/cases/generate (teacher only)
  └── llm_service.call_llm_json() with purpose="case_generation"
      └── PromptManager.get("case_generation") for template
      └── LLMRouter.select_key("case_generation") for API key
      └── llm_logging.enqueue_log() for monitoring/audit
```

## Backend Changes

### 1. New Endpoint: `POST /api/cases/generate`

**Router**: `backend/routers/cases.py` (teacher-only, alongside create/update/delete)

**Request** (`CaseGenerateRequest`):
```json
{
  "mode": "quick | reference",
  "description": "用户输入描述",
  "reference_case_ids": [1, 2],
  "reference_text": "自由文本参考资料",
  "field": null | "scoring_criteria" | "hidden_info" | "required_inquiries",
  "current_case_data": {}
}
```

- `mode`: "quick" uses only description; "reference" also includes referenced cases + free text
- `field`: null = full case generation; a value = per-field generation
- `current_case_data`: partial case data for context (used in per-field mode)

**Response** (`CaseGenerateResponse`):
```json
{
  "case_data": { "name": "...", "patient_info": {...}, ... },
  "field_value": null | {}
}
```

**Implementation flow:**
1. Validate request (description required, reference cases exist if IDs given)
2. Load referenced cases from DB if reference mode
3. Build `reference_material` string from case data + free text
4. Get prompt template via `prompt_manager.get("case_generation")`
5. Render system prompt with `description` and `reference_material` vars
6. Build messages: `[{role: "system", content: rendered_prompt}]`
7. Call `call_llm_json(messages, temperature=0.3, max_tokens=4096, timeout=120, max_retries=3, purpose="case_generation", user_id=current_user.id)`
8. Parse result: if `field` is null, validate full case_data structure; if set, extract field-specific value
9. Return response

### 2. Prompt Manager Integration

**`backend/services/prompt_manager.py`:**
- Add `case_generation` to `_upsert_v1_defaults` with v1 default system prompt (no user_prompt)
- Add `case_generation` branch to `_hardcoded_fallback`

**`backend/prompt_static.py`:**
- Add `case_generation` sample vars in `get_sample_vars()` with realistic sample description and reference_material

### 3. Hardcoded v1 Default Prompt

The system prompt instructs the LLM to generate a complete nursing case as valid JSON following the exact project schema (patient_info, chief_complaint, opening_line, present_illness, past_history, medication_history, allergy_history, family_history, social_history, communication_style, hidden_info, hidden_info_rules, required_inquiries, scoring_criteria). Includes:
- Clinical realism guidelines
- {#description#} variable for user input
- {#reference_material#} variable for reference content
- Strict JSON output requirement (no markdown fences)
- Placeholder defaults for scoring_criteria (standard nursing history rubric structure)

### 4. Frontend Changes

**`frontend/src/api.js`:**
- Add `generateCase(data)` → `POST /api/cases/generate`

**`frontend/src/components/teacher/CasesTab.jsx`:**
- Add `showAiPanel` state, `aiGenerating` state, `aiMode` state
- Add "AI 生成病例" button alongside "添加病例" button
- Add AI panel section at the top of the editor modal:
  - Collapsible (expanded when `showAiPanel` is true)
  - Mode switch: two styled toggle buttons (快速生成 / 参考资料)
  - Quick mode: single textarea for description
  - Reference mode: description textarea + case multi-select + free-text textarea
  - "生成病例" button (shows spinner while generating)
  - Error display on failure
  - On success: auto-populate all form fields, scroll to form
- Add per-field AI buttons (sparkle/Sparkles icon) on:
  - `scoring_criteria` textarea: generates based on current case context
  - `hidden_info` textarea: generates based on current case context
  - `required_inquiries` textarea: generates based on current case context
- When opening editor via "AI 生成": set `showAiPanel = true`
- When opening editor via "添加病例" or edit: set `showAiPanel = false`

**`frontend/src/components/teacher/PromptManagementTab.jsx`:**
- Add `"case_generation"` to `PURPOSES` array
- Add `case_generation: "病例生成"` to `PURPOSE_LABELS`

**`frontend/src/components/teacher/MonitorTab.jsx`:**
- Add `case_generation: "病例生成"` to `PURPOSE_LABELS`

## Interaction Flow

1. Teacher sees case list with two buttons: "添加病例" and "AI 生成病例"
2. Clicks "AI 生成病例" → editor modal opens with AI panel expanded at top
3. AI panel shows two modes:
   - **快速生成**: type a short description (e.g. "糖尿病足溃疡老年患者") → click 生成
   - **参考资料**: type description + optionally select existing cases as templates + paste clinical reference notes → click 生成
4. Generation runs (2-15s), spinner shows, form is disabled
5. Result auto-fills all form fields
6. Teacher reviews, can edit any field manually or use per-field AI buttons to regenerate specific sections
7. Teacher clicks "创建病例" to save
8. Future edit: AI panel starts collapsed but can be expanded; can re-generate (overwrites current form)

## Edge Cases

| Case | Handling |
|---|---|
| Description is empty | Client-side validation, show inline error |
| Generation fails (network/LLM error) | Toast error message, form stays editable, AI panel stays open for retry |
| LLM returns invalid JSON | `_safe_parse_json` handles common issues; on total failure, toast error + raw response shown for debugging |
| Generated case missing fields | Pass through as-is; teacher can manually fill gaps |
| Reference case IDs don't exist | Backend returns 404 for missing cases before calling LLM |
| No API key for `case_generation` | LLMRouter falls back to wildcard `*` keys; if none, returns error as usual |
| Very long reference text (10000+ chars) | Truncate to safe length in backend before prompt rendering |

## Scope Boundaries

**Included:**
- Full case generation (quick + reference modes)
- Per-field AI assist for scoring_criteria, hidden_info, required_inquiries
- Prompt management integration (create, edit, activate, preview)
- LLM monitoring integration (logs, stats)

**Excluded:**
- Streaming generation (non-streaming only, consistent with scoring)
- Multi-turn refinement chat (user provides input once, regenerates if needed)
- Auto-save or background generation
- Bulk case generation
- Image/document upload as reference (text only)
