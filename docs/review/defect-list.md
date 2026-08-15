# 不良列表（缺陷清单）— 重构行动跟踪

> 用途：重构行动（权限：前后端无限大）的缺陷跟踪清单。每条含严重度、证据、修复方向。
> 维护：主程序（firedisposal）。来源：2026-08 深度审查 + 线上实测数据。

## 新 master（9410d921，2026-08-15）复核结论

本地已 pull 到 9410d921（Mantine v9 迁移已随 43 个提交完成：9d22a99d 地基 → 58369698 全量迁移 → 87a12978 移除 Tailwind/shadcn/lucide）。复核结果：

- **后端 S/T/C/P/I 全部 36 项：仍然成立**（43 个提交仅改动 backend 10 个文件/181 行，`modules/training/scoring|pipeline`、`modules/simulations` 零改动，行号不变）。
- **前端 U 类状态更新**：
  - U1 通知中心横向滚动条：**仍存在**（`NotificationBell.tsx:177` `overflowY:"auto"` 无 `overflowX:"hidden"`；长串文本仍可撑出）
  - U2 死麦克风按钮：**按钮已删**（392c7e63，ChatInput 注释"语音输入未上线，不放无效按钮"）→ 仅剩"README 声称 TTS/ASR 而实际无 ASR"的叙事缺口，且导师方向正是 ASR——从缺陷转为路线图项
  - U3 学生结果页死按钮：**已修**（迁移时重构 RecordDetail，全前端已无 `onClick={() => {}}`）
  - U4 流式中断无重试 + 假进度：**仍存在**（`ChatBubble.tsx:148`、`ScoreManager.ts:183,193`）
  - U5 计时器"体验模式"：**仍存在**（`useTrainingTimer.ts:9,18`）
  - U6 情绪轨迹仅在 showcase + 情绪头像因论文截图停用：**仍存在**（`TrainingEngine.tsx:14,121,242,257`）
  - U7 ScoreItem 无障碍：**仍存在**（`record-review/ScoreItem.tsx:32` div onClick）

## 评分与成绩（P0 优先）

| # | 缺陷 | 严重度 | 证据 | 修复方向 |
|---|------|:---:|------|------|
| S1 | 教师复核总分公式错乱：存库 detail_scores 已 ×100/57 换算，复核却按 raw_scale=3 重算 → 不改分直接提交总分也会变成 >100 | P0 | `validation.py:204-226` + `score_review.py:60-67` + `validation.py:250-264` | 复核复用 `apply_score_mapping`；加回归测试"未改动→总分不变、总分∈[0,100]" |
| S2 | 总分只由"维度分"决定，19 项条目分是装饰（与总分无算术关系），且无"维度分==Σ条目分"校验 | P0 | `validation.py:250-265`（用 dim.score 非 items 聚合） | 总分改 Σ条目分聚合 + 强校验（不符即重试） |
| S3 | LLM 故障=0 分="评分已完成"：全空兜底存 0、Score 表无 fallback 列、照发完成通知。好对话得 0 且无法与真 0 分区分（真实学生按 1-3 分制最低 33 分） | P0 | `engine.py:677-687,449-488,667-674` + `models/training.py:94-110` + `router/scoring.py:310-318` | 0 分兜底写 `score.fallback` 并在 UI 标注；未涉及改 0 分或改"过程反馈"定位 |
| S4 | 维度静默丢失：LLM 漏一个维度 → 注入 0 分 → 总分缩水（communication 42/72 分），仅全部维度丢失才标记 fallback | P0 | `validation.py:229-233,268-280` + `engine.py:475-485` | 漏维度必须阻断重试或落库标记 |
| S5 | 教师复核从不写回 `Score.total_score` → 排行榜/平均分/作业最优分永远用 AI 原始分，复核是"摆设" | P1 | `score_review.py:65-69` + `scoreboard/service.py:148-149,245,332` + `assignments/service.py:206-209` | 复核落库时同步写回 Score（或成绩口径显式用 review） |
| S6 | force 重评"先删后算"：删旧分后再入队，新评分失败 → 已复核分数永久丢失 | P1 | `router/scoring.py:487-489` | 新分落库成功后再删旧分（两阶段提交） |
| S7 | 重评竞态：旧任务晚写撞 unique 约束 → 新评分失败但状态判 completed，静默保留旧分 | P1 | `models/training.py:99` + `engine.py:492-502` | `_persist_score` 用 record_id 幂等 upsert + 版本号 |
| S8 | 评分超时预算自相矛盾：per-stage 150s×2 重试 > 全局 180s 超时 → 超时类失败的重试必被杀。线上实测 41 次评分超时失败 | P0 | `engine.py:60` + `router/scoring.py:199,272`（注释自证） | 统一超时口径：重试总预算 ≤ 全局超时 - 余量 |
| S9 | 评分成本无闸门：max_tokens=65536+thinking、两阶段并行、全量对话无截断、重试全量重发；monthly_cost_limit 只展示不执行 | P1 | `profile.py:57-76` + `engine.py:282,545-619,239-248` + `costs.py:241-249` | 评分输入 token 预算 + 输出上限降到 8k + 预算熔断 |
| S10 | "19 项细则"叙事 vs 实际 24 项（nursing_record 全病例开启 +5 项/raw 57→72） | P1 | `rubric.py:74-78` + 10 个病例全部含 nursing_record | README/演示口径改"19–24 项"或拆出护理记录维度 |

