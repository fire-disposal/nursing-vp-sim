# 02 — API接口文档

> 适用版本: v2026.06.12 | 最后更新: 2026-06-12

Base URL: `http://localhost:8000/api`

所有接口（除登录/注册/健康检查外）需在Header中携带 `Authorization: Bearer <token>`

**响应信封**: 所有响应统一包装为 `{"code": 0, "data": ..., "message": "success"}`，`code=0` 成功，非0失败。前端拦截器自动解包 `data`。

**速率限制**:
| 接口 | 限制 | 超限响应 |
|------|------|----------|
| POST /auth/login | 同一IP 5分钟10次 | 429 "登录尝试过于频繁，请 15 分钟后再试" |
| POST /auth/register | 同一IP 每分钟5次 | 429 "注册请求过于频繁，请稍后再试" |
| POST /chat/{id}/message (含stream) | 同一用户 每分钟6条 | 429 "消息发送过于频繁，请稍后再试" |
| POST /qa/sessions (含追问) | 同一用户 每分钟5次 | 429 "提问过于频繁，请稍后再试" |

---

## 认证模块 `/auth`

### POST /auth/login — 密码登录
```
Request:  { username, password }
Response: { access_token, token_type, role, display_name, user_id, school_id, school_name, permissions, gender, avatar }
```
权限：公开

### POST /auth/register — 注册新用户（需 user_manage 权限）
```
Request:  { username, password, role, display_name, student_id?, gender?, class_id? }
Response: { access_token, token_type, role, display_name, user_id, school_id, school_name }
```
权限：user_manage

### POST /auth/wechat/login — 微信小程序 code 登录
```
Request:  { code }
Response: { need_bind: true }  (首次登录，需绑定)
      或  { access_token, role, display_name, user_id, school_id, school_name, permissions }
```
权限：公开

### POST /auth/wechat/bind — 绑定微信 openid 到已登录用户
```
Request:  { code }
Response: { ok: true, message: "微信绑定成功" }
```
权限：登录（不可重复绑定）

### POST /auth/wechat/register — 微信注册新用户
```
Request:  { code, display_name }
Response: { access_token, role, display_name, user_id, school_id, school_name }
```
权限：公开

### GET /auth/me — 获取当前用户信息
```
Response: { id, username, role, role_display_name, display_name, student_id, gender, avatar, class_id, class_name, grade_name, created_at }
```
权限：登录

### PUT /auth/me — 更新个人资料
```
Request:  { display_name?, student_id?, gender?, avatar? }
Response: UserBrief
```
权限：登录

### POST /auth/refresh — 刷新 token（支持过期 token）
```
Response: { access_token, role, display_name, user_id, school_id, school_name, permissions }
```
权限：登录（允许过期 token）

### PUT /auth/change-password — 修改密码
```
Request:  { old_password, new_password }
Response: { ok: true }
```
权限：登录

### POST /auth/logout — 登出（token_version +1，旧 token 失效）
```
Response: { ok: true }
```
权限：登录

---

## 病例模块 `/cases`

### GET /cases — 获取公开病例列表（分页）
```
Query:  ?offset=0&limit=50&school_id=
Response: PaginatedResponse<{ id, name, difficulty, description, patient_summary }>
```
- `difficulty`: 1=初级, 2=中级, 3=高级
权限：登录

### GET /cases/manage/list — 教师病例管理列表（分页）
```
Query:  ?offset=0&limit=50&name=&difficulty=&school_id=
Response: PaginatedResponse<{ id, name, description, patient_name, patient_age, patient_gender, chief_complaint, time_limit, difficulty, patient_personality, created_at, training_count }>
```
- 支持 name 模糊搜索、difficulty 筛选
权限：case_manage

### POST /cases/generate — AI 生成病例
```
Request:  { description, mode, reference_case_ids?, reference_text?, field?, current_case_data? }
Response: { case_data? } 或 { field_value?, field? }
```
- mode="reference" 时按参考病例或文本生成
- 指定 field 时仅生成单字段子任务
权限：case_manage

### GET /cases/{case_id}/practices — 获取病例下的练习模板
```
Response: [{ id, name, description, mode, is_active }]
```
权限：登录

### GET /cases/{case_id} — 获取病例详情（完整 case_data）
```
Response: { id, name, description, case_data }
```
权限：登录

### POST /cases — 创建新病例
```
Request:  { case_data: { name, time_limit?, description?, patient_info?, chief_complaint?, opening_line?, difficulty?, personality?, deep_background?, exam_anchors?, example_dialogues?, ... } }
Response: CaseManageItem
```
权限：case_manage

### PUT /cases/{case_id} — 编辑病例
```
Request:  { case_data }
Response: CaseManageItem
```
权限：case_manage

