# Nursing VP Sim — 审计决策备忘录

> **对应报告**: `docs/audit-report-for-advanced-ai.md`
> **决策日期**: 2026-07-23
> **部署约束（用户确认）**: 单服务器、staging/prod 双容器、单 worker uvicorn（`Dockerfile.backend:22 --workers 1`）、目标并发 ~50。不考虑水平扩展。
> **方法**: 报告每项指控均经代码核实（文件:行号），先判定真伪，再给决策。

---

## 0. 核实结论速览

| 报告指控 | 判定 | 关键事实 |
|---|---|---|
| 2.1 TrainingEngine 12 个 useEffect 失控 | **部分属实** | 实际 361 行 / 11 个 effect。已是"Manager 单一真相 + React 订阅镜像"模式（StreamManager/ScoreManager/TTSManager/MessageBus 持真相，`TrainingEngine.tsx:89-91` 仅镜像），非散乱状态 |
| 2.2 三路径并发冲突 | **部分属实** | 推送实为 **WebSocket** 而非 SSE（报告措辞错误）。DB 认领已原子化（`scoring_lifecycle.py` acquire/claim 均为 `UPDATE...WHERE` + rowcount）。残余两处真实缺陷：轮询路径缺相位防回退守卫、终态写入 check-then-set 窄窗口 |
| 2.3 内存 Tracker 多 worker 失效 | **假问题** | 单 worker 部署，进程内 dict 自洽。`scoring.py:23-24` 注释仅为防御性说明 |
| 2.4 全局可变状态 | **属实但低危** | `session.py:70-75` 模块级 global + 注入，单 worker 下语义正确；`_ensure_loop` 懒加载在生产路径不触发（`main.py:246-251` 显式注入） |
| 3.1 五个超大前端文件 | **行数属实，紧急度被高估** | 见 B.5 逐个结论 |
| 4.1 组件未 memo 全量重渲染 | **已过时** | `ChatBubble` 已 memo + 自定义逐字段比较器（`ChatBubble.tsx:18-35`），`ChatDisplay` 已 memo |
| 4.2 StreamManager O(n) 重建 | **属实但无实际影响** | 已有 rAF 合帧（`StreamManager.ts:86-93`）；患者回复被 LLM 限制在 512 tokens / 1-3 句，消息总量小 |
| 4.3 joinedload 笛卡尔积 | **假问题** | 4 个关联全部 many-to-one（`session.py:454-461`），无 collection 预加载，不产生笛卡尔积 |
| 4.4 Showcase 拖累首屏 | **假问题 + 一个真发现** | showcase 路由已 lazy（`App.tsx:34`），GSAP 仅在 showcase chunk。真发现：**three.js 全家桶是死依赖**（package.json 声明但全 src 零 import） |
| 5.1 训练流程交互摩擦 | **部分已过时** | 超时倒计时早已存在（`TrainingHeader.tsx:132-153` ≤300s 变黄 ≤120s 变红 + 10s 自动结束对话框）；评分等待已是结构化卡片 + AI 思考流 + 可后台 |
| 5.3 侧栏一条竖列过载 | **已过时** | 侧栏已 4 分组（`navigation.tsx:75-80`：教学中心/人员管理/系统运维/反馈中心，可折叠 + localStorage 持久化） |
| 5.5 过滤与分页脱节 | **属实，真 bug** | `FeedbackTab.tsx:501-514`、`MyFeedback.tsx:63-74`：search/replyStatus 仅过滤当页 20 条，total 用服务端全量 |
| 5.6 关键状态无 UI 反馈 | **2/3 属实** | WS `_connected` 从不导出（`useTrainingWS.ts:29` 无消费方）属实；StreamManager 拦截静默属实（`!recordId` 路径）；authStore 白屏**大半是假问题**（zustand persist localStorage 同步水合，无异步窗口；过渡画面是路由 Suspense 的 PageLoader，已存在） |
| 6 API 类型同步缺失字段 | **根因诊断错误** | 后端 schema 与 `api-types.gen.ts` **均已包含**全部字段（max_attempts/is_closed/attempt_count 等，2026-07-21 已重新生成）。18 处 `as any` 全部是**前端过时 cast**，删除即可，无需改后端、无需重新生成 |
| 7 a11y/i18n | **属实** | `alt=""`、15 处搜索框无 label、无 i18n 框架 |
| 8 测试缺失 | **属实** | 前端 16 测试文件全部偏基础组件，训练引擎/聊天零覆盖；后端 57 个测试文件覆盖尚可 |

