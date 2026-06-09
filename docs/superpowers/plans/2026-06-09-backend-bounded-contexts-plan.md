# Backend Bounded Contexts — Implementation Plan

**Date:** 2026-06-09
**Branch:** `refactor/backend-bounded-contexts`
**Spec:** `docs/superpowers/specs/2026-06-08-backend-bounded-contexts-design.md`

---

## Phase 0: Prerequisites (settlement V1 removal)

### 0.1 Delete V1 settlement dead code
- [ ] Delete `backend/services/training/settlement.py` (171 lines)
- [ ] Verify `backend/services/training/__init__.py` does not export `settlement.py`
- [ ] Verify `backend/main.py` lifespan only imports `settlement_v2`

### 0.2 Verify infrastructure wiring
- [ ] Confirm `LLMClient` is instantiated in `main.py` lifespan
- [ ] Confirm `TaskQueue` is started/stopped in lifespan
- [ ] Confirm `EmotionCache` / `InitiativeCache` are on `app.state`
- [ ] Confirm `settlement_v2` uses injected caches (not private module variables)

---

## Phase 1: Patient context extraction (lowest risk)

### 1.1 Create target directory and move files
- [ ] Create `backend/contexts/patient/` directory
- [ ] Move `services/patient_ai/emotion_engine.py` → `contexts/patient/emotion.py`
- [ ] Move `services/patient_ai/patient_initiative.py` → `contexts/patient/initiative.py`
- [ ] Move `services/patient_ai/patient_guard.py` → `contexts/patient/guard.py`
- [ ] Move `services/patient_ai/exam_handler.py` → `contexts/patient/exam.py`
- [ ] Move `services/patient_ai/virtual_patient_prompt.py` → `contexts/patient/prompt.py`

### 1.2 Fix internal imports
- [ ] Update `contexts/patient/__init__.py` to use new relative paths
- [ ] Verify all 16+ exported functions still work

### 1.3 Update all consumers (the 13 import sites)
- [ ] Create `contexts/training/_patient.py` adapter stub (temporary, will be used by phase 2)
- [ ] Update `services/pipeline/middleware/prompt_builder.py` → import from `contexts.patient`
- [ ] Update `services/pipeline/middleware/llm_caller.py` → import from `contexts.patient`
- [ ] Update `services/pipeline/middleware/operation_detector.py` → import from `contexts.patient`
- [ ] Update `services/pipeline/middleware/operation_executor.py` → import from `contexts.patient`
- [ ] Update `services/pipeline/middleware/side_effects.py` → import from `contexts.patient`
- [ ] Update `routers/training/phases.py` → import from `contexts.patient`
- [ ] Update `routers/training/scoring.py` → import from `contexts.patient`
- [ ] Update `routers/cases.py` → `contexts.patient.prompt.format_case_for_prompt`
- [ ] If settlement V2 imports patient directly, update
- [ ] Delete `services/patient_ai/` directory

### 1.4 Test
- [ ] Run `pytest backend/tests/test_virtual_patient_prompt.py -v`
- [ ] Run `pytest backend/tests/test_pipeline_integration.py -v`
- [ ] Run `pytest backend/tests/test_training.py -v`

---

## Phase 2: Training context extraction (highest risk)

### 2.1 Create target directory
- [ ] Create `backend/contexts/training/` and all subdirectories:
  - `router/`, `service/`, `pipeline/`, `pipeline/middleware/`

### 2.2 Move pipeline (15 files, simplest)
- [ ] Move `services/pipeline/context.py` → `contexts/training/pipeline/context.py`
- [ ] Move `services/pipeline/phase.py` → `contexts/training/pipeline/phase.py`
- [ ] Move `services/pipeline/registry.py` → `contexts/training/pipeline/registry.py`
- [ ] Move `services/pipeline/runner.py` → `contexts/training/pipeline/runner.py`
- [ ] Move `services/pipeline/__init__.py` → `contexts/training/pipeline/__init__.py`
- [ ] Move all 8 middleware files to `contexts/training/pipeline/middleware/`
- [ ] Fix all internal imports in pipeline files (should be relative within context)
- [ ] Update `PipelineContext` to accept typed dependencies instead of `app_state: Any`