## 训练对话与患者 AI（P0 优先）

| # | 缺陷 | 严重度 | 证据 | 修复方向 |
|---|------|:---:|------|------|
| T1 | 流式泄漏守卫失效：泄漏文本实时推给前端，纠正重试不推队列（`_emit_chunks` 死代码）→ 学生看到泄漏版，DB/回放/评分是纠正版 | P0 | `llm_caller.py:150-153,174-190` + `runner.py:117-123` + `trainingStore.ts:304-313` | 重试走队列 / 先全量生成过守卫再推送；删死代码 |
| T2 | SSE 流式重试从头重放已发 chunk → 前端重复文本、落库脏数据、污染评分输入 | P0 | `client.py:353-370` + `llm_caller.py:132-150` | 重试从断点续传或放弃重试降级一次性回复 |
| T3 | 情绪引擎 60 轮（120 条消息）后静默冻结：message_count 被截断上限卡死 → turn_id 恒同 → 永久跳过 | P0 | `chat.py:58-65` + `context.py:55-57` + `emotion_analysis.py:83-99` | turn_id 用单调轮次计数（max(msg.id)） |
| T4 | 结算循环忽略 paused_seconds → 切页暂停中的训练被按原始截止时间强制收卷 | P0 | `settlement.py:66-73` vs `timing.py:19-27` | 结算查询并入 paused_seconds + 回归测试 |
| T5 | runtime_state JSONB 读-改-写无锁 → 双击/重试产生交错消息对、查体/修正互相覆盖 | P1 | `physical_exam.py:67-87` + `persister.py:97-99` + `chat.py:196-199` | JSONB 原子合并 `runtime_state \|\| :patch` 或行锁 |
| T6 | 查体读数以"患者自知"注入 + 查体无配合门控 → "患者照旧说、从不拒绝"，与"感知检查但不自知结果"人设矛盾 | P1 | `note_source.py:79-96` + `prompts/patient.py:27` + `behavior.py:130-147` 无引用 | 读数改"待告知"；工具层加 cooperation 门控 |
| T7 | leak_guard 关键词子串匹配双向失效（误判"咯血/咳血"、漏判换词）+ 披露完全靠 LLM 自判（hidden_info 运行时未使用） | P1 | `leak_guard.py:24-47` + `prompts/patient.py:49` + `prompt_context_builder.py:124-125` | 整段历史语义判定 + 生成层结构化门控 |
| T8 | 情绪 v2/v3 双存储并存（裸名 EmotionState 是 v2 旧类）、清理不一致（abandoned/discarded 残留 v3 行） | P1 | `emotion/__init__.py:19-33` + `settlement.py:146-148` vs `scoring.py:420` | 删 v2 路径（EmotionCache/_legacy/emotion_profile）；统一清理入口 |
| T9 | FATIGUE 是假文档：analyzer 声称"系统对话后期注入"，全仓无注入；跨轮失误（重复问/打断）结构上检测不到 | P1 | `analyzer.py:100` + `events.py:63`（仅枚举） | 实现注入或删文档；分析器喂最近 N 轮历史 |
| T10 | 身份守卫误伤自然语（"继续问""你还想知道""你做得很好"）→ 整条重试并把"你在扮演"写回上下文 | P2 | `guards.py:33-35,50-51` | 黑名单只留 AI/系统术语，≥2 特征词才判泄漏 |