### DELETE /cases/{case_id} — 删除病例
```
Response: { message: "病例已删除" }
```
仅当无训练记录时允许，否则返回 400
权限：case_manage

---

## 训练模块 `/training`

### POST /training/start — 开始训练
```
Request:  { case_id, practice_id? }
Response: { record_id, greeting, case_name }
```
- `practice_id` 可选，指定练习模板；不传则使用病例默认 active 模板
- 创建训练记录，状态 in_progress，返回虚拟患者开场问候
权限：training_access（学生）

### POST /training/start-from-assignment — 从作业入口开始训练
```
Query:  ?assignment_id=<uuid>
Response: { record_id, greeting, case_name }
```
- 校验用户是否在目标班级中
- 已有空记录（无学生消息）则复用，否则新建
- 若截止时间已过则标记 is_overdue
权限：training_access（学生）

### GET /training/configs — 获取可用训练配置列表
```
Response: [{ id, name, mode, features, behavior, assessment }]
```
权限：公开（登录）

### GET /training/records — 训练记录列表（分页）
```
Query:  ?limit=50&offset=0&student_name=&case_id=&status=&date_from=&date_to=&class_id=&school_id=
Response: PaginatedResponse<{ id, case_id, case_name, user_display_name, user_student_id, status, current_phase, start_time, end_time, score_total, scoring_status, scoring_error }>
```
- 学生看自己的，有 score_review 权限看全部
- 教师可过滤：student_name（模糊）、case_id、status、date_from/date_to、class_id
权限：登录

### GET /training/records/{record_id} — 单条训练记录详情
```
Response: { id, case_id, case_name, user_display_name, status, current_phase, scoring_status, scoring_error, start_time, end_time, time_limit, remaining_seconds?, messages, score, notes, required_inquiries, patient_info, features, from_assignment }
```
- 含完整对话、评分、笔记、病例时限、必问清单、功能开关
- 进行中的训练返回 remaining_seconds
权限：学生（仅自己）/ 有 score_review 权限

### DELETE /training/records/{record_id} — 删除训练记录（级联删除消息/评分/笔记/护理记录/LLM日志）
```
Response: { message: "训练记录已删除" }
```
权限：学生（仅自己）/ 有 score_review 权限

### GET /training/records/{record_id}/review — 获取评分复核信息
```
Response: { score_id, review_status, reviewed_by_name, reviewed_at, original_detail_scores, review_detail_scores, review_comment }
```
权限：学生（仅自己）/ 有 score_review 权限

### POST /training/records/{record_id}/review — 提交评分复核
```
Request:  { detail_scores?, comment? }
Response: { score_id, review_status: "reviewed", reviewed_by_name, reviewed_at, original_detail_scores, review_detail_scores, review_comment }
```
- 教师可逐项修改评分 + 添加复核备注
- 不可重复复核（已复核返回 409）
- 提交后自动更新 score.total_score
权限：score_review（教师）

### GET /training/{record_id}/scoring-status — 获取评分状态
```
Response: { scoring_status, scoring_error, score? }
```
权限：学生（仅自己）/ 有 score_review 权限

### POST /training/{record_id}/end — 结束训练并触发后台评分
```
Response: { message, record_id, scoring_status: "pending" }
```
- 状态改为 completed，记录 end_time
- 后台异步评分（含 rubric 评分标准）
- scoring_status: pending → processing → completed/failed
- 通过 GET /training/{record_id}/scoring-status 轮询
权限：学生（仅自己）

### POST /training/{record_id}/retry-scoring — 重新触发评分
```
Response: { message, record_id, scoring_status: "pending" }
```
- 重新触发已失败或已完成的评分
- 要求 status=completed 且 scoring_status 不在 pending/processing
- 若 processing 超过5分钟自动视为 failed
权限：学生（仅自己）/ 有 score_review 权限

### PUT /training/{record_id}/features — 更新训练功能开关
```
Request:  { emotion: true, patient_initiative: true, ... }
Response: { ok: true, features }
```
权限：学生（仅自己）/ 有 score_review 权限

### POST /training/{record_id}/advance-phase — 手动推进训练阶段
```
Response: { current_phase, name, order }
```
- 从问诊阶段推进到护理/评估阶段
权限：学生（仅自己，仅进行中）

### GET /training/{record_id}/state — 获取训练状态（调试用）
```
Response: { record_id, case_id, emotion, personality, deep_background_keys, exam_anchors, config, initiative, current_phase, feature_flags }
```
- 含情感缓存、人格、深层背景、检查锚点等实时状态
权限：学生（仅自己）/ 有 score_review 权限