---

## A. 前端交互优化（最高优先级）

### A.1 训练聊天体验增强（快捷模板/对话提示/信息高亮/语音）

**[结论]**: 四项中只做"快捷问诊模板进对话"，且以练习模式 feature-gate 为限；其余三项暂缓或放弃。评分测量的是学生**无提示下**的问诊能力，任何对话内提示都在侵蚀测评效度——这是产品红线。

| 方案 | 决策 | 理由 |
|---|---|---|
| 快捷问诊模板进对话 | **限模式做（P2）** | WelcomeScreen 已有 2 条主诉相关 quick prompt（`WelcomeScreen.tsx:22-36`），开始后消失。可在练习模式（非作业/考核）的输入框上方保留 3-5 条可折叠模板条。考核模式必须无模板，否则分数失真 |
| 卡住时对话分支提示 | **不做（P3）** | "试试询问过敏史"直接泄露 rubric 评分点，且破坏沉浸感。若未来要做，应以"教师端开启辅助模式"为前提并在评分中标注辅助使用 |
| 关键信息高亮 | **后置做（P2）** | 对话中实时高亮需额外 LLM 抽取（成本+延迟），且自由文本高亮错误会误导学生。替代：查体结果已有结构化 `ExamResultCard`；在**记录详情页**（训练后复盘）做回顾性标注更便宜更安全 |
| 语音输入 | **保持现状 + 提升发现性（P2）** | TTS 自动朗读 + 引擎状态点已完整（`TrainingHeader.tsx:266-283`）。ASR 输入的使用率无数据支撑，先不追加投入；移动端把语音入口放进输入框附件区即可 |

**[风险]**: 模板/提示若进入考核路径，评分体系公信力受损——教师将无法区分"学生会问"与"系统教学生问"。

### A.2 评分等待体验

**[结论]**: 维持"前台结构化等待 + 可转后台"现状，补两个 P1 小修：轮询路径加相位防回退守卫、`scoring_failed` 后允许一键重试。"后台评分 + 通知"**已经实现**（ScoringOverlay 的"返回主页" + 完成时全局 toast，`useScoringNotifications.ts:33-52`），无需架构变更。

**[理由]**: 现状远超报告描述——等待卡片已有相位标签、百分比进度条、双栏 AI 思考流（`ScoringOverlay.tsx:187-254`），信息密度足够让等待可忍受。两个真实缺陷是：①轮询通道（`ScoreManager.ts:142-149`）拿到 `data.progress` 直接整体覆盖，缺 WS 通道的 `PHASE_ORDER` 守卫（`:245-269`），相位可被拉回；②超时/失败后只有"返回主页"，无重试入口（后端 `retry_scoring` 端点已存在，前端未接）。

**[优先级]**: P1（两个小修）；"缩短等待"本身 P3（评分 LLM 两阶段并行已优化过，单纯压缩时间不现实）。

**[风险]**: 无。防回退守卫是纯前端逻辑，与后端同源数据方向一致。

### A.3 移动端策略

**[结论]**: 训练页 mobile-capable 保持现状（已合格），管理后台 desktop-first 明确化，不追加投入。

