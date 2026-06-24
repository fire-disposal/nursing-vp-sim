# 展示落地页（Showcase Landing）设计文档

**日期**: 2026-06-24
**分支**: `feat/showcase-landing`
**定位**: 面向演示 / 评审 / 对外展示的技术亮点展示页（audience C）
**Design Read**: 技术亮点展示页，临床科技感语言，适度炫技（视差滚动 / 滚动驱动动效），分寸与和谐优先。复用项目现有 Tailwind v4 + shadcn 风格 token + lucide 图标，动效用 **CSS 原生 scroll-driven animations + IntersectionObserver**，**不引入任何新依赖**。

> 重要：所有技术亮点已按当前 HEAD 真实代码核对（见 §11 核对记录）。git 历史中已废弃的特性（如旧"插件化/manifest 自动发现"框架）**不得**作为亮点。

---

## 1. 目标与非目标

### 目标
- 在现有前端 SPA 内新增一个**公开、匿名可访问**的展示页，突出系统**真正落地**的技术创新点。
- 快接入、小成本：**不动** nginx / Dockerfile / CICD，跟随下一个 tag 一起上线。
- 视觉适度炫技（视差滚动、CSS 滚动驱动动效），贴合系统主题（护理 + LLM 虚拟患者），达到"亮眼且和谐"的展示效果。

### 非目标（明确排除）
- 不做严肃 SEO / SSR / 预渲染（CSR 路由即可）。
- **不引入新依赖**：动效用 CSS 原生 `animation-timeline` (`scroll()` / `view()`) + IntersectionObserver，**不加 GSAP / Motion / 新字体 / 新图标库**。
- 不改后端、不改 API、不需 `api:update`。
- 暗色模式独立适配非必需（用语义 token 自然继承，不单独投入）。
- 真实系统截图本期不交付——使用**用户授权的占位符**，后续替换。

---

## 2. 受众与内容取舍

受众为演示 / 评审场景，内容以"真实落地的技术创新点"为主线。**全部以当前 HEAD 代码为依据**（README 滞后、git 历史含废弃特性，均不直接采信）。

### 主线叙事（concept spine）
> 把 LLM 真正做成"可教学、可评估、可观测"的虚拟患者系统——流式管道引擎承载多模态交互（文本 / 语音 / 情绪），透明化 AI 评分给出可解释结果，教材 RAG 让知识可溯源。

### 六大核心亮点（已逐项核对，措辞贴合真实实现）
1. **训练引擎架构** —— **六阶段流式处理管道**（守卫→转换→提示→LLM→持久化→副作用）+ 按特性开关装配的 **5 个训练面板**（问诊 / 查体 / 护理记录 / 情绪 / 自主反馈）。证据：`backend/contexts/training/pipeline/builder.py`、`frontend/src/components/training/panels/index.ts`。
   > 注意：不提"插件 / manifest / 自动发现"，旧框架已移除（commit `27d0b640`）。
2. **LLM 虚拟患者对话 + 自主反馈** —— 角色扮演 + 隐藏信息逐步披露 + **患者主动追问**（LLM 生成 + 规则兜底，按等待时长 / 信任 / 舒适度触发，指数退避自动停止）。证据：`backend/contexts/patient/initiative.py`、`frontend/.../panels/initiative/InitiativeTab.tsx`。
3. **患者情绪系统** —— **6 种情绪状态**（沉默回避 / 防御抵触 / 焦虑不安 / 正常配合 / 放松友好 / 开放信任，基于信任-舒适二维模型，LLM 逐轮分析驱动）+ 立绘情绪变体（8 类患者，约 40 张素材实时联动）。证据：`backend/contexts/patient/emotion.py`、`frontend/src/utils/patient-portrait.ts`、`frontend/src/assets/avatars/`。
4. **语音交互** —— 火山引擎 TTS / ASR（SeedTTS 2.0 + BigASR WS 流式），情绪联动音色、双路提供方（火山 + 浏览器兜底）、熔断与优雅降级。证据：`backend/routers/tts.py`、`backend/routers/asr.py`、`frontend/src/engine/tts/`。
5. **流式自动评分 + 透明化** —— SSE 逐项进度 + **双面板 LLM 思考过程展示**（评分 + 反馈并行）+ **19 项**证据化反馈（沟通技能 14 + 病史采集 5，每项附对话证据与评分理由）。证据：`backend/contexts/training/score_engine.py`、`backend/data/rubrics/nursing_history_v1.json`、`frontend/.../scoring-display/`。
6. **教材知识库 RAG** —— **关键词 / IDF 加权检索** + 层级章节浏览（作为 **LLM Tool Calls** 暴露）+ 引用出处可溯源（点击查看教材原文）。证据：`backend/infrastructure/rag/`、`backend/contexts/qa/`。
   > 注意：**非 pgvector / 非向量相似度**；embedding 列存在但未用于检索，措辞不得提"向量检索"。