### POST /training/{record_id}/initiative/trigger — 触发患者主动发言
```
Response: { triggered: bool, message?, id? }
```
- 需 patient_initiative 功能开关开启
权限：学生（仅自己）/ 有 score_review 权限

### GET /training/{record_id}/emotion/history — 情感变化历史
```
Response: { history: [...] }
```
权限：学生（仅自己）/ 有 score_review 权限

### GET /training/{record_id}/initiative/history — 患者主动发言历史
```
Response: { history: [{ id, content, created_at }] }
```
权限：学生（仅自己）/ 有 score_review 权限

### POST /training/{record_id}/exam/{op_type} — 执行检查操作
```
Response: { type, data: { label, value, unit }, all_results }
```
- op_type 如 temperature、blood_pressure、pulse、inspection 等
- 结果存入 practice_snapshot._exam_results，生成 system 消息
权限：学生（仅自己，仅进行中）

---

## 对话模块 `/chat`

### POST /chat/{record_id}/message — 发送消息（同步）
```
Request:  { content }
Response: { role: "patient", content, operation? }
```
- 保存学生消息 → 构建LLM上下文 → 调用LLM → 保存患者回复
- 返回 operation 字段指示触发的前端动作
权限：学生（仅自己训练，仅进行中）

### POST /chat/{record_id}/message/stream — 发送消息（SSE流式）
```
Request:  { content }
Response: text/event-stream (data: {content} ... data: [DONE])
```
- 流式返回患者回复，含情感标签 `<emotion:xxx>`
权限：学生（仅自己训练，仅进行中）

---

## 护理记录模块

### GET /nursing-records/{record_id} — 获取护理记录
```
Response: { id, record_id, sheet_data, status, updated_at }
```
- 无记录时返回 id=0, status="not_found", sheet_data={}
权限：学生（仅自己）/ 有 score_review 权限

### POST /nursing-records/{record_id} — 保存护理记录
```
Request:  { sheet_data, status? }
Response: { id, record_id, sheet_data, status, updated_at }
```
- 存在则更新，不存在则创建（status 默认 "draft"）
权限：登录

---

## 笔记模块 `/notes`

### GET /notes/{record_id} — 获取笔记列表
```
Response: [{ id, content, created_at, updated_at }]
```
权限：学生（自己）/ 有 record_notes 权限

### POST /notes/{record_id} — 保存笔记
```
Request:  { content }
Response: { id, content, created_at, updated_at }
```
权限：学生（仅自己，仅进行中）

### PUT /notes/{note_id} — 更新笔记
```
Request:  { content }
Response: NoteItem
```
权限：学生（仅自己）

### DELETE /notes/{note_id} — 删除笔记
```
Response: { message: "笔记已删除" }
```
权限：学生（仅自己）

---

## 问答模块 `/qa`

问答已改为会话模式（QASession + QARecord），每次提问创建或追加到会话。

### POST /qa/sessions — 创建问答会话并发送首问
```
Request:  { question }
Response: { session_id, answer }
```
- 自动创建 QASession，标题截取问题前40字符
- 支持缓存命中（相同问题直接返回缓存答案）
权限：登录

### POST /qa/sessions/{session_id}/ask — 在已有会话中追问
```
Request:  { question }
Response: { session_id, answer }
```
- 携带历史消息作为 LLM 上下文
权限：学生（仅自己会话）

### POST /qa/sessions/{session_id}/ask/stream — 流式追问
```
Request:  { question }
Response: text/event-stream
```
权限：学生（仅自己会话）

### GET /qa/sessions — 我的会话列表
```
Response: [{ id, title, created_at, updated_at }]
```
权限：登录

### DELETE /qa/sessions/{session_id} — 删除会话（级联删除消息）
```
Response: { message: "删除成功" }
```
权限：学生（仅自己）

### GET /qa/sessions/{session_id}/messages — 获取会话消息
```
Response: [{ id, session_id, role, content, created_at }]
```
权限：学生（仅自己）

### GET /qa/history/all — 教师查看全部问答历史（分页）
```
Query:  ?limit=20&offset=0&school_id=
Response: PaginatedResponse<{ id, user_id, student_name, student_code, title, message_count, created_at, updated_at }>
```
权限：stats_view

### GET /qa/history/all/{session_id}/messages — 教师查看会话消息
```
Response: [{ id, session_id, role, content, created_at }]
```
权限：stats_view

### POST /qa/ask — 旧版兼容（等同于 POST /qa/sessions）
```
Request:  { question }
Response: { session_id, answer }
```
权限：登录

---

## 练习发布模块 `/assignments`

练习发布（Assignment）的 practice_id 替代旧的 case_id，每个发布绑定一个练习模板（Practice）。

### POST /assignments — 创建练习发布
```
Request:  { practice_id, class_id, title, description, start_time, end_time }
Response: AssignmentDetail (含 students 列表)
```
权限：score_review（教师）

