# 原型系统功能收敛设计（Prototype Consolidation Design）

> 日期：2026-07-16
> 状态：已定稿（决议经全量核查确认）
> 关联计划：`docs/superpowers/plans/2026-07-16-batch1-scoring-integrity.md` ~ `batch4-teacher-mobile-ux.md`

## 背景

对系统做了 5 路并行功能/体验审计（学生训练流程、评分链路、教师管理端、账户旅程、跨实体业务规则），随后 4 路核查代理逐条验证了全部论断的 file:line 属实性。本 spec 汇总最终决议与详细设计，按 4 个执行批次组织。

**核心原则**：这是原型系统，功能合理好用是关键要务；不做基础设施过度工程（不做心跳机制、不做完整看板、不做班级数据隔离、不做邮箱重置）。

## 核查修正记录（重要）

以下原审计论断经核查**修正**，设计已据此调整：

| 原论断 | 核查结果 | 处置 |
|--------|---------|------|
| 禁用用户（is_active）不生效 | ❌ 证伪：`core/security.py:74,104` 每请求检查，`ws.py:54` WS 升级也检查 | 仅登录端点补检查（友好报错），归批次四 |
| 队列满时记录已持久化为 completed | ⚠️ 修正：503 时 `db.commit()` 未执行（`scoring.py:350` 在 except 后），内存修改丢弃；但 `acquire_scoring` 的 CAS UPDATE 可能已将 `scoring_status='pending'` 落库，导致后续 end_training 被 400 拦截 | 修复方向改为：QueueFullError 路径显式回滚 scoring_status，归批次一 |
| "可提前输入下一句"导致消息丢失 | ⚠️ 降级：发送按钮/回车/语音按钮在 loading 时均被拦截，不丢消息；仅 placeholder 文案（`ChatInput.tsx:116`）承诺了不存在的排队能力 | 仅改文案，归批次一 |
| 学生离开页面后评分完成无提示 | ⚠️ 降级：`useScoringNotifications`（`ProtectedRoute.tsx:7` 全局挂载）通过 WS 推 toast，已覆盖通知层面；仅 ScoreCard 弹窗丢失 | 不修 |
| —（新发现） | ✅ 教师端作业详情逾期口径不一致：`services/assignment.py:82` 用 `record.status`，有记录的逾期学生教师端永远看不到"已逾期"；学生端 `services/student.py:49-51` 会显示 | 归批次四 |

## 决议总表

| # | 决议 | 批次 |
|---|------|------|
| D1 | 有复核禁学生重评；教师强制重评需 `force=true` + 前端警告 | 1 |
| D2 | 复核后学生看到复核总分+复核明细；AI 原始分折叠可查；停止覆写 `Score.total_score` | 1 |
| D3 | 同一作业多次训练取**最高分**（已评分记录中 total_score 最高者） | 1 |
| D4 | 启用 AUTO_SCORE 阈值：低于门槛不评分，标"内容不足" | 1 |
| D5 | 评分失败自动重试 1 次（间隔 30s），仍失败才手动 | 1 |
| D6 | settlement loop 顺带扫超时 pending/processing 置 failed | 1 |
| D7 | case_data 训练开始时整体入快照（新列 `case_snapshot`），聊天/评分/回顾全用快照 | 3 |
| D8 | rubric（含护理记录动态维度）训练开始时一次性固化进 `rubric_snapshot`，评分不再动态改 | 3 |
| D9 | 砍掉阶段系统（pipeline phase、middlewares、progress 路由、current_phase 列） | 2 |
| D10 | 砍掉微信登录后端（保留 `wechat_openid` 列） | 2 |
| D11 | 接通问卷触发（before_training / after_scoring，前端基础设施已存在只需接线） | 4 |
| D12 | 砍掉学习笔记（路由、模型、表、前端卡片、record_notes 权限） | 2 |
| D13 | 接通 abandoned：放弃端点 + History UI + 筛选项 | 4 |
| D14 | 不做自助重置；管理端加"重置密码为随机值展示一次"按钮 + 登录页联系教师文案 | 4 |
| D15 | 登录端点补 is_active 检查（每请求检查已存在，证伪修正） | 4 |
| D16 | 不做教师班级隔离（原型阶段维持全局权限） | — |
| D17 | 管理员"以学生视角预览"开关 | 4 |
| D18 | rubric 抽成 JSON 配置文件（mtime 热更）+ 管理端只读展示页 | 4 |
| D19 | 练习试跑依托 D17；管理权限用户创建的训练记录自动 `is_test=true` 不入统计 | 4 |
| D20 | 修通 practice features：表单加能力开关并真实上传 | 4 |
| D21 | 作业加 `is_closed`：关闭后不能开始/继续，已提交保留 | 4 |
| D22 | 截止语义维持"可补做+逾期标记"；教师端修正逾期显示口径 | 4 |
| D23 | 作业详情加均分/最高/最低/完成率统计 | 4 |
| D24 | 不做年级批量升级 | — |
| D25 | 移动端底部 Tab"我的问卷"→"我的"（/profile 扩充为聚合页） | 4 |