**[理由]**: 训练页已是沉浸式零 chrome（ImmersiveShell）+ 底部工具栏 + Bottomsheet（`SceneToolbar.tsx`），倒计时/输入/工具均可用。后台侧栏移动端已折叠为汉堡菜单，13 个子页面中仅 2 个用了 ResponsiveTable——但教师批改/复核是桌面场景，50 并发规模的运维操作同样在桌面。建议仅在后台移动端访问时加一行轻提示"建议使用桌面端获得完整体验"，不做强制。

**[优先级]**: P3（仅加提示）；不做移动端 ScoreCard 信息密度重构（现有卡片窄屏可读）。

### A.4 全局状态反馈（连接状态 Indicator）

**[结论]**: 复用现有 TTS 状态点模式，在训练 Header 的计时器旁加一个 WS 状态点（绿/黄/灰），不做顶部状态条。StreamManager 拦截加 toast；authStore 白屏不修。

**[理由]**: WS 承载查体/护理记录/评分推送三条工具车道，断连时学生点工具无反应且不知道为什么——一个直径 8px 的状态点 + hover 文案即可闭合此反馈环（实现：`useTrainingWS.ts` 导出 `_connected` 订阅，约 20 行）。顶部状态条对单页训练场景过重，且与 NetworkBanner（`navigator.onLine` 物理断网）职责重叠。StreamManager 的 `!recordId` 静默丢弃（`StreamManager.ts:136-140`）加一行 bus `stream:error` 即可复用现有 toast 通道。authStore 是 localStorage 同步水合，不存在异步白屏窗口，PageLoader 已覆盖路由切换。

**[优先级]**: P1（WS 状态点 + send 拦截 toast，合计 <50 行）；authStore P3 不修。

**[风险]**: WS 状态点可能引发"为什么变黄"的咨询——配 hover 文案"实时连接中断，工具暂不可用，正在重连"。

---

## B. 组件/页面信息架构

### B.1 管理后台侧栏分组

**[结论]**: 现状已合格（4 分组可折叠），仅把"反馈中心"（仅 1 项）并入"教学中心"或改为顶级链接，消除单元素分组。

**[理由]**: 报告基于过时信息。`navigation.tsx:75-80` 已有教学中心（6 项，默认展开）/人员管理（3）/系统运维（3）/反馈中心（1）四组，NavGroup 支持折叠持久化。唯一异味是反馈中心只有"用户反馈"一项，分组标题比内容还重。

**[优先级]**: P3。

### B.2 反馈管理工作流

**[结论]**: 保持"列表 + 卡片内联回复"单页模式，**不修路由**；把两张 recharts 图表（周趋势 + 评分分布）折叠为默认收起的"统计概览"区，列表上移。**真正要修的是过滤-分页脱节 bug（P1）**。

**[理由]**: 反馈处理是"扫列表 → 点开回复 → 下一条"的高频短循环，独立详情页/抽屉只会增加点击深度。636 行的问题不在架构而在图表抢占首屏（`FeedbackChart` + `RatingPieChart` 占 250 行）。过滤 bug 的正确解法是**服务端过滤**：给 `GET /admin/feedback` 加 `search`（content ILIKE）和 `replied` 参数——bot 端点已有 `replied` 先例（`feedback.py:223`），照抄即可；MyFeedback 同理加 `tag`/`replied` 服务端参数。顺手修 tag 切换不重置 offset 的附带 bug（`FeedbackTab.tsx:605`）。

**[优先级]**: 过滤 bug **P1**（用户可见的错误分页）；图表折叠 P2。

### B.3 作业创建：Modal vs 独立页

**[结论]**: 保持 Modal，不做独立页面。

**[理由]**: 创建字段仅 7 个（title/desc/caseId/classId/start/end/maxAttempts），已有 react-hook-form + zod 校验和 CaseSelector 命令面板（`AssignmentsPage.tsx:395-566`），一步到位无向导需求。独立页面适合多步骤/富文本/预览场景，均不适用。569 行的规模问题由 stale cast 和行内组件造成，不由 Modal 造成。

**[优先级]**: P3（不动）。

### B.4 统计页双视图策略