### 工程化底座（紧凑条带，1 段，不展开为独立特性页）
多 Provider 路由（优先级加权 / 熔断 / 限流 / 月度成本上限 / env 回退）、流式 SSE、LLM 调用日志 + 统一成本面板（LLM + 语音）、**运维面板 + 自动告警阈值**（成功率 / 错误数 / 卡住评分 / 活跃会话）。证据：`backend/infrastructure/llm/router.py`、`backend/routers/ops.py`、`backend/routers/admin_voice.py`。
> 取舍理由：体现工程成熟度，但对演示受众冲击力弱于六大亮点，压缩为可信度背书，不稀释主线。

### 技术栈条带
React 19 / FastAPI / PostgreSQL / SQLAlchemy / Alembic / DeepSeek / 火山引擎 TTS·ASR。（**不含 pgvector**。）

### 数字使用纪律
仅用真实数字（19 项评分维度、6 种情绪状态、8 类患者、5 个训练面板、六阶段管道）。**禁止**编造精确指标（准确率 / 并发数 / QPS 等）。

---

## 3. 架构与接入

### 路由
- 新增公开路由 `/showcase`，为 `App.tsx` 中 `/login` 的**同级路由**，置于 `ProtectedRoute` **外层**，匿名可直达。
- 现有兜底 `<Route path="*" element={<Navigate to="/login" replace />} />` **保持不变**。
- 分享链接：`https://test.205716.xyz/showcase`。

### 不触碰
- `nginx.conf` / `deploy/nginx/*`（外层已整体反代 9080，子路径自动可达）。
- `Dockerfile.frontend` / `docker-compose.*` / `.github/workflows/*` / 后端任何文件。

---

## 4. 设计系统（taste-skill 指导，落到本项目）

### Dials
- `DESIGN_VARIANCE: 8`（错落、有视觉冲击）
- `MOTION_INTENSITY: 7`（视差 + 滚动驱动动效；用户要求"适度炫技"，但分寸 / 和谐优先）
- `VISUAL_DENSITY: 4`（标准 web 间距）

### Token 与主题
- 全程语义 token：`bg-background` / `text-foreground` / `text-muted-foreground` / `bg-card` / `border` / `bg-primary` / `text-primary` 等。
- **主题锁定**：单一主题（沿用 App 默认外观），整页不做 section 级主题反转。
- **单一强调色** = `primary`，全页一致。**THE LILA RULE**：不用 AI 紫 / 随机霓虹渐变，所有渐变 / 光晕基于品牌 `primary`。
- **单一圆角尺度**：统一 `rounded-2xl`（与 Login 卡片一致），按钮可全圆，全页遵循同一规则。

### 字体与图标
- 不引入新字体，沿用项目默认字体栈。标题 `tracking-tight` + 大字阶，正文 `leading-relaxed` / `max-w-[65ch]`。
- 沿用 **`lucide-react`**（已依赖），统一 `strokeWidth={1.5}`，单一图标家族，不手绘 SVG。