另有纯 bug 修复清单，见各批次明细。

---

## 批次一：评分公信力 + 防丢数据 + 纯 bug

目标：学生看到的分数可信、教师复核有效、学生填写的内容不丢失。

### 1.1 D1 — 重评守卫（有复核时保护）

**现状**：`backend/contexts/training/router/scoring.py:380-426` `retry_scoring` 权限为 `score_review` 或记录本人（:390）；:403-406 无条件删除 Score（cascade 删 ScoreReview）。

**设计**：
- 查询该 Score 是否存在 ScoreReview。
- 存在复核时：学生本人请求 → 403 `"该评分已由教师复核，无法重新评分"`；`score_review` 权限用户 → 要求 query 参数 `force=true`，否则 409 提示。
- `force=true` 时才删除 Score+Review 并重评。
- 前端：`ScoringPendingBanner.tsx` / `RecordDetail` 的重评按钮，教师侧（有复核时）弹确认框"重新评分将丢弃已有的教师复核，确定继续？"，携带 `force=true`。学生侧收到 403 时展示后端 detail。

### 1.2 D2 — 复核结果正确展示

**现状**：`backend/contexts/training/router/score_review.py:63-76` 复核提交时重算并**覆盖** `Score.total_score`，不动 `Score.detail_scores`。前端 `ScoreResultSection.tsx:200-201` 只读 `recordScore.detail_scores`（AI 原始），复核数据仅渲染 badge/备注（:58-71,107-114）。

**设计**：
- **停止覆写 `Score.total_score`**——Score 永远保存 AI 原始评分。
- ScoreReview 新增列 `total_score: float | None`（DDL 迁移），复核提交时把重算的总分写到 `ScoreReview.total_score`。
- `TrainingRecordDetail` 的 score 响应中附带 review 数据：扩展 `ScoreItem` schema，加 `review: {detail_scores, total_score, comment, reviewed_at} | None`。
- 前端 `ScoreResultSection`：存在 review 时——大号总分显示 `review.total_score`；维度明细以 `review.detail_scores` 覆盖合并 AI 明细（教师改过的项显示复核分并标注"已复核"）；折叠区"AI 原始评分"展示未合并的原始 total+明细。
- 存量数据兼容：历史上已被覆写的 `Score.total_score` 无法还原，接受现状（原型阶段数据可清）。

### 1.3 D3 — 作业成绩取最高分

**现状**：`backend/services/assignment.py:70` `{r.user_id: r for r in training_records}` dict 覆盖；`repositories/assignment.py:77-83` 查询无 order_by，"最后一条"不可预测。`scored_count`（:100）口径被污染。

**设计**：
- `_build_detail_view` 改为：对每个学生取"最佳记录"——优先取 `scoring_status=='completed'` 中 `Score.total_score` 最高者；无已评分记录时取 `start_time` 最新一条（展示进行中/未评分状态）。
- 查询需 join Score（或二次查询 record_ids 的分数）。
- `completed_count` = 有 completed 记录的学生数；`scored_count` = 有已评分记录的学生数（不再依赖覆盖后的单条）。
- 学生列表行附带 `attempt_count`（该生该作业的记录总数），前端在得分列旁显示"共 N 次"。
- CSV 导出（`routers/assignments.py:147-211`）同口径。

### 1.4 D4 — 低质量训练不评分

**现状**：`end_training`（`scoring.py:310-377`）无提交前校验，`message_count` 仅打日志。`core/config.py:121-123` 三个 AUTO_SCORE 常量零引用（死代码）。

