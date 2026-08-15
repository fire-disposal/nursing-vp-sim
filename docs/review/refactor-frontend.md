# 前端收敛与 ASR/电话方向（Phase 5）

> 基线：9410d921（Mantine v9 全量落地，Tailwind/shadcn/lucide 已移除，零残留）
> 缺陷映射：defect-list.md U1、U4、U5、U6、U7（U2 死按钮已删、U3 死按钮已修）。已定决策：D5 硬截止（附录 A）、D6 实验室轨道（附录 B）。

---

## 1. 定位与洞察（前端在单人开发中的角色）

**业务需求**：核心体验 = 训练页（对话→查体→评分→结果）。前端是所有用户（学生/教师）唯一感知层，"收敛、稳定、核心体验优秀"的第一落点就是训练页的 5 个 U 类缺陷。

**形态适配（单人 + AI 辅助 + 自动化 + 快反）**：
- Mantine 迁移已完成且干净（主题 token 已业务化、零 Tailwind 残留）——**不要在已收敛的地基上再动刀**；前端工作的 80% 是"按清单修 U 类 + 立门禁"，不是重构。
- AI 辅助的价值在**测试即规格**：前端已有 vitest + testing-library 基建，每个 U 类修复 = 1 个测试名（文档 §4 已列），AI 代理按红→绿执行，快反靠测试回归而不是人肉点页面。
- 快反：U 类全部是低风险单点修复，可随时随发（staging 直推，无需长分支）。

## 2. 现状盘点（9410d921 实测）

| 项 | 状态 |
|---|---|
| 组件库 | Mantine v9（core/form/hooks/modals/notifications/spotlight） |
| 主题 | `theme/index.ts`：临床青绿 brand 10 阶色板、slate 暗色、tabular-nums、autoContrast、respectReducedMotion——**已冻结，禁止再漂移** |
| shim 层 | `components/ui/` 21 个（全部为 Mantine 复合组件，非 headless shim）；用量见 §3 |
| 残留 | 零 Tailwind 工具类、零 lucide、零 `onClick={() => {}}`（U3 已修） |
| 仍存在 | U1 通知中心横向滚动条、U4 中断无重试+假进度、U5 计时器体验模式、U6 情绪轨迹缺失+论文截图停用情绪头像、U7 ScoreItem 无障碍 |

## 3. shim 层收敛审计（21 个，按用量分类）

> 原则：**高用量/复合组件保留并标准化；低用量薄包装评估合并；不做无谓删除**（单人开发下每个删除都要有测试背书）。

| 分类 | 组件（用量） | 处置 |
|---|---|---|
| 高频复合（保留 + 加测试） | `page-header`(22)、`empty-state`(22)、`card`(17)、`confirm`(16)、`pagination`(13)、`stat-card`(11)、`search-input`(10)、`data-table`(5)、`role-badge`(3) | 冻结 API；补 1-2 个冒烟测试（防 AI 修复回归） |
| 平台适配（保留，已正确） | `responsive-dialog`(2)+`sheet`(2)+`bottomsheet`(1)（桌面 Modal/移动 Sheet 自适应） | 保留；U1 修复在此层 |
| 低用量/薄包装（评估合并） | `error-display`(2)、`filter-toolbar`(1)、`chart-tooltip`、`auth-image`、`mode-toggle`、`form-message-banner`、`loading-skeleton`、`responsive-table`、`input-group`、`label`、`separator`、`switch`、`tabs`、`checkbox`、`input`、`select`、`button`、`badge`、`table`（若有直用 Mantine 等价的） | 逐个核对：直通 Mantine 的薄包装 → 删除调用点直用；带业务逻辑的保留 |

**门禁**（写进 `AGENTS.md` 前端节）：新组件必须基于 Mantine 原语或既有 shim；禁止引入新 UI 依赖（除非评审通过）；组件必须键盘可达（UnstyledButton/Button 语义）。

## 4. U 类修复清单（文件级 + 测试名）

### U1 通知中心横向滚动条（P2）
- 文件：`components/NotificationBell.tsx:177`（Box `overflowY:"auto"`）+ `pages/NotificationInboxPage.tsx`（若有同类问题一并查）。
- 修复：滚动容器加 `style={{ overflowX: "hidden" }}`；title/body 的 Text 加 `style={{ overflowWrap: "anywhere" }}`（URL/英文长串断行）；核对 ResponsiveDialog 在窄屏的 maxWidth 行为。
- 测试：`NotificationBell.test.tsx` 断言长 URL 通知体不产生横向滚动（jsdom 中检查 `scrollWidth <= clientWidth` 的近似断言或用 style 断言）。

### U4 流式中断无重试 + 假进度（P1）
- 文件：`components/training/ChatBubble.tsx:148`（"⚠ 回复中断"chip）、`engine/ScoreManager.ts:183,193,252-253`（`_applyFakeProgress` 上限 95）。
- 修复：中断 chip 加"重试本消息"按钮（复用 `correctLastMessage` 通道——后端已支持替换最近一轮）；假进度上限 95→90，且 90 后显示"评分耗时异常"文案 + 60s 超时倒计时（触发"可手动重试"入口）。
- 测试：`ChatBubble.test.tsx`（中断态渲染重试按钮）；`ScoreManager.test.ts`（假进度封顶 90）。