### 动效系统（MOTION 7，CSS 原生，零新依赖，渐进增强）
所有动效遵循 taste skill"motion must be motivated"——每个动效服务于层级 / 叙事 / 反馈之一，信息性区块保持安静。
- **Hero 视差**：多层 `transform: translateY` 视差，用 CSS `animation-timeline: scroll()` 驱动（背景 / 中景 / 前景不同速率）。
- **滚动揭示**：IntersectionObserver 触发 `opacity / translateY` 进入，分段 `--index` 延迟级联 stagger。
- **粘性段落转场**：关键亮点段用 `position: sticky` + `animation-timeline: view()` 做 scale / opacity 交替，CSS 驱动，**非 JS 逐帧**。
- **数字 count-up**：概览数字进入视口时计数一次（IntersectionObserver + 一次性 rAF，不常驻）。
- **品牌微动**：`primary` 的克制呼吸光晕，全页**最多一处**。
- **Marquee ≤ 1**：技术栈横向滚动若用，全页仅此一处。
- **触感反馈**：CTA / 卡片 `:hover` `transition` + `:active` `-translate-y-[1px]` / `scale-[0.98]`。
- **降级（强制）**：`@media (prefers-reduced-motion: reduce)` 全部静态、无位移；浏览器不支持 `animation-timeline` 时回退为 IntersectionObserver 揭示或静态（渐进增强，不破版）。
- **性能（强制）**：仅动画 `transform` / `opacity`；**禁止** `window.addEventListener("scroll")` 逐帧监听；grain 若用，置于固定 `pointer-events-none` 层。

> **待定的一个权衡**：纯 CSS `animation-timeline` 在部分浏览器（Safari / 旧 Firefox）支持有限，已用渐进增强兜底（退化为揭示动画，不破版）。若要求所有浏览器都有顺滑的滚动 scrub / pin，需引入 GSAP（违背"零依赖"）——默认走 CSS 原生方案。

---

## 5. 页面结构（深度 B，多段滚动）

布局家族多样（≥4 种；连续 image+text split ≤2 段；eyebrow 每 3 段 ≤1 个；hero 严守纪律）。每段标注其动效。

1. **顶栏 TopBar**（高 ≤72px，单行）：左 品牌（Stethoscope + "虚拟患者训练系统"），右 单一 CTA「进入系统」→ `/login`。滚动时轻微背景模糊 / 收缩（CSS）。
2. **Hero**（`min-h-[100dvh]`，顶部内边距 ≤`pt-24`）：
   - 文本元素 ≤4：品牌小标 + 主标题（≤2 行）+ 副文（≤20 字）+ 1 个主 CTA「进入系统」。
   - **多层视差**：品牌色光晕背景层 + Hero 系统截图占位符（16:10，1440×900）中景层，滚动视差。
3. **概览条带**（slim）：3 个真实事实（"5 个可配置训练面板" / "19 项评分维度" / "文本·语音·情绪 多模态"），数字 count-up，无卡片、用留白 / 分隔。
4. **亮点 1 · 训练引擎架构**：full-width，六阶段管道用 chips / 流程示意（非假截图），配 **系统截图占位符**（训练面板，16:10）。布局家族 A。
5. **亮点 2 · 虚拟患者对话 + 自主反馈**：image+text split，配 **系统截图占位符**（对话页，4:3 或 16:10）。布局家族 B（split #1）。揭示 stagger。
6. **亮点 3 · 患者情绪系统**：图标 / 概念 bento，6 情绪状态 chips + 文案，有节奏非纯白堆叠。布局家族 C。
7. **亮点 4 · 语音交互**：image+text split（反向）+ 图标。布局家族 B（split #2，连续上限内）。
8. **亮点 5 · 流式评分 + 透明化**：full-width，**粘性转场**展示双思考面板概念，配 **系统截图占位符**（评分页，16:10）。打破连续 split。布局家族 A 变体。
9. **亮点 6 · 教材知识库 RAG**：图标 / 引用卡概念驱动（不再加截图占位以控量）。布局家族 D。
10. **工程化底座**：紧凑 grid / chips 条带（多 Provider 路由、SSE、成本面板、运维告警、CI/CD）。布局家族 E。
11. **技术栈**：诚实小条带（可作唯一 marquee）。
12. **底部 CTA 段**：单一意图标签「进入系统」→ `/login`（与顶栏 / Hero 同标签，无重复意图 CTA）。品牌微动光晕收尾。
13. **Footer**：极简（产品名 + 年份）。

**截图占位符总量**：3 张（Hero、对话页、评分页），其余亮点以图标 / 概念驱动，兼顾 taste skill"需 2–3 张真实视觉"与小成本。

---

## 6. 系统截图占位符规范（用户授权例外）

taste skill 默认禁止"假截图 / 占位 div"。本期经**用户明确授权**使用占位符，后续替换为真实截图。