### GET /assignments — 我的发布列表（分页）
```
Query:  ?offset=0&limit=50&class_id=&status=active|ended
Response: PaginatedResponse<{ id, title, practice_name, class_name, start_time, end_time, student_count, completed_count, created_at }>
```
权限：score_review（教师）

### GET /assignments/{assignment_id} — 发布详情
```
Response: { id, title, description, practice_id, practice_name, class_id, class_name, start_time, end_time, student_count, completed_count, scored_count, students: [...] }
```
- students 数组含每个学生的记录状态、得分、评分状态、是否逾期
权限：发布者本人

### PUT /assignments/{assignment_id} — 编辑发布
```
Request:  { title?, description?, start_time?, end_time? }
Response: AssignmentDetail
```
权限：发布者本人

### DELETE /assignments/{assignment_id} — 删除发布
```
Response: { message: "练习发布已删除" }
```
- 仅当无学生已开始时允许删除
权限：发布者本人

### GET /assignments/{assignment_id}/export — 导出发布成绩 CSV
```
Response: CSV 文件
```
权限：发布者本人 + export_data 权限

---

## 学生练习模块 `/students/assignments`

### GET /students/assignments — 学生的练习列表
```
Response: [{ id, title, practice_name, start_time, end_time, status, record_id?, score_total? }]
```
- status: pending / in_progress / completed / overdue
- 按 end_time 降序
权限：登录（学生）

---

## 统计模块 `/stats`

### GET /stats/duration — 训练时长统计
```
Query:  ?period=week|month|all&school_id=
Response: { daily: [{ date, minutes }], total_minutes, total_sessions }
```
- 按日聚合训练时长。学生看自己，教师看全部已完成
权限：登录

### GET /stats/trends — 训练趋势
```
Query:  ?period=week|month|all&school_id=
Response: { daily: [{ date, sessions, minutes, avg_score }], total_sessions, total_minutes, avg_score }
```
- 每日汇总训练次数、时长、平均得分
权限：学生看自己 / stats_view 看全部

### GET /stats/teacher-summary — 学生汇总（分页）
```
Query:  ?offset=0&limit=50&class_id=
Response: PaginatedResponse<{ user_id, display_name, student_code, total_sessions, total_minutes }>
```
权限：stats_view

### GET /stats/ranking — 学生成绩排名（分页）
```
Query:  ?offset=0&limit=50&class_id=
Response: PaginatedResponse<{ rank, user_id, display_name, student_id, total_sessions, avg_score, total_score, total_minutes }>
```
- 按平均分降序，含 rank 序号
权限：stats_view

### GET /stats/class-summary — 班级维度统计
```
Query:  ?grade_id=&school_id=
Response: [{ class_id, class_name, grade_name, student_count, avg_score, completion_rate, total_sessions, total_minutes }]
```
权限：stats_view

---

## 导出模块 `/export`

### GET /export/records — 导出所有训练记录 CSV
```
Query:  ?school_id=
Response: CSV文件 (记录ID/学生/学号/病例/状态/时间/总分/优点/不足/漏问/建议/对话轮数)
```
权限：export_data

### GET /export/record/{record_id} — 导出单条记录详情 TXT
```
Response: 文本文件 (元信息 + 完整对话 + 评分结果)
```
权限：学生（自己）/ export_data

---

## 反馈模块

### POST /feedback — 提交用户反馈
```
Request:  { rating (1-5), tag?, content? }
Response: { id, created_at }
```
权限：登录

### GET /admin/feedback — 管理反馈列表（分页）
```
Query:  ?tag=&date_from=&date_to=&offset=0&limit=20&school_id=
Response: PaginatedResponse<{ id, user_id, user_name, rating, tag, content, created_at }>
```
权限：feedback_review

### GET /admin/feedback/stats — 反馈每日统计（堆叠柱状图数据）
```
Query:  ?date_from=&date_to=&school_id=
Response: [{ date, rating_1, rating_2, rating_3, rating_4, rating_5 }]
```
权限：feedback_review

---

## 管理模块 `/admin`

### GET /admin/users — 用户列表（分页、搜索、过滤）
```
Query:  ?offset=0&limit=50&search=&role=&class_id=&grade_id=
Response: PaginatedResponse<{ id, username, role, role_display_name, display_name, student_id, gender, avatar, created_at, class_id, class_name, grade_name }>
```
权限：user_manage

### PUT /admin/users/{user_id} — 编辑用户
```
Request:  { display_name?, student_id?, role?, password?, gender?, avatar?, class_id? }
Response: UserBrief
```
- 未填字段不修改；password 留空不修改密码；password 需 ≥6 位
- class_id=0 可移除班级
权限：user_manage