### 2.3 Move scoring engine
- [ ] Merge `services/scoring/engine.py` + `rubric.py` + `validation.py` → `contexts/training/service/scoring.py`
- [ ] Keep internal function boundaries; just co-locate
- [ ] Update imports within the merged file
- [ ] Delete `services/scoring/` directory

### 2.4 Move session/settlement
- [ ] Move `services/training/session.py` → `contexts/training/service/session.py`
- [ ] Move `services/training/settlement_v2.py` → `contexts/training/service/settlement.py`
- [ ] Rewrite imports to use `contexts.training.service.scoring` for `evaluate_training`
- [ ] Delete `services/training/` directory

### 2.5 Split base.py into focused router files
- [ ] Extract `start_training` + `get_session_configs` → `contexts/training/router/session.py`
- [ ] Extract `get_records` + `get_record_detail` + `get_session_configs` → `contexts/training/router/browse.py` (merge `config.py` here)
- [ ] Extract `delete_record` → `contexts/training/router/session.py`
- [ ] Extract `get_score_review` + `submit_score_review` → `contexts/training/router/scoring.py`
- [ ] Remove module-level globals: `_scoring_pending`, `_infra_*`, `_main_loop`, `_schedule_background`
- [ ] Replace `_schedule_background` with `TaskQueue.enqueue()` in scoring endpoints
- [ ] Replace `_try_acquire_scoring` / `_release_scoring` with TaskQueue internal capacity

### 2.6 Move remaining routers
- [ ] Move `routers/chat.py` → `contexts/training/router/chat.py`
- [ ] Update `_build_context` to use typed `app_state` fields
- [ ] Move `routers/nursing_records.py` → `contexts/training/router/nursing.py`
- [ ] Move `routers/training/phases.py` → `contexts/training/router/progress.py`
- [ ] Move `routers/training/scoring.py` → merge with router/scoring.py
- [ ] Delete `routers/training/` directory

### 2.7 Create patient adapter
- [ ] Implement `contexts/training/_patient.py` — wrapper around all 13 patient context calls
- [ ] Replace all scattered `contexts.patient.xxx` imports in training with `_patient.xxx`

### 2.8 Test
- [ ] Run `pytest backend/tests/test_scoring.py -v`
- [ ] Run `pytest backend/tests/test_pipeline_phase.py -v`
- [ ] Run `pytest backend/tests/test_pipeline_integration.py -v`
- [ ] Run `pytest backend/tests/test_training.py -v`
- [ ] Run `pytest backend/tests/test_auto_settlement.py -v`

---

## Phase 3: QA context extraction (simple)

### 3.1 Merge routers + services
- [ ] Create `backend/contexts/qa/` directory
- [ ] Merge `routers/qa/messages.py` + `routers/qa/sessions.py` → `contexts/qa/api.py`
- [ ] Merge `services/qa/cache.py` + `services/qa/__init__.py` → `contexts/qa/logic.py`
- [ ] Create `contexts/qa/__init__.py` exporting qa_router
- [ ] Delete `routers/qa/` and `services/qa/` directories

### 3.2 Test
- [ ] Run `pytest backend/tests/test_qa.py -v`

---

## Phase 4: Wiring and cleanup

### 4.1 Update main.py
- [ ] Update router registration: `from contexts.training import training_router`
- [ ] Update router registration: `from contexts.qa import qa_router`
- [ ] Update infrastructure import paths for any moved dependencies
- [ ] Verify lifespan initialisation order unchanged

### 4.2 Update remaining references across codebase
- [ ] `backend/routers/__init__.py` (if applicable)
- [ ] Any remaining `from services.patient_ai` or `from services.pipeline` imports
- [ ] `backend/services/prompt/` references to moved modules
- [ ] `backend/core/dependencies.py` — update Depends factories paths

### 4.3 Create infrastructure re-exports
- [ ] `backend/infrastructure/__init__.py`: export `LLMClient`, `TaskQueue`, `EmotionCache`, `InitiativeCache`