**[结论]**: 保持"同页按角色条件渲染"，默认 period=month（近30天）不变。

**[理由]**: `Stats.tsx` 实现已合理：学生见个人 4 卡 + 2 图，教师额外汇总表 + 排名表（`enabled: hasTeacherView` 门控查询）。拆两个独立页面会重复 80% 图表代码。教师在此页看"全局"，在训练记录页看"个体"，职责清晰。

**[优先级]**: P3（不动）。

### B.5 五个超大文件拆分结论

| 文件 | 结论 | 优先级 |
|---|---|---|
| FeedbackTab (636) | 修过滤 bug 时顺手把 2 个图表组件拆到 `admin/feedback/` 子目录，文件自然降到 ~350 行 | P1（随 bug 修） |
| TeacherRecordsPage (578) | **先修正确性**：排序和统计目前只作用当页 50 条（`:115-173`），教师看到的"平均分/完成率"是当前页而非全量——改服务端排序 + 服务端聚合。然后照抄 `users/` 域已验证的 `useUserList/useUserMutations` hooks 模式拆分 | **P1**（正确性）；拆分 P2 |
| AssignmentsPage (569) | 删 7 处 stale `as any`（改用 `Schemas["AssignmentListItem"]` 等生成类型），不拆 | **P0**（半天内的 quick win） |
| Stats (513) | 不拆 | P3 |
| AssignmentDetailPage (378) | 删 11 处 stale `as any`（类型已全部存在于 gen 文件），不拆 | **P0** |

---

## C. 架构优化

### C.1 TrainingEngine 状态机重构

**[结论]**: 不引入 xstate，不做 useReducer 大重构。保持"Manager + Bus"现状，仅做一项 P2 收敛：把散落的训练生命周期信号（`trainingEnded` state + ScoreManager phase + record.status）在引擎内合并为单一 `TrainingPhase` 派生值。

**[理由]**: 核实显示现状并非报告暗示的混乱——副作用全部封装在 4 个命令式 Manager 中，React 层只是订阅镜像，effect 之间无连锁触发（依赖各异且多为 recordNum 一次性初始化）。xstate 的显式转换图对"idle→active→ended"这种低分支线性流程是杀鸡用牛刀，且要把 WS/SSE/TTS 四条通道塞进 actor 模型，迁移成本以周计。React 19 的 `useActionState`/`useOptimistic` 在此场景无着力点（发送已有 disabled 态，无表单 action 模式）。报告问"useEffect 有没有实际产生过 bug"——从 git log 看近期训练相关 fix 集中在后端评分与消息持久化，前端引擎无 bug 记录，证实这是审美问题。

**[优先级]**: 大重构 P3（不做）；TrainingPhase 派生收敛 P2（顺手做，~30 行）。

**[风险]**: 若未来训练流程加入多阶段场景切换（如 triage→问诊→处置的阶段机），届时再评估 xstate 不迟。

### C.2 评分并发一致性

**[结论]**: 唯一真相源 = DB 的 `scoring_status` + Tracker（同源写入），WS 推送为主、轮询兜底保留。做两个小而硬的后端修复：终态写入改条件 UPDATE、失败处理改条件 UPDATE。不加 Redis、不加 version 字段乐观锁。

**[理由]**: 认领链路已原子化（acquire/claim 的 `UPDATE...WHERE` + rowcount 已防住重复执行），残余窗口只有两处 ORM check-then-set：`scoring.py:265-274`（worker 完成后 refresh→判 pending→赋 completed）和 `scoring.py:160-165`（失败处理）。改成 `UPDATE ... SET scoring_status='completed' WHERE id=:id AND scoring_status='processing'` 风格 + rowcount 校验即闭合窗口，每处 ~10 行。单 worker + 50 并发下，乐观锁/version 字段是纯仪式性复杂度。前端侧配合 A.2 的轮询防回退守卫，三路径冲突即全部消解。

**[优先级]**: P1。