### GET /admin/users/{user_id} — 学生详情（含30天统计和最近记录）
```
Response: { id, username, role, display_name, student_id, created_at, total_sessions, total_minutes, avg_score, recent_records, daily }
```
权限：user_manage

### DELETE /admin/users/{user_id} — 删除用户
```
Response: { message: "用户已删除" }
```
- 不能删除自己；有训练记录不可删除
权限：user_manage

### POST /admin/users/batch — 批量导入用户
```
Request:  [{ username, password, display_name, role?, student_id?, class_id? }, ...]
Response: { created: N, skipped: N, errors: [...] }
```
- 密码最低6位，用户名不能重复
权限：user_manage

### GET /admin/stats — 统计概览
```
Response: { total_students, total_records, completed_records, average_score, avg_duration_min, today_records }
```
权限：stats_view

### GET /admin/llm-stats — LLM 调用统计
```
Response: { today, week, month, by_purpose, by_provider, daily }
```
- today/week/month: { count, success_rate, avg_latency_ms, total_cost }
- by_purpose: [{ purpose, count, avg_latency_ms, error_count }]
- by_provider: [{ provider, count, total_cost, error_count }]
- daily: [{ date, count, success_count, fail_count, total_cost }]
权限：llm_monitor

### GET /admin/llm-logs — LLM 调用日志列表（分页）
```
Query:  ?offset=0&limit=50&purpose=&status=&date_from=&date_to=&record_id=&aggregate_patient_chat=true
Response: PaginatedResponse<LLMCallLogItem>
```
- patient_chat 默认按 record_id 聚合展示
权限：llm_monitor

### GET /admin/llm-logs/export — 导出 LLM 日志 CSV
```
Query:  ?date_from=&date_to=
Response: CSV 文件
```
权限：llm_monitor

### GET /admin/llm-logs/{log_id} — LLM 日志详情
```
Response: LLMCallLogItem (含完整请求/响应)
```
权限：llm_monitor

---

## 练习模板管理 `/admin/practices`

### GET /admin/practices — 练习模板列表（分页）
```
Query:  ?offset=0&limit=50
Response: PaginatedResponse<{ id, name, description, case_id, case_name, mode, features, behavior, assessment, is_active, training_count, created_at, updated_at }>
```
权限：case_manage

### GET /admin/practices/{practice_id} — 练习模板详情
```
Response: PracticeItem
```
权限：case_manage

### POST /admin/practices — 创建练习模板
```
Request:  { name, description?, case_id, mode?, features?, behavior?, assessment? }
Response: PracticeItem
```
权限：case_manage

### PUT /admin/practices/{practice_id} — 编辑练习模板
```
Request:  { name?, description?, case_id?, mode?, is_active?, features?, behavior?, assessment? }
Response: PracticeItem
```
权限：case_manage

### DELETE /admin/practices/{practice_id} — 删除练习模板
```
Response: { ok: true }
```
- 已有训练记录不可删除
权限：case_manage

---

## 插件管理 `/admin/plugins`

### GET /admin/plugins — 插件列表
```
Response: [{ id, name, feature_flag, requires, middleware_count, has_hooks, meta: { description, tags } }]
```
权限：登录（case_manage 级别可见）

---

## API 档案与指派管理 `/admin/api`

采用 ApiSecret（API 档案）+ LLMConfig（用途指派）两级模型，替代旧版 Provider + Key 系统。

### GET /admin/api/secrets — 档案列表
```
Response: [{ id, label, key_suffix, base_url, provider, status, price_input_per_1m, price_output_per_1m, monthly_cost_limit, call_count_today, total_tokens_today, total_cost_today, monthly_cost_used, config_count, last_used_at, created_at, updated_at }]
```
- key_suffix 为脱敏后缀（如 `****abcd`）
权限：api_manage

### POST /admin/api/secrets — 创建 API 档案
```
Request:  { label, raw_key, base_url?, price_input_per_1m?, price_output_per_1m?, monthly_cost_limit? }
Response: { id, key_suffix }
```
- raw_key 使用 Fernet 加密存储，相同 key 不可重复添加
权限：api_manage

### PUT /admin/api/secrets/{secret_id} — 编辑档案
```
Request:  { label?, base_url?, price_input_per_1m?, price_output_per_1m?, monthly_cost_limit? }
Response: { ok: true }
```
权限：api_manage

### DELETE /admin/api/secrets/{secret_id} — 删除档案
```
Response: { ok: true }
```
- 有关联用途指派时不可删除
权限：api_manage

### GET /admin/api/configs — 用途指派列表
```
Query:  ?purpose=
Response: [{ id, secret_id, secret_label, secret_suffix, base_url, provider, label, model, purpose, priority, weight, status, price_input_per_1m, price_output_per_1m, monthly_cost_limit, created_at, updated_at }]
```
权限：api_manage

