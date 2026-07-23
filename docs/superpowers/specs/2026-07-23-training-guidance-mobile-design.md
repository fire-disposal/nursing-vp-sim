# 训练页引导与移动端体验优化 — 设计文档

**日期**: 2026-07-23
**触发**: 学生反馈 —「系统不兼容手机端？训练指引性不强，不知道要干什么。总感觉问诊要记录点什么，但唯一像记录的选项点进去又加载不出来」

## 范围

仅训练页（/training/:recordId）及其工具生态。管理后台、其他学生端页面不在本次范围。

## 任务 1 — 护理记录工具：评分恢复 + 健壮性

### 后端评分恢复（精确回滚 e94d7701 的禁用部分）

1. `backend/contexts/training/rubric_builder.py`
   - 取消注释：`features.nursing_record` 为真时，深拷贝 base rubric 并追加 `_NURSING_RECORD_DIMENSION`（15 分，5 条目 nr_01–nr_05，ADPIE），`raw_max += 15`（57→72），幂等（已存在则不重复追加）。
   - 百分制映射（`core/score_mapping.py`）按 raw_max 归一，自动适配，无需改动。
2. `backend/contexts/training/score_engine.py`
   - `evaluate_training`（持有 db）加载 `NursingRecord.sheet_data`，格式化 `SUBJECTIVE: …\n\nOBJECTIVE: …` 文本，作为参数传入 `_build_history_messages`。
   - `_build_history_messages`：文本非空时 append 到 `scoring_criteria_text`（`## 学生提交的护理评估记录` 节），恢复 e94d7701 之前的行为。criteria/JSON schema 由 rubric 自动生成，新维度自动进入评分 prompt 与校验。
3. 生效范围：仅新开始的训练记录（rubric_snapshot 在会话开始时固化）；进行中记录按旧快照评分——既有架构，不改。
4. 测试翻转（移除 [DISABLED] 语义）：
   - `backend/tests/scoring/test_rubric_builder.py`：断言开启时维度被追加、raw_max +15、幂等。
   - `backend/tests/training/test_snapshot_isolation.py`：断言开启时 rubric_snapshot 含护理维度。

### 前端工具健壮性（修「加载不出来」）

`NursingRecordTool.tsx` 目前仅在 `payload.ok` 时 `setLoading(false)` — WS 断连（无 tool:result）或 `ok=false`（未启用/无权限）会永远转圈，即学生反馈的现象。

- `ok=false` → 错误态：显示后端 error 文案 + 「重试」按钮。
- 8 秒未收到 `tool:result`（load）→ 超时错误态（提示实时连接中断/检查网络）+ 「重试」。
- 保存失败（`save` + `ok=false`）→ `saveStatus="error"`（现有状态机已预留）。

## 任务 2 — 问诊进度（v0 InquirySidebar 以 tool 形态重生）

v0 来源：`0cc1d661:frontend/src/pages/ChatTraining.jsx` 的 `InquirySidebar`（顶栏 covered/total 徽章 + 进度条 + bigram 匹配）。与情绪栏**共用一条状态栏**，不新增独立栏。

1. **共享匹配逻辑** `frontend/src/components/training/tools/inquiryProgress.ts`（纯函数）：
   - `extractKeywords(inquiry)`：去括号内容 → 滑动窗口取全部 2 字 token（v0 bigram 算法）。
   - `getInquiryLabel(inquiry)`：去括号内容，截断展示。
   - `computeCovered(inquiries, studentTexts)`：任一大词条命中学生全部发言拼接文本 → 该项覆盖。
2. **InquiryProgressChip**（新组件）：`📋 n/N` + 桌面端迷你进度条（红 <40% / 琥珀 <80% / 绿 ≥80%，阈值沿用 v0）；点击 → `bus.emit("tool:open", { id: "inquiry" })`。
3. **EmotionIndicator** 增加 `trailing?: ReactNode` 插槽（compact 与完整布局均渲染）；ChatArea 在 inquiries 非空时注入 chip。
4. **SceneRenderer / SceneToolbar** 监听 `tool:open` → `setActiveId(id)`（桌面端展开 docked panel，移动端弹 Bottomsheet）。
5. **InquiryTool 升级**：接入共享匹配逻辑；顶部进度条（v0 配色阈值）+ `n/N` 计数；已覆盖项划线置灰；底部保留「关键词自动匹配，仅供参考」提示。
6. 数据来源不变：`recordDetail.case_data.required_inquiries`（现有链路）。

## 任务 3 — 移动端训练页体验

1. **视口高度**：`HistoryTakingScene` / `TriageScene` / `TrainingEngine` 加载与错误态的 `h-screen` → `h-dvh`（修复移动浏览器地址栏裁切底部输入区）。
2. **工具可发现性**：`SceneToolbar` 移除 `hidden sm:inline`，移动端图标旁始终显示文字标签（患者信息/问诊指引/护理记录…）。
3. **流程引导**：`WelcomeScreen` 增加 4 步流程条 — ① 问诊采集 → ② 护理查体 → ③ 填写护理记录 → ④ 结束训练评分；②③按 capabilities（physical_exam / nursing_record）条件显示；底部注明「对话过程中可随时通过下方工具栏打开工具」。

## 验证

- 后端：`uv run pytest tests/scoring/test_rubric_builder.py tests/training/test_snapshot_isolation.py -x -q` + `ruff check` + `ty check`
- 前端：`npx tsc --noEmit` + `npx biome check`（staged 范围由 lint-staged 兜底）
- 手动路径：开启 nursing_record 的病例 → 训练页打开护理记录（成功/失败/超时三态）→ 问诊进度 chip 点击打开指引 → 移动端宽度下标签可见、底部输入不被裁切。