**设计**：
- 门槛：学生消息数 ≥ 3 **且** 学生消息总字符 ≥ `AUTO_SCORE_STUDENT_CHARS_MIN`（默认 200）。
- 删除 `AUTO_SCORE_COVERED_INQUIRIES_MIN`、`AUTO_SCORE_AI_CHARS_MIN`（保留 STUDENT_CHARS_MIN，新增 `AUTO_SCORE_STUDENT_MSG_MIN=3`）。
- 低于门槛时：`end_training` 正常结束训练（status=completed），但**不入队评分**，置 `scoring_status='failed'`、`scoring_error='训练对话内容过少，未生成评分'`。retry_scoring 同样执行门槛检查（低于门槛 400 报同样文案）。
- 前端：`TrainingHeader.tsx` 结束确认框在低于门槛时改文案："当前对话内容较少（已发送 N 条），结束后将不会生成评分，确定结束？"（需要 StreamManager 的消息计数，前端已有 messages 状态）。

### 1.5 D5 — 失败自动重试 1 次

**现状**：`_handle_scoring_failure`（`scoring.py:140-186`）仅落状态+通知，无重试。

**设计**：在 `_run_scoring_background` 中包裹 `evaluate_training` 调用：首次异常（非 CancelledError）时 `asyncio.sleep(30)` 后重试一次；第二次仍失败才走 `_handle_scoring_failure`。超时（`asyncio.wait_for` 的 TimeoutError）不重试（已耗时 180s，直接失败）。日志记录 attempt 次数。

### 1.6 D6 — settlement 扫超时评分

**现状**：卡死恢复仅启动时 `main.py:80-118`；settlement（`infrastructure/settlement.py`，30s tick）只处理 in_progress 超时。

**设计**：settlement 每 tick 追加一步：查 `scoring_status IN ('pending','processing') AND end_time < now - interval '10 minutes'` 的记录，置 `scoring_status='failed'`、`scoring_error='评分超时，已自动标记失败，可手动重试'`，并发失败通知（复用 `_create_notification` 逻辑）。10 分钟 >> SCORING_TIMEOUT_SECONDS(180s)，不会误伤正常评分。

### 1.7 队列满异常路径修复

**现状**：`scoring.py:337-348` QueueFullError → 503；但 `acquire_scoring`（CAS UPDATE）可能已把 `scoring_status='pending'` 落库，导致记录卡在"in_progress + pending"，再次 end_training 被 :3xx 守卫 400 拦截。

**设计**：QueueFullError 分支中，抛 503 前显式将 `scoring_status` 重置为 NULL 并 commit（记录保持 in_progress，学生可再次正常结束）。需先核实 `acquire_scoring` 是否自带 commit；若不带，则此分支显式 rollback 即可。以测试锁定行为：队列满 → 端点 503 → 记录仍可再次 end。

### 1.8 评分校验补全（纯 bug）

**现状**：`_scoring_validation.py` 四缺（无总分一致性、无越界裁剪、缺维度静默、幻觉维度 setdefault 接受）。

**设计**（在 `_validate_scoring_essentials` / `_inject_rubric_max` 链路中补）：
- **幻觉维度过滤**：`detail_scores` 中维度名不在 rubric 维度集合内的，直接丢弃并 log warning。
- **越界裁剪**：每个 item 的 score clamp 到 `[0, raw_scale]`；维度 score clamp 到 `[0, max]`；total clamp 到 `[0, 100]`。
- **总分一致性**：按维度分重算 total（换算逻辑与 score_review 的重算一致，抽成共享函数），若与 LLM 输出 total 偏差 > 2 分，以重算值为准并 log。
- **缺失维度**：rubric 有而 LLM 没输出的维度，补零分占位并在 `missed_content`/log 标注"该维度评分缺失"——不再静默。

### 1.9 护理记录防丢失

**现状**：`NursingRecordCard.tsx:46-76` 仅手动保存；回填保护仅 `Object.keys(prev).length > 0`（:33-44）。

**设计**：
- **自动保存**：sheet 内容 debounce 3s 自动调用现有保存端点（`POST /api/nursing-records/{rid}`，status="draft"）；保存状态指示（"已自动保存 HH:mm" / "保存中…"）。
- **结束训练前保存**：`endTraining` 流程（`TrainingEngine.tsx:149-156`）先 flush 未保存的护理记录再调 end（通过 MessageBus 事件 `training:beforeEnd` 或直接在 engine 持有 ref）。最简实现：NursingRecordCard 订阅 bus 的 `training:ended` 前置事件并同步 flush；或把自动保存 debounce 缩短使风险窗口可接受——计划中选 bus 事件方案。
- **回填保护**：引入 `dirtyRef`（用户输入过即 true），dirty 时 query 数据不覆盖本地。