### POST /admin/api/configs — 创建/更新用途指派
```
Request:  { secret_id, model, purpose, label?, priority?, weight?, price_input_per_1m?, price_output_per_1m?, monthly_cost_limit? }
Response: { id }
```
- 同一 (secret_id, purpose) 已存在则更新
权限：api_manage

### PUT /admin/api/configs/{config_id} — 编辑指派
```
Request:  { secret_id?, model?, purpose?, status?, label?, priority?, weight?, price_input_per_1m?, price_output_per_1m?, monthly_cost_limit? }
Response: { ok: true }
```
权限：api_manage

### DELETE /admin/api/configs/{config_id} — 删除指派
```
Response: { ok: true }
```
权限：api_manage

### POST /admin/api/configs/{config_id}/toggle — 启用/禁用指派
```
Response: { ok: true, status: "active" | "disabled" }
```
权限：api_manage

### POST /admin/api/configs/{config_id}/reset — 重置档案健康状态
```
Response: { ok: true }
```
- 清除 degraded 状态和 consecutive_failures 计数
权限：api_manage

### POST /admin/api/configs/{config_id}/test — 连通性测试（单个）
```
Response: { base_url, ok, status_code?, latency_ms?, error? }
```
权限：api_manage

### POST /admin/api/configs/test-all — 全部连通性测试
```
Response: { results: [{ base_url, ok, status_code?, latency_ms?, error? }] }
```
权限：api_manage

### POST /admin/api/reload — 重新加载路由表
```
Response: { ok: true }
```
权限：api_manage

### GET /admin/api/model-presets — 预设模型目录
```
Response: { providers: [{ provider, display_name, base_url, models: [{ name, price_input, price_output }] }] }
```
权限：api_manage

### GET /admin/api/health — API 健康检查
```
Response: [{ base_url, status: "ok"|"error", latency_ms, error? }]
```
权限：api_manage

### GET /admin/api/fallback — 环境变量回退状态
```
Response: { configured: bool, key_suffix?, models? }
```
权限：api_manage

### POST /admin/api/fallback/test — 测试环境变量回退连接
```
Response: { base_url, ok, status_code?, latency_ms?, error? }
```
权限：api_manage

### Rubric 评分标准管理

#### GET /admin/api/rubrics — 评分标准列表
```
Response: [{ id, name, version, description, total_max, raw_max, raw_scale, dimensions, is_active, created_at }]
```
权限：api_manage

#### GET /admin/api/rubrics/active — 当前激活的评分标准
```
Response: RubricResponse
```
权限：api_manage

#### POST /admin/api/rubrics — 创建评分标准
```
Request:  { name?, version?, description?, total_max?, raw_max?, raw_scale?, dimensions: [...] }
Response: RubricResponse
```
权限：api_manage

#### PUT /admin/api/rubrics/{rubric_id} — 更新评分标准
```
Request:  { name?, version?, description?, total_max?, raw_max?, raw_scale?, dimensions? }
Response: RubricResponse
```
权限：api_manage

#### DELETE /admin/api/rubrics/{rubric_id} — 删除评分标准
```
Response: { ok: true }
```
- 当前激活的不可删除
权限：api_manage

#### POST /admin/api/rubrics/{rubric_id}/activate — 激活评分标准
```
Response: { ok: true }
```
权限：api_manage

---

## Prompt 管理 `/admin/prompts`

### GET /admin/prompts — 获取 Prompt 模板列表
```
Query:  ?purpose=chat|scoring|qa|case_generation|scoring_feedback|patient_dynamic
Response: [{ id, purpose, version, name, system_prompt, user_prompt?, template_engine, variables, is_active, created_by, remark, created_at, updated_at, is_builtin?, locked? }]
```
- 同时返回数据库记录和内置兜底（id=0, locked=true）
权限：prompt_manage

### POST /admin/prompts — 创建 Prompt 模板
```
Request:  { purpose, name, system_prompt, user_prompt?, variables?, activate?, created_by?, remark? }
Response: PromptTemplateResponse（version 自动递增）
```
权限：prompt_manage

### PUT /admin/prompts/{prompt_id} — 编辑模板
```
Request:  { system_prompt?, user_prompt?, name?, remark?, ... }
Response: PromptTemplateResponse
```
权限：prompt_manage

### DELETE /admin/prompts/{prompt_id} — 删除模板
```
Response: { ok: true }
```
- 不能删除当前激活的模板
权限：prompt_manage