**[风险]**: 条件 UPDATE 需覆盖 settlement 清扫路径（`settlement.py:98-115`）同一模式，一并改。

### C.3 全局可变状态（session.py globals）

**[结论]**: 不重构为 app.state/DI，仅删除死代码 `repositories/training.py:101 update_scoring_status`（全仓无调用方）。

**[理由]**: 单 worker 下模块级 global 与 app.state 语义等价；`_ensure_loop` 懒加载在生产路径不触发（lifespan 显式注入）。重写注入链路牵动 main.py/tests/conftest，收益仅为风格统一。50 并发规模下这是教科书级的"能用就行"合理取舍。

**[优先级]**: P3（仅删死代码，随其他改动顺手）。

### C.4 API 类型同步

**[结论]**: 短期 = 删除全部 18+1 处 stale cast（P0 quick win）；加固 =  biome 对 `src/pages/admin/**` 和 `src/components/admin/**` 开启 `noExplicitAny`（suspicious 规则），让 stale cast 在 lint-staged 阶段被拦。长期 = **不迁移 tRPC/TanStack Start**。

**[理由]**: 根因不是后端缺字段也不是生成器漏——gen 文件 2026-07-21 已含全部字段，是前端 cast 写于字段生成之前且无人清理。openapi-typescript 9607 行生成文件工作良好，CI 已有 `check:api` 门禁；tRPC 迁移意味着废弃整个 FastAPI 生态（自动生成 OpenAPI、bot API、diagnose 端点全部重写），收益仅为省掉一个本就正常的生成步骤，投入产出比为负。

**[优先级]**: 删 cast **P0**；biome 规则 P1；tRPC 永不。

---

## D. 性能优化

### D.1 React.memo / Compiler

**[结论]**: 什么都不做。不启用 React Compiler，不补 memo，不引入虚拟列表。

**[理由]**: ChatBubble 已 memo + 自定义比较器，流式时只有 streaming 气泡重渲；消息量有界（训练 20 分钟、学生输入 ≤2000 字、患者回复 1-3 句/512 tokens），长对话虚拟化无对象。React Compiler 对这个项目是"为解决过的问题再买一份构建复杂度"——memo 覆盖已到位，且 Compiler 与 motion/react、GSAP 的边界行为需要回归验证，风险自负不划算。

**[优先级]**: P3。

### D.2 StreamManager O(n) 重建

**[结论]**: 不改。

**[理由]**: 已有 rAF 合帧（每帧最多一次通知），单条患者回复被 LLM 限制在 512 tokens 内（≈300-500 中文字），每 chunk 的 O(n) map 在 n<100 消息、单消息 <1KB 时是纳秒级开销。1000+ 字符卡顿的前置条件在本产品不存在。Immer/可变数组重构是零收益改动。

**[优先级]**: P3。

### D.3 joinedload → selectinload

**[结论]**: 不改。

**[理由]**: 4 个关联全部 many-to-one，无笛卡尔积；joinedload 对 many-to-one 是单次 JOIN 优于 selectinload 的多次查询。报告前提不成立。

**[优先级]**: P3。唯一例外：`services/record.py:20-25` 导出路径已在用 selectinload + yield_per(100)，导出大数据量时保持现状即可。

### D.4 其他性能发现（调查新产出）

**[结论]**: 删除 three.js 死依赖（`three`、`@react-three/fiber`、`@react-three/drei`、`@react-three/postprocessing`），清理 `Admin.tsx:64-124` 的 AdminLegacy 死代码。

**[理由]**: 四个包零 import，纯占据 node_modules 与 lockfile 体积；AdminLegacy 全仓无引用。

**[优先级]**: P2（各 5 分钟）。

---

## E. 工程质量

### E.1 测试投资优先级

**[结论]**: 顺序 = ①ScoreManager/StreamManager 纯逻辑单测（P1）→ ②后端评分生命周期并发用例（P1）→ ③训练主流程 Playwright E2E 一条链路（P2）。LLM mock 用 httpx 层录播 replay。