### 4.4 Full test pass
- [ ] Run `pytest backend/tests/ -v` and fix all failures
- [ ] Run `pytest backend/tests/test_cache_infrastructure.py -v`
- [ ] Run `pytest backend/tests/test_task_queue.py -v`
- [ ] Run `pytest backend/tests/test_llm_client.py -v`
- [ ] Run `pytest backend/tests/test_llm_circuit.py -v`
- [ ] Run `pytest backend/tests/test_questionnaires.py -v`
- [ ] Run `pytest backend/tests/test_security.py -v`
- [ ] Run `pytest backend/tests/test_feature_flags.py -v`

### 4.5 Lint check
- [ ] Ensure no dead imports remain (`from services.patient_ai`, `from services.pipeline`, `from services.scoring`)
- [ ] Verify no cross-context import violations (patient → training, qa → training)
- [ ] Verify all `_` prefixed modules are not re-exported

---

## Phase 5: API standardisation (transport envelope)

### 5.1 Backend: Envelope middleware
- [ ] Create `backend/core/envelope.py` — `EnvelopeMiddleware` class
- [ ] Wraps JSON responses in `{code: 0, data: ..., message: "success"}`
- [ ] Skips streaming responses (SSE, CSV) and non-JSON responses
- [ ] Maps `HTTPException` / `AppError` to `{code: N, data: null, message: "..."}`

### 5.2 Backend: Error codes
- [ ] Create `backend/core/error_codes.py` — `ErrorCode(IntEnum)` with 5 code ranges
- [ ] Update `AppError` in `core/exceptions.py` to carry `code: ErrorCode`
- [ ] Replace `raise HTTPException(status_code=404, detail="...")` → `raise AppError(code=ErrorCode.xxx, detail="...")` in all routers

### 5.3 Backend: URL standardisation
- [ ] Rename `PUT /training/{id}/config/features` → `PUT /training/{id}/features`
- [ ] Rename `GET /admin/users/{id}/detail` → `GET /admin/users/{id}`
- [ ] Unify questionnaire questions: nested URLs only (`/templates/{tid}/questions/{qid}`)
- [ ] Legacy aliases: mark deprecated with `@router.post("/ask", deprecated=True)`

### 5.4 Backend: Delete response unification
- [ ] Create `DeleteResponse` model in `schemas.py`
- [ ] Replace `MessageResponse` / `OkResponse` on DELETE endpoints with `DeleteResponse`

### 5.5 Backend: Fix raw dict returns + missing response_model
- [ ] `training/config.py` PUT: add `response_model` + return Pydantic instance
- [ ] `training/phases.py` 3 endpoints: return Pydantic instance, not raw dict
- [ ] `training/scoring.py` 2 endpoints: return Pydantic instance, not raw dict

### 5.6 Frontend: Axios envelope unwrapping
- [ ] Add `ApiError` class in `frontend/src/api/api-client.ts`
- [ ] Add response interceptor that unwraps `{code, data, message}` format
- [ ] `code === 0` → `response.data = body.data`; else → `reject(new ApiError(code, message))`

### 5.7 Miniprogram: wx.request wrapper unwrapping
- [ ] Add envelope detection + unwrapping in `miniprogram/api/client.ts`
- [ ] Same logic: strip envelope on success, reject on error code

### 5.8 Regenerate OpenAPI and frontend types
- [ ] Run `npm run api:update:all` to regenerate `openapi.json` + `api-types.gen.ts`
- [ ] Verify generated types unchanged (envelope stripped by interceptor, not in schema)

### 5.9 Test
- [ ] Run full backend test suite
- [ ] Verify frontend builds without type errors
- [ ] Verify miniprogram compiles

---

## Estimated Effort

| Phase | Description | Risk | Effort |
|-------|-------------|------|--------|
| 0 | Settlement V1 removal | Low | 0.5 day |
| 1 | Patient context extraction | Low-Medium | 1 day |
| 2 | Training context extraction | High | 2-3 days |
| 3 | QA context extraction | Low | 0.5 day |
| 4 | Wiring and cleanup | Medium | 1 day |
| 5 | API standardisation | Medium | 1.5 days |
| **Total** | | | **6.5-8 days** |

---

## Rollback

All changes on `refactor/backend-bounded-contexts` branch. `master` remains untouched.
Rollback is `git checkout master`.