### POST /admin/prompts/{prompt_id}/activate — 激活模板版本
```
Query:  ?purpose= (prompt_id=0 时必需)
Response: { ok: true }
```
- prompt_id=0 切换到内置兜底，同一 purpose 下其他版本自动停用
权限：prompt_manage

### POST /admin/prompts/validate — 验证模板变量
```
Request:  { purpose, system_prompt, user_prompt?, variables? }
Response: { valid, errors, missing_vars, warnings }
```
权限：prompt_manage

### POST /admin/prompts/reload — 重载 Prompt 缓存
```
Response: { ok: true }
```
权限：prompt_manage

### GET /admin/prompts/sample-vars — 获取示例变量
```
Query:  ?purpose=
Response: { purpose, vars: { key: value, ... } }
```
权限：prompt_manage

### GET /admin/prompts/active/preview — 预览当前激活模板渲染结果
```
Query:  ?purpose=
Response: { purpose, version, system_prompt_raw, user_prompt_raw?, system_prompt_rendered, user_prompt_rendered?, sample_vars, render_error? }
```
权限：prompt_manage

---

## 学校管理 `/admin/schools`（仅 super_admin）

### GET /admin/schools — 学校列表（分页）
```
Query:  ?offset=0&limit=50
Response: PaginatedResponse<{ id, name, teacher_count, student_count, created_at }>
```
权限：school_manage

### POST /admin/schools — 创建学校（含默认角色和学校管理员）
```
Request:  { name, admin_username, admin_password, admin_display_name }
Response: SchoolResponse
```
权限：school_manage

### DELETE /admin/schools/{school_id} — 删除学校（级联所有用户/角色/数据）
```
Response: { message: "学校 'xxx' 已删除" }
```
- 不能删除自己所在的学校
权限：school_manage

---

## 角色管理 `/admin/roles`

### GET /admin/roles — 角色列表
```
Query:  ?search=
Response: [{ id, name, display_name, is_system, school_id, permissions: [...], user_count }]
```
权限：role_manage

### POST /admin/roles — 创建角色
```
Request:  { name, display_name, permissions: [...] }
Response: RoleResponse
```
权限：role_manage

### PUT /admin/roles/{role_id} — 编辑角色
```
Request:  { display_name?, permissions? }
Response: RoleResponse
```
权限：role_manage

### DELETE /admin/roles/{role_id} — 删除角色
```
Response: { message: "角色 'xxx' 已删除" }
```
- 系统角色不可删除；有关联用户不可删除
权限：role_manage

---

## 年级管理 `/admin/grades`

### GET /admin/grades — 年级列表
```
Response: [{ id, name, class_count, student_count, created_at }]
```
权限：grade_class_manage

### POST /admin/grades — 创建年级
```
Request:  { name }
Response: GradeResponse
```
权限：grade_class_manage

### PUT /admin/grades/{grade_id} — 编辑年级
```
Request:  { name }
Response: GradeResponse
```
权限：grade_class_manage

### DELETE /admin/grades/{grade_id} — 删除年级（级联班级，解绑学生）
```
Response: { message: "已删除年级及其下 N 个班级" }
```
权限：grade_class_manage

---

## 班级管理 `/admin/classes`

### GET /admin/classes — 班级列表
```
Query:  ?grade_id=
Response: [{ id, grade_id, grade_name, name, student_count, created_at }]
```
权限：grade_class_manage

### POST /admin/classes — 创建班级
```
Request:  { grade_id, name }
Response: ClassResponse
```
权限：grade_class_manage

### PUT /admin/classes/{class_id} — 编辑班级
```
Request:  { grade_id?, name? }
Response: ClassResponse
```
权限：grade_class_manage

### DELETE /admin/classes/{class_id} — 删除班级（解绑学生）
```
Response: { message: "已删除班级 xxx" }
```
权限：grade_class_manage

---

## 问卷模块

### 模板管理

#### GET /questionnaires/templates — 问卷模板列表（分页）
```
Query:  ?type=&offset=0&limit=20&school_id=
Response: PaginatedResponse<{ id, title, type, description, is_active, question_count, response_count, school_id, created_at, updated_at }>
```
权限：questionnaire_manage

#### POST /questionnaires/templates — 创建问卷模板（含题目）
```
Request:  { title, type, description?, is_active?, questions: [{ content, question_type, required?, sort_order?, options? }] }
Response: QuestionnaireTemplateDetailResponse (含问题列表)
```
权限：questionnaire_manage

#### GET /questionnaires/templates/{template_id} — 模板详情
```
Response: { ...template, questions: [...], case_ids: [...] }
```
权限：questionnaire_manage

#### PUT /questionnaires/templates/{template_id} — 编辑模板
```
Request:  { title?, type?, description?, is_active? }
Response: QuestionnaireTemplateDetailResponse
```
权限：questionnaire_manage