### 1.10 作业重入不删数据

**现状**：`session.py:307-326` 重入时 `student_msg_count==0` 则删 Message/NursingRecord 并 `db.delete(existing)`。

**设计**：重入时**永不删除**，直接返回已有记录的 `record_id`（无论是否发过消息）。护理记录/问卷数据自然保留。删除逻辑整段移除。（学生想重开一局的诉求由 D13 放弃+重开覆盖：作业模式下已有 in_progress 记录时继续该记录。）

### 1.11 其余纯 bug（小项）

| 项 | 现状 | 修复 |
|----|------|------|
| exam:error 无处理 | 后端确实发送（`ws.py:126-130`），前端 `PhysicalAssessmentCard.tsx:75-82` 只处理 exam:done | 处理 exam:error：清除"检测中…"占位、toast 错误；另加 15s 前端超时兜底 |
| streamError 不渲染 | `StreamManager.ts:182-189` 设置，ChatBubble 不读 | ChatBubble 对含 streamError 的消息尾部渲染"⚠ 回复中断"标记（比较函数补 streamError） |
| 学生消息不回滚 | `StreamManager.ts:137-148` 乐观添加，catch 不移除 | 网络异常且 placeholder 无内容时，同时移除本次学生消息并把文本回填输入框（bus 事件通知 ChatInput）——最小实现：移除学生消息 + toast"发送失败，消息未送达" |
| placeholder 误导 | `ChatInput.tsx:116` "可提前输入下一句" | 改为"患者正在回复中…" |
| trainingEnded 刷新失同步 | `useTrainingRecord.ts` 不返回 status | detail 响应已有 status；hook 透传，`TrainingEngine` 用 `record.status==='completed'` 初始化 trainingEnded |
| textarea 无 maxLength | 后端 2000（`schemas/training.py:27`） | textarea 加 maxLength={2000}，接近上限显示计数 |
| health_literacy "medium" | `services/case.py:21` 映射缺 medium | 映射补 `"medium": "中等"`（与 normal 同义）；schema 的 Literal 保留 |
| time_limit 前后端不齐 | 前端 5-120，后端 1-180 | 后端 `case_schema.py:58` 收敛为 ge=5 le=120（`_create_record` 的 clamp 同步 5-120） |
| Feedback FK 无 ondelete | `models/` Feedback.user_id | DDL 迁移改为 `ondelete="CASCADE"`（用户删除时反馈随删）；user.delete 保护逻辑不变 |

### 1.12 批次一涉及迁移

- ddl：`score_reviews` 加 `total_score` 列（nullable float）
- ddl：`feedback.user_id` FK 改 ondelete CASCADE
- 均需可逆 downgrade

---

## 批次二：砍代码（阶段系统 / 微信 / 学习笔记）

目标：移除三块"半接线"死代码，先砍后建。**全部完成后运行 `pnpm run api:update` 同步 .gen.ts。**

### 2.1 D9 — 砍阶段系统

核查确认：`current_phase` 仅在 `session.py:174` 写入一次后永不变更；`auto_after_messages=9999` 永不触发；前端零调用 advance-phase。

**整文件删除**：
- `backend/contexts/training/pipeline/phase.py`
- `backend/contexts/training/pipeline/middleware/phase_guard.py`
- `backend/contexts/training/pipeline/middleware/phase_transition.py`
- `backend/contexts/training/router/progress.py`（含 advance-phase；**注意**该文件还含 initiative + emotion history 端点——核查显示其为完整 181 行文件；计划执行时需确认 initiative/emotion 端点是否被前端使用，若被使用则只删 phase 部分并保留其余）