## 病例数据（P0——教错学生）

| # | 缺陷 | 严重度 | 证据 | 修复方向 |
|---|------|:---:|------|------|
| C1 | 病例内部矛盾且被注入患者 few-shot：case3 无呕吐 vs 示例"吐了两回"、"18小时"vs"今天早上"；case9 丈夫去世 vs "老伴扶我"、2024 年日期 | P0 | `case3.json:12-13,55-56` + `case9.json:13-14,54` + `context/examples.py:34-49` | 校验脚本：示例与病史断言无冲突（进 CI） |
| C2 | 医学硬伤：case6 三岁患儿查体"前囟平坦"（前囟 12-18 月龄闭合） | P0 | `case6.json:74`（patient_info.age=3） | 全量病例医学审核 + CI 年龄-体征校验 |
| C3 | 同患者两病例病史冲突：case2 vs diabetes_foot_quiz（李秀兰：用药/创面/病程矛盾） | P1 | `case2.json` vs `diabetes_foot_quiz.json` | 病例库去重 + 版本管理 |
| C4 | AI 生成病例（hidden_info/exam_anchors schema）与内置 10 病例（deep_background）字段世界观分裂 | P1 | `cases/generation.py:88-93` vs `case*.json` | schema 统一 + 生成后与内置病例同一校验 |

## 生理引擎 / simulations

| # | 缺陷 | 严重度 | 证据 | 修复方向 |
|---|------|:---:|------|------|
| P1 | CHF 病例容量被钳死（vol≤1.05）：监护仪全程 BP/RR/SpO2 恒定，恶化叙事说"低氧血症"但 SpO2=98；开局听诊一次+报告 = 0 检查 0 花费满分通关 | P0 | `case.py:544,943,965,671-672`（实测运行验证） | CHF 补 congestion→SpO2↓/RR↑ 耦合；crackles 改梯度 |
| P2 | 乳酸积分器校准失控：DKA/感染在中度严重度产出 pH 6.68/6.94（致死值在可救活病例中段）；DKA 酸中毒被整体建模成乳酸 | P0 | `case.py:362,432,555-557,864,904`（实测） | 乳酸上限 + pH 生理下限映射 + DKA 酮体/AG 指标 + 数值区间 CI 测试 |
| P3 | 训练模块"生理引擎"实为"范围字符串→固定中点"静态配置（无状态演化、无干预响应）；`_compute_link_offsets` 真实数据零生效 | P1 | `physical_exam_rules.py:80-83,137-165,406-423` | 诚实降级命名或会话级体征演化 |
| P4 | 查体数据三副本（runtime_state/scene.vitals 后写覆盖/TrainingAction 全量 O(N²)），评分数据源静默切换；护理诊断/quiz 评分零消费 | P1 | `physical_exam.py:68-85` + `scoring/engine.py:355-372` | 单一事实源 TrainingAction；fallback 显式告警 |
| P5 | simulations 与评分/作业/教师端完全脱钩（结局仅文本判定）；`/simulation` 不在主导航；triage 四份文档各说各话的僵尸 | P1 | `modules/simulations/*` 无 Score/Assignment 引用 + `navigation.tsx` + TODO/MEMO/roadmap | 明确产品边界或接入评分闭环 |
| P6 | simulations LLM 调用 `asyncio.run` 工作线程新事件循环复用主循环 httpx/Semaphore（跨循环风险）；全部测试 mock LLM | P1 | `simulations/router.py:44-112` + `test_talk.py:_FakeTalk` | 换 `run_coroutine_threadsafe` 或把端点改 async；补集成测试 |

## 基建 / 安全 / 运维