**[理由]**: ScoreManager（281 行，相位机/防回退/假进度/超时）和 StreamManager（249 行，合帧/拦截/错误路径）是无 DOM 依赖的纯类，单测性价比全仓最高，且正好覆盖本次确认的 C.2/A.2 修复。后端补 scoring_lifecycle 的条件 UPDATE rowcount 用例（pytest 现有 57 文件的基础设施直接复用）。E2E 只做"登录→选病例→发 3 条消息→结束→看到评分卡片"一条金链路，覆盖报告指出的引擎零覆盖盲区，超出此范围的 E2E 对单人维护是负资产。LLM mock：项目已有 DeepSeek 客户端封装，在 httpx transport 层做 cassette 录播最贴合，不引入 fake server 进程。

**[优先级]**: 如上。

### E.2 技术债偿还节奏

**[结论]**: 采用"触碰到即合规"的渐进策略：每季度选 2-3 条 ruff 规则对 `contexts/` 新代码启用（从 ANN 返回类型开始），os.path→pathlib 只在编辑到的文件内顺手迁移。不做专项清理月。

**[理由]**: 70+ 压制规则、100+ 处 os.path、196 个缺注解——全量清理约等于重写，单人项目的功能是活的，债是静的，专项清理的机会成本是真实用户需求。lint 规则逐目录启用可借助 ruff 的 per-file-ignores 反向配置（新目录无豁免），成本趋近于零。

**[优先级]**: P3（机制建立 P2：在 pyproject 加 per-directory 豁免结构，一次 30 分钟）。

### E.3 配置治理（硬编码值）

**[结论]**: 前端建单一 `src/config/limits.ts` 收纳全部运行时常数（POLL_INTERVAL/MAX_RETRIES/MAX_TTS_LENGTH/STREAM_IDLE_TIMEOUT/AUTO_END_COUNTDOWN 等）；**不做后端动态下发**；20 分钟限时维持现状（已按 case/practice 逐记录下发，链路正确）。

**[理由]**: 核实确认这些值全部是就地字面量，前端无 config 文件。但 50 并发 + 单租户教师的场景下，"管理员后台调轮询间隔"是伪需求——这些值调整的正确触发方式是改代码发版（有 CI 兜底），不是运行时配置。唯一例外是训练限时，而它已经是数据驱动（case.time_limit_minutes → 记录下发），恰好证明：该数据驱动的早已数据驱动，剩下的都是构建期常数。

**[优先级]**: P2（建文件 + 替换引用，约 1 小时）。

---

## 附录 A：学生端 UX 现状图谱（亲自核实）

```
入口 A（自主练习）: /training 病例列表 → 点卡片"开始训练"（无确认，直接建记录）→ /training/:id
入口 B（作业）:    /home 作业卡片"开始练习"（无确认；已有进行中记录则后端复用）→ /training/:id
训练中:           Header(患者信息+倒计时[≤5min黄/≤2min红]+TTS状态点+结束按钮)
                  ├ 桌面: ChatArea + 右侧图标栏(SceneRenderer) → 可拖拽悬浮工具面板
                  └ 移动: ChatArea + 输入框上方工具条(SceneToolbar) → Bottomsheet
结束:             手动(确认弹窗，显示已发消息数) / 超时(10s 倒计时弹窗自动结束)
评分:             ScoringOverlay(相位+进度条+双栏AI思考流) ─可"返回主页"转后台─→ 完成 toast
结果:             ScoreCard(总分环+维度条+细分子项全展开+优势/改进/遗漏/建议) → /record/:id
```