**部分修改**：
- `pipeline/__init__.py`：删 phase 导入/导出
- `pipeline/context.py`：删 `current_phase/phase_index/manual_advance_requested/phase_operation_count` 字段、`setup_phases()`、`_count_phase_operations()`
- `pipeline/middleware/__init__.py`、`pipeline/builder.py`：删两个 middleware 注册（GUARD/TRANSITION stage 保留为空槽）
- `router/chat.py:84`：删 `ctx.setup_phases()`
- `router/session.py:174,437,524`：删 current_phase 写入与响应字段
- `models/training.py:59`：删列（迁移）
- `schemas/training.py:46,102,139-143`：删字段与 `PhaseAdvanceResponse`
- `profiles/registry.py`：删 `PhaseConfig` 类、`TrainingProfile.initial_phase/phases`
- `profiles/history_taking/profile.py:66-77`、`profiles/triage/profile.py:80-91`：删对应参数
- `tests/training/test_pipeline_phase.py` 删除；`test_pipeline_integration.py:18,67` 清理引用

**迁移（ddl）**：drop `training_records.current_phase` 列 + check constraint `ck_training_records_current_phase`（若存在）。downgrade 恢复列+约束。

### 2.2 D10 — 砍微信后端

**整文件删除**：`backend/infrastructure/wechat.py`、`backend/core/login_strategies/wechat.py`

**部分修改**：
- `routers/auth.py:54-79`：删 3 个微信端点
- `services/auth.py:133-225`：删 3 个方法 + `:12` 的 import
- `schemas/auth.py:41-65`：删 4 个微信 schema
- `core/login_strategies/__init__.py:39,43`：删注册
- `core/config.py:88-89`：删 `WECHAT_APPID/WECHAT_SECRET`；`.env.example` 同步删除
- **保留** `models/auth.py:49` 的 `wechat_openid` 列（决议：不做列迁移）
- 相关测试清理（grep wechat in tests/）

### 2.3 D12 — 砍学习笔记

**整文件删除**：
- `backend/routers/notes.py`
- `frontend/src/api/notes.ts`
- `frontend/src/components/training/scene-cards/NotesCard.tsx`
- `backend/profiles/history_taking/notes.py`（EmotionNoteSource/IdentityGuardSource——**执行时核实**这两个 Source 是否被 prompt 管道引用；若是 prompt 数据源而非"学习笔记"，则保留该文件，仅确认命名巧合）

**部分修改**：
- `models/training.py:135-165`：删 Note、NoteComment 模型；`models/__init__.py` 删导出
- `session.py:25,473,533,570`：删 Note 导入、详情加载、删除清理
- `schemas/training.py:82-93,111`：删 NoteItem/NoteCreateRequest 及 `TrainingRecordDetail.notes`
- `frontend/src/components/training/scene-cards/registry.ts:26`：删注释残留
- `frontend/src/api/query-keys.ts:38-41`：删 notes 键
- 路由注册处（main.py 或 router 汇总处）删 notes router 挂载

**迁移**：
- ddl：`op.drop_table("note_comments")` + `op.drop_table("notes")`；downgrade 完整重建两表（从 `0001_initial.py:438-449` 与 `449911a0d604_extend_notes_schema.py` 拼出最终结构）
- data：从 `role_permissions` 中 DELETE `record_notes` 权限项（docstring 带 `# Manual override reason: data_only`）；downgrade 恢复插入
- 后端权限常量定义处（permissions 源，供 `permissions.gen.ts` 生成）删 `record_notes`，跑 `pnpm run api:update`

---

## 批次三：快照固化

目标：训练开始瞬间冻结"病例内容 + 评分标准"，教师改配置不再影响进行中/已完成训练。

### 3.1 D7 — case_data 入快照

**现状**：`practice_snapshot` 只含 `{id,name,features,behavior}`（`session.py:126-138`，:217-220 回写 resolved features）。聊天 `chat.py:57-58`、评分 `scoring.py:330→score_engine.py:332`、详情 `session.py:476` 均实时读 `case.case_data`。

**设计**：
- `training_records` 新增列 `case_snapshot`（JSONB, nullable）——ddl 迁移。
- `_create_record`（自由训练与作业两条路径共用）写入 `record.case_snapshot = case.case_data` 全量深拷贝（case_data 体量小，不做"关键部分"裁剪，避免遗漏字段）。
- 读取路径统一改为 `record.case_snapshot or case.case_data`（fallback 兼容存量记录）：
  - `chat.py` `_build_context`
  - `scoring.py` 评分入口取 case_data 处
  - `session.py` `get_record_detail`
  - `resolve_features` 的 `case_defaults` 来源（`session.py:154,538`）改用快照的 `capabilities`