- 组件 `ScreenshotPlaceholder`：空白背景（`bg-muted` 或白）+ 1px `border` + 居中**黑色文本** `系统截图 · {width}×{height}`（如 `系统截图 · 1440×900`）。
- 以 `aspect-ratio` 预留尺寸，避免 CLS。
- 每处占位标注 `{/* TODO: 替换为真实系统截图 */}`，便于检索替换。

---

## 7. 文件改动清单

### 新增（均在 `frontend/src/pages/showcase/`）
- `ShowcasePage.tsx` —— 页面根：设置 `document.title`、主题锁定、组合各 section。
- `components/ScreenshotPlaceholder.tsx`
- `components/Reveal.tsx` —— IntersectionObserver 滚动揭示，`prefers-reduced-motion` 感知。
- `sections/TopBar.tsx` / `Hero.tsx` / `Overview.tsx` / 亮点段组件 / `EngineeringBand.tsx` / `TechStack.tsx` / `FinalCta.tsx` / `Footer.tsx`。
- `data.ts` —— 亮点文案 / 图标 / 配置集中存放。
- `showcase.css`（或 Tailwind `@utility`）—— scroll-driven 关键帧与 `animation-timeline` 定义。

### 修改
- `frontend/src/App.tsx` ——
  - 顶部新增 `const Showcase = lazy(() => import("@/pages/showcase/ShowcasePage"));`
  - 在 `<Route path="/login" ... />` 同级、`ProtectedRoute` 之外新增 `<Route path="/showcase" element={<Showcase />} />`。

---

## 8. 可访问性 / 质量门槛（taste skill 硬规则）

- CTA 文本对比度 ≥ WCAG AA，不换行（"进入系统" 单行）。
- Hero 在初始视口内可见（标题 ≤2 行、副文 ≤20 字、CTA 不需滚动即可见）。
- 全页单一主题、单一强调色、单一圆角尺度。
- `prefers-reduced-motion: reduce` 下全部动效降级为静态；`animation-timeline` 不支持时渐进降级不破版。
- 移动端每个多列布局显式声明 `<768px` 单列回退；视差 / 粘性在窄屏酌情关闭。
- 文案中文，发布前做一次 copy 自审（无语病、无 AI 味生造词、无编造精确数字）。

---

## 9. 验收与验证

### 手动
- 匿名（未登录）访问 `/showcase` 正常渲染；点「进入系统」跳 `/login`。
- 桌面 / 移动两种宽度无布局破裂；`prefers-reduced-motion` 下无位移动画；动效顺滑无卡顿。
- 已登录用户访问 `/showcase` 同样可见（公开路由，不被 `ProtectedRoute` 拦截）。

### 自动（推送前，frontend 目录）
```
npx tsc --noEmit
npx biome check
```
（无后端改动，无需 `api:update` / pytest。）

---

## 10. 范围之外（YAGNI）

- 真实截图采集与替换（后续单独进行）。
- 暗色模式专项打磨、多语言 / i18n。
- 任何 nginx / Docker / CICD / 后端改动。
- 引入 GSAP / Motion 等动画库（除非后续明确要求跨浏览器滚动 scrub）。

---

## 11. 技术亮点核对记录（HEAD，2026-06-24）

| 亮点 | 核对结论 | 关键证据 |
|------|----------|----------|
| ~~插件化引擎~~ → 训练引擎架构 | **旧框架已废弃**，改述为六阶段管道 + 5 面板 | `pipeline/builder.py`；`panels/index.ts`；commit `27d0b640` 移除插件基础设施 |
| 虚拟患者 + 自主反馈 | 存在 | `patient/initiative.py`（LLM + 规则兜底） |
| 情绪系统 | 存在，6 状态 / 二维模型 / ~40 立绘 | `patient/emotion.py`；`assets/avatars/` |
| 语音交互 | 存在，火山 TTS+ASR 双路 | `routers/tts.py`、`routers/asr.py` |
| 流式评分透明化 | 存在，双思考面板 / 19 项 | `score_engine.py`；`rubrics/nursing_history_v1.json` |
| RAG 教材库 | 存在但**非 pgvector**，关键词/IDF + Tool Calls | `infrastructure/rag/retriever.py`（IDF）；embedding 列为 JSONB 未用于检索 |
| 工程化底座 | 全部存在 | `llm/router.py`、`routers/ops.py`、成本面板 |