**真实摩擦点（按严重度排序）**:
1. **续训发现性**（P1）：TrainingSelect 无"上次未完成"提示，入口藏在首页"继续训练"按钮和 History 页。学生在病例列表看到"开始训练"会疑惑是否开新记录。→ 设计：病例卡片若存在该病例 in_progress 记录，主按钮变为"继续训练"并附"放弃重来"次级入口。
2. **WS 断连无感**（P1）：工具点击无反应无解释。→ A.4 状态点。
3. **考核完整性 vs 辅助**（产品红线，见 A.1）。
4. 评分结果无历史对比（P2）：ScoreCard 是单次快照。→ 在 /record/:id 详情页加"近 N 次同病例得分趋势"迷你图，而非塞进 ScoreCard 打断完成时刻。
5. 草稿不保存（P3）：训练中刷新丢输入框内容。20 分钟限时场景下重写成本可接受，不做。

**不做清单（防 scope 蔓延）**: 对话内提示、虚拟列表、语音波形可视化、训练页深色模式、移动端 ScoreCard 重构。

## 附录 B：教师端 UX 现状图谱（亲自核实）

```
侧栏（已分组）: 教学中心[病例库/作业管理/教学看板/训练记录/评分标准/问卷管理]
               人员管理[用户/角色/班级]  系统运维[成本/运维仪表盘/系统通知]  反馈中心[用户反馈]
高频回路:      训练记录(筛选→排序→点行→复核评分) / 作业管理(列表→Modal建改→详情页看完成率)
              / 用户反馈(列表→卡片内联回复)
```

**真实问题（按严重度排序）**:
1. **反馈过滤分页脱节**（P1，真 bug）：见 B.2。
2. **训练记录页统计误导**（P1，正确性）：当页 50 条的"平均分/完成率"被呈现为全局统计；排序同样只排当页。→ 服务端 ORDER BY + 聚合查询。
3. **18+1 处 stale `as any`**（P0）：见 C.4。顺带产出：AssignmentsPage 的本地 `AssignmentRow` 接口删除，统一用生成类型。
4. 反馈图表抢首屏（P2）：见 B.2 折叠方案。
5. 反馈中心单元素分组（P3）：见 B.1。

**不做清单**: 侧栏二级分组再设计（已分组）、作业创建独立页、统计页拆角色双页、后台移动端适配。

---

## 优先级路线图

**P0（立即，合计约半天）**
- 删除 AssignmentsPage 7 处 + AssignmentDetailPage 11 处 + TeacherRecordsPage 1 处 stale `as any`

**P1（本迭代）**
- 反馈/我的反馈：服务端 `search`/`replied`/`tag` 过滤参数（前后端）+ tag 切换重置 offset
- TeacherRecordsPage：服务端排序 + 服务端聚合统计
- 评分并发：终态/失败写入条件 UPDATE（scoring.py 两处 + settlement.py）+ 前端轮询 PHASE_ORDER 防回退守卫
- 评分失败 UX：ScoringOverlay 接 `retry_scoring` 一键重试
- WS 状态点 + StreamManager 拦截 toast
- TrainingSelect 续训入口（继续训练/放弃重来）
- ScoreManager/StreamManager 单测 + 后端评分生命周期并发用例
- biome `noExplicitAny` 对 admin 目录启用
- `useTrainingWS.ts:62` onerror 空函数补日志（报告已列、实测仍未修）

**P2（下迭代）**
- 练习模式快捷模板条（feature-gated）/ 记录详情页历史对比迷你图 / 关键信息回顾性标注
- 反馈图表默认折叠 + FeedbackTab 拆子目录 / TeacherRecordsPage 按 users 域 hooks 模式拆分
- `src/config/limits.ts` / 删 three.js 死依赖 + AdminLegacy 死代码 / a11y 顺手修（alt、搜索框 aria-label）
- 训练金链路 Playwright E2E 一条
- TrainingPhase 派生收敛 / pyproject per-directory 豁免结构

**P3（暂缓/不做）**
- xstate、useReducer 大重构、app.state 重写、Redis、乐观锁、tRPC 迁移、虚拟列表、React Compiler、StreamManager/ joinedload 改动、后台移动端、i18n、专项技术债清理、对话内提示、后台动态配置下发