### U5 计时器硬截止（D5，联动后端附录 A）
- 文件：`components/training/TrainingHeader.tsx:66-70`（toast"可以继续对话"→ 改自动结束）、`hooks/useTrainingTimer.ts`（归零触发 onTimeUp 后进入"结束中"态）。
- 修复：onTimeUp → 禁用输入 + 调 `onEnd()`（自动提交）；失败回退 toast + "重试结束"按钮；`useTrainingTimer` 归零后停止递减并暴露 `expired` 状态。
- **依赖**：后端 `execution_deadline`（附录 A.3）先落；前端到点行为与后端 409 守卫互备（前端到点自动结束；后端 409 兜底）。
- 测试：`useTrainingTimer.test.ts`（归零 → onTimeUp 一次；enabled=false 不触发）；`TrainingHeader.test.tsx`（时间到 → onEnd 被调用）。

### U6 情绪轨迹与论文截图停用（P1 叙事）
- 决策二选一（推荐 a）：
  - (a) 在 `pages/record-detail/RecordDetail.tsx` 新增"情绪轨迹"区块：聚合 `EmotionEvent` 时间线（后端 `repository.py` 已有事件表），Mantine `LineChart`（recharts 已移除则用 Mantine Charts 或轻量 SVG）展示 trust/anxiety 曲线 + 事件标注（"共情+0.04"）；
  - (b) 从 README 核心能力删除"轨迹可视化"。
- 情绪头像：`engine/TrainingEngine.tsx:14,121,242,257` 的"论文截图停用"注释——若保留静态头像，把注释改为产品决策说明（"情绪头像为实验特性，当前使用稳定静态头像"），**删除"论文截图"措辞**（叙事正当化）。
- 测试：`RecordDetail.test.tsx`（情绪区块渲染 + 空态）。

### U7 ScoreItem 无障碍（P3）
- 文件：`components/record-review/ScoreItem.tsx:32`（div onClick 展开）。
- 修复：改 `UnstyledButton`（Mantine）或 `button` + `aria-expanded`；4D 微条（`EmotionIndicator`）加 sr-only 文本（"信任 62%"）。
- 测试：`ScoreItem.test.tsx`（键盘 Enter 展开；aria-expanded 翻转）。

## 5. 前端测试纪律（AI 辅助开发的红绿灯）

- 所有 U 类修复**先写测试再实现**（§4 已给测试名）；测试必须能在 `pnpm test` 单测级跑通（jsdom，不依赖后端）。
- 训练页冒烟清单（快反回归用，手动 3 分钟）：开始训练 → 对话 3 轮 → 查体 2 项 → 结束 → 看评分 → 复核 → 结果页导出。每次 U 类合入 staging 后跑一遍。
- 组件库升级（Mantine minor）必须过全量前端测试 + 冒烟清单，禁止裸升级。

## 6. ASR/电话方向（D6 实验室轨道，深度设计）

> 定位：技术尝试，与核心训练隔离；在 `refactor-tools.md` 的 HTTP 指令面落地后承接（工具/通话都走 HTTP 指令）。

### 6.1 组件架构（与 Mantine 解耦）
```
src/call/
  CallShell.tsx        # 通话外壳：状态机 UI（idle→dialing→live→ended）+ 顶部计时/静音/结束
  CallStateMachine.ts  # 纯状态机（学 simulations/engine.py 的确定性 + revision）
  useCallSession.ts    # HTTP 指令面客户端（POST /api/call/session/{id}/actions）
  VADWaveform.tsx      # 音量波形（canvas，自绘，无三方依赖）
  TranscriptRegion.tsx # 转写流（服务端推送，WS 事件通道）
```
- Mantine 只承担外围（Modal 来电/通知、Timeline 通话记录、Button 控件），**通话核心状态与波形不依赖组件库**——组件库迁移永远不绑架通话层。

### 6.2 后端 CallSession（复用 simulations 语义）
- `CallSession` 状态机：`wait/clock` 语义直接复用 `simulations/engine.py` 的 `_schedule/_advance` 模式（半双工对讲 = 说话/聆听切换即 wait/中断）；
- 指令面：`POST /api/call/{session_id}/actions`（对齐 `refactor-tools.md` 的 cmd 格式：`{cmd: "call.speak", params: {audio_ref|text}, revision}`）；
- ASR 接入点：`infra/asr/`（新）——provider 抽象（`WebSpeech` MVP / `volc` 流式），与 `infra/tts` 同构（circuit/retry/logging 复用）；
- 转写事件：走 RealtimeHub（WS 事件通道），不进 WS 工具协议（已迁 HTTP）。

### 6.3 落地顺序（快反，3 步）
1. **Web Speech MVP**：`ChatInput` 复活语音按钮（`onClick` 接 `webkitSpeechRecognition`），转写文本直接进输入框——零后端，当天可上 staging，兑现"语音输入"叙事；
2. **CallShell 原型**：半双工对讲（录→发→等→听），后端 `CallSession` 最小状态机，sessions 存 JSONB（复用 simulations 的 state 模式）；
3. **volc ASR 流式 + 电话体验**：接 `infra/asr`，README 叙事升级为"语音交互—TTS + ASR"。
- 边界（书面确认）：不做 PSTN；不做多人通话；通话不计入训练成绩（D6 隔离）。

### 6.4 README 叙事对齐（本次即可做，零代码）
- "语音交互 — 火山引擎 TTS/ASR" → "语音交互 — TTS 语音合成（ASR 实验室规划中）"，上线后补。

## 7. 验收

- 全前端无横向滚动条（U1 回归）；训练页中断可一键重试（U4）；到点自动结束且与后端 409 守卫一致（U5）；情绪轨迹存在或 README 已删卖点（U6）；ScoreItem 键盘可达（U7）；
- shim 收敛后 `components/ui` 数量下降且无死代码（grep 零引用清零）；
- 语音按钮（Web Speech MVP）在 Chrome 桌面可用，转写进入输入框；
- 全部前端测试绿 + 训练页冒烟清单过。