| # | 缺陷 | 严重度 | 证据 | 修复方向 |
|---|------|:---:|------|------|
| I1 | 对话全文明文落三处（LLMCallLog 表/溢出文件/应用日志），无保留期无脱敏 | P1 | `models/llm.py:74-75` + `logging.py:166-169,249-255` | 默认只存统计；详情二次确认；加清理任务 |
| I2 | 密钥明文存 DB/.env，无加密无轮换 | P1 | `models/llm.py:25` + `seed.py:242-248` | 应用层加密 + 轮换流程 |
| I3 | "多 Provider 路由"实为最后一条 secret 劫持全部 purpose + 单次 429 冷却 60s + env 兜底零记账零熔断 | P1 | `data.py:31-35` + `router.py:119-121,212-215,192-195` | 按 purpose 选最优绑定；429 指数退避；env 兜底入账 |
| I4 | 内存队列重启丢 in-flight 评分（已计费无结果）；metrics/错误缓冲 per-worker 进程内数字失真；error_archive 多进程无锁 | P1 | `queue.py:57,69-77` + `metrics.py:41-48` + `error_archive.py:19-31` | 队列落 DB / shutdown drain；关键计数改 DB 统计 |
| I5 | 成本记账双轨（router 用 DB key 价 vs LLMCallLog 硬编码 model 价）对不上账 | P2 | `token_counter.py:112-115` + `costs.py:69-79` | 统一计价来源 |
| I6 | 诊断 token 走 query param 进访问日志；X-Forwarded-For 盲信可绕过登录限流（学校 NAT 又误伤） | P1 | `diagnostics.py:65-76` + `rate_limits.py:68-75` | 移 Authorization header；真实 IP 取反代层；IP+账号双维度 |

## 前端 UI / 体验

| # | 缺陷 | 严重度 | 证据 | 修复方向 |
|---|------|:---:|------|------|
| U1 | 通知中心出现横向滚动条（令人厌恶的溢出）：`max-h-72 overflow-y-auto` 无 `overflow-x-hidden`，长文本（URL/英文/通知体）无 `break-words`，负 margin `-mx-4` 配圆角容器易横向溢出 | P2 | `NotificationBell.tsx:156-157,172-175` | 滚动容器加 `overflow-x-hidden`；title/body 加 `break-words`；核对 ResponsiveDialog 窄屏宽度 |
| U2 | 语音输入按钮是 no-op（`onClick={() => {}}`）；README 声称 TTS/ASR 实际无 ASR | P0（叙事）/P2（体验） | `ChatInput.tsx:59-65` | 接 Web Speech API MVP 或删按钮；README 改"TTS（ASR 规划中）" |
| U3 | 学生结果页死按钮：重试评分/导出/查看详细评分全部 `() => {}` | P2 | `RecordDetail.tsx:89-104` | 删或接真实功能 |
| U4 | SSE 流式中断只有"⚠ 回复中断"chip 无重试入口；评分伪造假进度条 | P2 | `ChatBubble.tsx:122-126` + `ScoreManager.tsx:177,187` | 中断 chip 加"重试本消息"；假进度上限 90+超时倒计时 |
| U5 | 20 分钟计时器是"体验模式"：到点不强制、离开页面暂停、评分"时间管理"无时间数据 | P2 | `useTrainingTimer.ts:18` + `session.py:623-664` | 明确硬截止/软提醒决策；评分注入真实耗时 |
| U6 | 学生端无情绪轨迹可视化（README 卖点只在 showcase）；情绪头像因"论文截图"停用 | P1（叙事） | `TrainingEngine.tsx:10-11,126-131` + 前端无轨迹图 | 在 RecordDetail 做真实轨迹图或删卖点 |
| U7 | 无障碍缺失：ScoreItem 用 div+onClick 展开（键盘不可达）、4D 微条仅 title 提示 | P3 | `ScoreItem.tsx:13-23` + `EmotionIndicator.tsx:245-272` | button 语义 + aria-expanded + sr-only |

## 线上实测数据（staging，2026-08-14 采集）

- 467 条 completed 训练记录 → 413 条有 Score（88.4%）
- **74/467 = 15.8% 的已结业训练遭遇评分故障**：41 次评分超时失败（38×"评分超时，已自动标记失败" + 3×"超过180秒"）+ 33 条 total_score=0（兜底）
- 33 条 0 分全部集中在 2026-07（某版本窗口）
- **score_reviews = 0 行：教师复核从未被使用过一次**
- 分数区间不合理实证：
  - case1（COPD，难度 1）：avg 39.9（最低）、0~93，20/33 的零分落在它身上——最简单的病例得分最低
  - case5（胸痛，难度 3）：avg 32.6、**max 仅 65**——最难病例天花板被压死，无人能上 65
  - case10（产后抑郁，难度 1）：max 72；case6（热性惊厥）：max 75
  - 全部 413 条无一条 >93，"100 分制"实际上限 ≈93
- 结论：评分故障率 15.8% + 难度/得分倒挂 + 天花板压缩 = 分数区间不合理的三重实证，均与 S1-S9 代码缺陷对应