- 病例编辑页（管理端）不再需要"影响进行中训练"警告——修改天然只影响新训练。CaseForm 可加一行说明文案"修改仅对新开始的训练生效"。

### 3.2 D8 — rubric 训练开始时固化

**现状**：`rubric_snapshot`/`prompt_snapshot` 在评分后台任务才写（`scoring.py:218-231`）；`score_engine.py:431-487` 评分时对内存 rubric 动态追加护理记录 5 维度、`raw_max += 15`，不落盘。

**设计**：
- `_create_record` 中：解析 features 后，若 `nursing_record` 开启，构建"profile.rubric + 护理记录维度"的最终 rubric 写入 `record.rubric_snapshot`；否则写 profile.rubric 原样。`prompt_snapshot` 同步在此写入。
- 护理记录维度追加逻辑从 `score_engine.py` 抽出为纯函数 `build_final_rubric(base_rubric, features) -> dict`（可单测），创建时调用。
- `score_engine.evaluate_training`：删除动态追加分支，直接使用 `record.rubric_snapshot`；fallback（存量记录 snapshot 为空）时调用同一个 `build_final_rubric` 现算——保证新旧一条逻辑。
- retry 评分因此天然使用与首评一致的 rubric。

### 3.3 批次三涉及迁移

- ddl：`training_records` 加 `case_snapshot` JSONB 列，downgrade drop。

---

## 批次四：教师端 + 学生周边 + 移动端

### 4.1 D20 — 修通 practice features

**现状**：`PracticesPage.tsx:114-123` payload `features: {}` 硬编码；表单（:285-411）无 features 控件；后端校验（`services/practice.py:66-70,92-96`）从未被触发；表格"能力"列（:178-192）显示的是病例能力而非练习配置。

**设计**：
- 表单加"训练能力"区：根据所选病例的 `training_type` 过滤 `ALL_CAPABILITIES` 中 toggleable 项（`capabilities.gen.ts`：patient_initiative/physical_exam/nursing_record），渲染开关；builtin（emotion）显示为不可关的说明。
- 默认值：新建时预填病例 `capabilities` 的默认；编辑时回填 practice.features。
- onSubmit 上传真实 `values.features`。
- 表格"能力"列改为显示 practice.features 与病例默认的合并结果。
- `resolve_features` 优先级链（global → case_defaults → snapshot.features → overrides）已支持，无后端改动。

### 4.2 D21 — 作业关闭

**设计**：
- Assignment 加 `is_closed: bool = False`（ddl 迁移，server_default false）。
- `services/assignment.py`：update 支持 is_closed；新增守卫——`start_training_from_assignment` 在 `assignment.is_closed` 时 400 `"该作业已被教师关闭"`；聊天路径不拦截（进行中的允许自然结束）。
- 学生端 `list_assignments`（`services/student.py`）：关闭的作业 status 标记为 `"closed"`，前端 `AssignmentCardList` 显示"已关闭"徽章、隐藏开始/补做按钮。
- 教师端 `AssignmentsPage` 行操作加"关闭/重新开放"切换（带确认）。

### 4.3 作业修改守卫 + 逾期口径（D22 相关）

- `services/assignment.py:188-230` update：`has_any_records(assignment_id)` 为真时，禁止修改 `practice_id` 与 `class_id`（ValidationError "已有学生开始练习，不能更换练习或班级"）；标题/描述/时间仍可改。
- 逾期口径统一：`_build_detail_view`（:82 附近）对 `record.is_overdue and status != "completed"`……实际规则改为：学生行的 status 在记录 `is_overdue=True` 时展示为 `"overdue"`（完成的显示 completed 但附 `is_overdue` 字段，前端在完成时间旁加"逾期提交"小标）。`AssignmentStudentItem` schema 加 `is_overdue: bool`。前端 `AssignmentDetailPage` 状态列与完成时间列同步调整。

### 4.4 D23 — 作业统计最小版

- `AssignmentDetailView`/`AssignmentDetail` schema 加：`avg_score/max_score/min_score: float|None`、`completion_rate: float`。
- 基于 D3 的"每生最佳记录"口径计算（排除 is_test）。
- 前端 `AssignmentDetailPage.tsx:109-156` 统计卡片区替换/追加 4 项 + 一个简单分数分布条（0-59/60-69/70-79/80-89/90-100 五档 div 条形，不引图表库）。