#### DELETE /questionnaires/templates/{template_id} — 删除模板
```
Response: { ok: true }
```
权限：questionnaire_manage

#### PUT /questionnaires/templates/{template_id}/case-assignments — 分配病例
```
Request:  { case_ids: [...], is_required?, trigger_event? }
Response: { ok: true }
```
权限：questionnaire_manage

### 题目管理

#### POST /questionnaires/templates/{template_id}/questions — 添加题目
```
Request:  { content, question_type, required?, sort_order?, options? }
Response: QuestionnaireQuestionResponse
```
权限：questionnaire_manage

#### PUT /questionnaires/templates/{template_id}/questions/{question_id} — 编辑题目
```
Request:  { content?, question_type?, required?, sort_order?, options? }
Response: QuestionnaireQuestionResponse
```
权限：questionnaire_manage

#### DELETE /questionnaires/templates/{template_id}/questions/{question_id} — 删除题目
```
Response: { ok: true }
```
权限：questionnaire_manage

### 答题

#### GET /questionnaires/check — 检查是否有待填问卷
```
Query:  ?case_id=&record_id=&trigger=before_training|after_scoring|manual
Response: { has_pending: bool, template_id?, response_id?, template?, is_required?, trigger_event? }
```
- 有已完成答案返回 has_pending=false
权限：登录

#### POST /questionnaires/responses — 提交问卷答案
```
Request:  { template_id, case_id, record_id?, answers: [{ question_id, answer_value }] }
Response: QuestionnaireResponseItem
```
- 已回答则更新，未答则创建
权限：登录

#### GET /questionnaires/my-responses — 我的答卷列表（分页）
```
Query:  ?offset=0&limit=20
Response: PaginatedResponse<QuestionnaireResponseItem>
```
权限：登录

#### GET /questionnaires/responses/{template_id} — 某模板的所有答卷（分页）
```
Query:  ?offset=0&limit=20&school_id=
Response: PaginatedResponse<QuestionnaireResponseItem>
```
权限：questionnaire_manage

#### GET /questionnaires/responses/{template_id}/stats — 答卷统计
```
Query:  ?school_id=
Response: { template_id, template_title, total_assigned, total_completed, completion_rate, questions: [{ question_id, content, question_type, response_count, avg_likert?, choice_distribution?, text_answers? }] }
```
权限：questionnaire_manage

#### GET /questionnaires/responses/{template_id}/export — 导出答卷 CSV
```
Query:  ?school_id=
Response: CSV 文件（学生姓名/学号/提交时间 + 每题答案列）
```
权限：export_data

---

## 系统模块

### GET /health — 健康检查
```
Response: { status: "ok", version: "2026.06.12" }
```
- DB 连接失败返回 503: `{ code: 503, data: { status: "db_error" }, message: "database unreachable" }`
权限：公开

### GET /metrics — 指标快照
```
Response: { requests, active_sessions, task_queue_size, log_queue_size, degraded_providers, global_degraded, ... }
```
权限：公开（内部使用）

---

## 权限体系说明

系统采用 RBAC 权限模型，每个角色绑定一组权限标识：

| 权限标识 | 说明 |
|----------|------|
| `training_access` | 启动训练、发送消息 |
| `case_manage` | 病例 CRUD、练习模板管理 |
| `user_manage` | 用户/学生管理 |
| `score_review` | 查看全部训练记录、评分复核、发布练习 |
| `stats_view` | 查看统计数据、排名 |
| `export_data` | 导出训练记录、问卷数据 |
| `llm_monitor` | 查看 LLM 调用统计和日志 |
| `prompt_manage` | Prompt 模板管理 |
| `api_manage` | API 档案/指派管理 |
| `questionnaire_manage` | 问卷模板/题目管理 |
| `feedback_review` | 查看用户反馈 |
| `grade_class_manage` | 年级/班级 CRUD |
| `role_manage` | 角色管理 |
| `school_manage` | 学校管理（super_admin） |
| `record_notes` | 查看他人训练笔记 |

---

## 分页约定

所有列表接口统一使用 `PaginatedResponse<T>` 包装：

```json
{
  "code": 0,
  "data": {
    "items": [...],
    "total": 123,
    "offset": 0,
    "limit": 50
  },
  "message": "success"
}
```

- `offset`: 默认 0
- `limit`: 默认 20-50（因接口而异），最大 100
- `total`: 总记录数（非当前页条数）

---

## 错误响应格式

```json
{ "code": 400, "data": null, "message": "错误描述" }
```

HTTP 状态码：400（业务错误）、401（未登录）、403（无权限）、404（不存在）、409（冲突）、413（请求体过大）、429（限流）、500/502（服务端错误）、503（DB不可用）、504（超时）