### 4.5 D17+D19 — 学生视角预览 + is_test

**前端预览开关**：
- zustand（或 authStore 内）加 `previewAsStudent: boolean`（persist 到 sessionStorage）。
- 管理端侧边栏加"以学生视角预览"入口：置 true 并 navigate("/home")。
- 绕过点（核查确认清单）：`DashboardHome.tsx:46-48` 跳转、`Layout.tsx:142-157` 壳选择、`DashboardHome.tsx:24,30,43` 的 `enabled: !isAdmin` 查询开关、`TrainingSelect.tsx` 的 isAdmin 跳转（如有）。统一改为 `isAdmin && !previewAsStudent`。
- 预览模式顶栏渲染醒目 banner"学生视角预览模式"+"退出预览"按钮（置 false 并回 /admin）。

**is_test 标记**：
- `training_records` 加 `is_test: bool = False`（ddl 迁移）。
- 后端 `_create_record`：若 `current_user.has_permission("case_manage") or has_permission("score_review")` → `is_test=True`。无需前端传参。
- 排除点（核查清单全量）：`services/stats.py:36-48,59-78,113-147,160-202,219-264`、`services/assignment.py:69,99-100`、`services/user.py:168-196`、`services/student.py:40-43`（学生自己都是非管理员，天然不受影响，但过滤加上无害）。教师本人历史页（get_records 本人视角）**不**排除——教师能看到自己的试跑记录。

### 4.6 D18 — rubric 配置化 + 只读页

- `profiles/history_taking/rubric.py` 的 RUBRIC 字典迁为 `backend/profiles/history_taking/rubric.json`；`repositories/rubric.py` 的 `load_rubric` 改为读 JSON 文件，缓存带 mtime 失效（文件改动即热更）。py 文件保留 thin loader 或删除（计划定）。
- 新端点 `GET /api/rubrics/current`（`score_review` 权限）返回 rubric JSON。
- 前端 `/admin/rubric` 只读页：按维度/条目/锚点渲染（权限 `score_review`），导航"训练管理"分组下加"评分标准"。

### 4.7 D14+D15 — 密码与登录

- 管理端 `UserForm.tsx`（编辑态）加"重置密码"按钮：前端生成 8 位随机串（字母+数字），调既有 `PUT /api/admin/users/{id}`（password 字段已支持，`services/user.py:275-278`），成功后弹 Dialog 展示明文+复制按钮+"仅展示一次"提示。
- `Login.tsx` 表单下方加灰字："忘记密码？请联系教师或管理员重置"。
- 登录端点（`routers/auth.py` login / `services/auth.py`）：认证成功后若 `not user.is_active` → 403 `"账号已被禁用，请联系管理员"`（当前仅在后续请求 401）。

### 4.8 D25 — 移动端"我的"Tab

- `StudentTabShell.tsx:45-57`：第 4 个 Tab 由 `/my-responses`（我的问卷）改为 `/profile`，icon 换 User，label"我的"。
- `Profile.tsx` 扩充：顶部保留资料/改密码；下方加入口列表——"我的问卷"(/my-responses)、"我的反馈"(/my-feedback)、"训练统计"(/stats)，行式链接（ChevronRight）。
- `/my-responses` 等页面保持可路由（DefaultShell 返回箭头已可用）。

### 4.9 D11 — 问卷触发接线

核查确认：`useQuestionnaire` hook、`QuestionnaireModal`、`checkQuestionnaire/submitQuestionnaire` API 均已存在，仅无页面调用。

- **before_training**：`TrainingEntry.tsx`（当前 :41-49 只显示计数文案）接入 `useQuestionnaire({caseId, trigger:"before_training"})`，有待填问卷时弹 Modal；`is_required=true` 时不可跳过（Modal 已含 skip/complete 逻辑）。
- **after_scoring**：`RecordDetail.tsx` 在 `scoring_status==='completed'` 时调 check（trigger="after_scoring"，传 record_id），有则弹 Modal。
- manual 触发暂不做入口（问卷管理页已可预览需求另议，不在本 spec）。

### 4.10 D13 — abandoned 接通

- 后端 `session.py` 新增 `PUT /training/records/{record_id}/abandon`：权限同 delete（本人或 score_review）；守卫 `status=='in_progress'` 否则 400；置 `status='abandoned'`、`end_time=now`；不触发评分；清理 initiative/emotion 缓存（同 end_training 尾部）。
- `History.tsx`：进行中记录（移动端 :226-249 / 桌面 :367-399）加"放弃"按钮（确认框"放弃后将保留对话记录但不会评分"）；状态筛选（:119-122）加"已放弃"；状态徽章渲染 abandoned → 灰色"已放弃"。
- 统计查询全部 `status=='completed'` 过滤（核查确认 7 处），abandoned 天然不入统计，无需改动。
- 作业重入（1.10 已改为永不删除）：若已有记录 status=='abandoned'，允许重开——此时创建新记录（abandoned 记录保留）。`_build_detail_view` 的最佳记录选择须排除 abandoned（除非该生只有 abandoned 记录，则显示"已放弃"状态）。

### 4.11 管理端 UX 小项

- **表单关闭确认**：CaseForm、PracticesPage Dialog、AssignmentsPage Dialog——dirty 状态下关闭（取消/遮罩/X）弹"内容未保存，确定关闭？"。react-hook-form 用 `formState.isDirty`；CaseForm 若非 RHF 则维护 dirty flag。
- **问卷删除弹窗**：`QuestionnairesTab.tsx:175-184` 文案补"将同时删除该问卷的全部学生答卷（共 N 份），不可恢复"（答卷数从后端统计接口取，或至少静态警告文案）。

### 4.12 批次四涉及迁移

- ddl：`assignments` 加 `is_closed`（bool, server_default false）
- ddl：`training_records` 加 `is_test`（bool, server_default false）
- 均需可逆 downgrade

---

## 非目标（明确不做）

- 教师-班级数据隔离（D16）
- 年级批量升级/学期切换（D24）
- 邮箱/短信自助密码重置
- 评分心跳机制、持久化队列
- 完整教学看板（趋势/难度分析）
- 消息排队预输入、软删除/回收站体系
- rubric 的完整 CRUD 管理界面（仅只读+热更文件）

## 工程约束（所有批次共同遵守）

- 迁移：DDL 进 `migrations/versions/ddl/`（禁 op.execute），数据进 `data/`（docstring 含 `# Manual override reason: data_only`）；每个迁移必须有可用 downgrade（pre-push 做 roundtrip 校验）；用 `pnpm run db:migration -- "name"` / `pnpm run db:data -- "name"` 生成。
- 后端 schema/路由变更后：仓库根 `pnpm run api:update`，禁止手改 `.gen.ts` / `openapi.json`。
- 提交格式：`<emoji> <type>: <description>`（✨feat/🐛fix/♻️refactor/🗃️db/🔥remove/✅test）。
- 测试：新行为需测试锁定（后端 pytest 定向跑域，如 `uv run python -m pytest tests/scoring/ -x -q`）；改动完成跑 `pnpm run check`。
- 前端 API 路径一律 `satisfies ApiPath`。
- 后端分层：thin router → service → repository；错误用 core/exceptions 标准词汇。

## 验收标准（按批次）

**批次一**：教师复核后学生页面总分=复核总分且明细含复核值；有复核时学生重评被拒；作业详情每生显示最高分+尝试次数；<3 条消息结束训练不产生评分；评分失败 30s 后自动重试一次；卡在 processing 超 10 分钟的记录被 settlement 自动置 failed；护理记录 3s 自动保存、结束训练不丢；作业重入不再删除任何数据；1.11 表中 9 项 bug 各有回归测试或手测项。

**批次二**：grep `advance-phase|current_phase|wechat|/notes` 在活动代码（排除迁移历史与 .gen.ts）零残留；`pnpm run check:full` 全绿；alembic roundtrip 通过；登录/训练/评分主流程手测无回归。

**批次三**：训练开始后修改病例内容，进行中会话的患者行为与最终评分不受影响；记录回顾展示训练时的病例数据；retry 评分与首评使用相同 rubric（含护理维度）。

**批次四**：练习能力开关保存后在学生训练中生效；关闭的作业学生无法开始；作业详情显示统计四项+分布；管理员可切学生视角并试跑（记录不入统计）；rubric 只读页可见且改 JSON 文件后刷新生效；管理端可重置密码并展示一次；移动端底部"我的"可达 profile/反馈/统计；训练前/评分后问卷正常弹出；进行中训练可放弃且列表可筛。
