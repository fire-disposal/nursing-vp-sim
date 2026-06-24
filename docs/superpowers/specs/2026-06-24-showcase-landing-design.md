# 展示落地页（Showcase Landing）设计文档

**日期**: 2026-06-24
**分支**: `feat/showcase-landing`
**定位**: 面向演示 / 评审 / 对外展示的技术亮点展示页（audience C）
**Design Read**: 技术亮点展示页，临床科技感的克制语言，复用项目现有 Tailwind v4 + shadcn 风格 token + lucide 图标，**不引入任何新依赖**。

---

## 1. 目标与非目标

### 目标
- 在现有前端 SPA 内新增一个**公开、匿名可访问**的展示页，突出系统真正落地的技术创新点。
- 快接入、小成本：**不动** nginx / Dockerfile / CICD，跟随下一个 tag 一起上线。
- 视觉贴合系统主题（护理 + LLM 虚拟患者），打出创新点，达到"亮眼"的展示效果。

### 非目标（明确排除）
- 不做严肃 SEO / SSR / 预渲染（CSR 路由即可）。
- 不引入新依赖（不加 Motion / GSAP / 新字体 / 新图标库）。
- 不改后端、不改 API、不需 `api:update`。
- 暗色模式独立适配非必需（使用语义 token 自然继承，不单独投入）。
- 真实系统截图本期不交付——使用**用户授权的占位符**，后续替换。

---

## 2. 受众与内容取舍

受众为演示 / 评审场景，因此内容以"技术创新点"为主线，全部以 **git 历史中已落地的提交**为依据（README 信息滞后，不作为依据）。

### 主线叙事（concept spine）
> 把 LLM 真正做成"可教学、可评估、可观测"的虚拟患者系统——插件化引擎承载多模态交互，透明化 AI 评分给出可解释结果，RAG 让知识可溯源。

### 六大核心亮点（Hero 之下的分段，最终取舍）
1. **插件化训练引擎** —— 动态管道装配，问诊 / 查体 / 护理记录 / 情绪 / 语音 / 评分等能力可插拔（PluginManager + manifest 驱动，前端自动发现渲染）。
2. **LLM 虚拟患者对话** —— 角色扮演 + 隐藏信息按关键词逐步披露 + **患者自主反馈 / 主动追问**（指数退避、按次情绪惩罚、自动停止）。
3. **患者情绪系统** —— LLM 响应分析驱动情绪状态，立绘情绪变体实时联动（8 类型 × 4 情绪素材）。
4. **语音交互** —— 火山引擎 TTS / ASR 流式（豆包 SeedTTS 2.0 + BigASR WS），按人口学匹配音色，优雅降级。
5. **流式自动评分 + 透明化** —— SSE 逐项进度 + LLM 思考过程展示 + 19 项证据化反馈（每项附对话证据与评分理由）。
6. **RAG 教材知识库** —— pgvector 向量检索 + LLM 关键词提取，引用出处可溯源（点击查看教材原文）。

### 工程化底座（紧凑条带，1 段，不展开为独立特性页）
多 Provider 路由（优先级加权 / 熔断 / 限流 / 健康检查）、流式 SSE、LLM 调用链路与成本可观测、自动诊断告警、CI/CD 自动构建与部署。
> 取舍理由：这些体现工程成熟度，但对演示受众的"冲击力"弱于上面六点，故压缩为一条可信度背书，不稀释主线。

### 技术栈条带
React 19 / FastAPI / PostgreSQL + pgvector / Alembic / DeepSeek / 火山引擎语音。

### 数字使用纪律
仅使用真实数字（如"19 项评分维度"、"8 类型 × 4 情绪"）。**禁止**编造精确指标（准确率、并发数等）。

---

## 3. 架构与接入

### 路由
- 新增公开路由 `/showcase`，作为 `App.tsx` 中 `/login` 的**同级路由**，置于 `ProtectedRoute` **外层**，匿名可直达。
- 现有兜底 `<Route path="*" element={<Navigate to="/login" replace />} />` **保持不变**。
- 分享链接：`https://test.205716.xyz/showcase`。

### 不触碰
- `nginx.conf` / `deploy/nginx/*`（外层已整体反代 9080，子路径自动可达）。
- `Dockerfile.frontend` / `docker-compose.*` / `.github/workflows/*`。
- 后端任何文件。

---

## 4. 设计系统（taste-skill 指导，落到本项目）

### Dials（为"小成本"压低）
- `DESIGN_VARIANCE: 7`（错落但克制）
- `MOTION_INTENSITY: 4`（纯 CSS 滚动揭示 + hover/active，**不引入动画库**）
- `VISUAL_DENSITY: 4`（标准 web 间距）

### Token 与主题
- 全程使用项目现有语义 token：`bg-background` / `text-foreground` / `text-muted-foreground` / `bg-card` / `border` / `bg-primary` / `text-primary` 等。
- **主题锁定**：单一主题（沿用 App 默认亮色 token 外观）。使用语义 token 后暗色可自然继承，但不作为本期验收项。整页不做 section 级主题反转。
- **单一强调色** = `primary`，全页一致，不在任何区块切换为其它强调色。
- **单一圆角尺度**：统一 `rounded-2xl`（与 Login 卡片一致），交互元素可用全圆（按钮），但全页遵循同一规则。

### 字体
- 不引入新字体，沿用项目默认字体栈。标题用 `tracking-tight` + 大字阶；正文 `leading-relaxed`、`max-w-[65ch]`。

### 图标
- 沿用 **`lucide-react`**（项目已依赖，taste skill 允许沿用既有依赖）。全页统一 `strokeWidth={1.5}`，单一图标家族，不混用。
- 不手绘 SVG 图标。

### 动效（MOTION 4，零新依赖）
- 滚动揭示：自建轻量 `Reveal` 组件，基于 `IntersectionObserver`，进入视口时 `opacity/translateY` 过渡（CSS transition）。
- CTA / 卡片 hover：`transition` + `:active` 的 `-translate-y-[1px]` / `scale-[0.98]` 触感反馈。
- **`prefers-reduced-motion: reduce`** 时全部降级为静态、无位移。
- 禁止 `window.addEventListener("scroll")` 之类逐帧监听。

---

## 5. 页面结构（深度 B，多段滚动）

布局家族需多样（taste skill：≥4 种不同家族；连续 image+text split 最多 2 段；eyebrow 每 3 段最多 1 个；hero 严守纪律）。

1. **顶栏 TopBar**（高度 ≤72px，单行）：左 品牌（Stethoscope 图标 + "虚拟患者训练系统"），右 单一 CTA「进入系统」→ `/login`。
2. **Hero**（`min-h-[100dvh]`，顶部内边距 ≤`pt-24`）：
   - 文本元素 ≤4：品牌小标 + 主标题（≤2 行）+ 副文（≤20 字）+ 1 个主 CTA「进入系统」。
   - 右 / 下方一张 **Hero 系统截图占位符**（16:10，建议 1440×900）。
   - 布局家族：split（左文右图）或上文下图。
3. **概览条带**（slim）：3 个真实事实小项（如"7+ 可插拔训练插件" / "19 项评分维度" / "文本·语音·情绪 多模态"），无卡片、用分隔或留白。
4. **亮点 1 · 插件化训练引擎**：full-width 特性段，配 **系统截图占位符**（插件面板，16:10）。布局家族 A。
5. **亮点 2 · LLM 虚拟患者对话 + 自主反馈**：image+text split，配 **系统截图占位符**（对话页，4:3 或 16:10）。布局家族 B（split 第 1 次）。
6. **亮点 3 · 患者情绪系统**：图标 / 概念驱动的 bento（情绪类型 chips + 文案），有节奏、非纯白卡堆叠。布局家族 C。
7. **亮点 4 · 语音交互**：image+text split（反向），图标 + 简洁视觉。布局家族 B 第 2 次（连续 split 上限内）。
8. **亮点 5 · 流式评分 + 透明化**：full-width，配 **系统截图占位符**（评分页 / 思考面板，16:10）。打破连续 split。布局家族 A 变体。
9. **亮点 6 · RAG 教材知识库**：图标 / 引用卡概念驱动（不再加截图占位以控量）。布局家族 D。
10. **工程化底座**：紧凑 grid / chips 条带（多 Provider 路由、SSE、成本可观测、自动诊断、CI/CD）。布局家族 E。
11. **技术栈**：诚实小条带（文字 / 图标），不堆砌。
12. **底部 CTA 段**：单一意图标签「进入系统」→ `/login`（与顶栏 / Hero 同一标签，无重复意图 CTA）。
13. **Footer**：极简（产品名 + 年份）。

**截图占位符总量**：3 张（Hero、对话页、评分页），其余亮点以图标 / 概念驱动，兼顾 taste skill "需 2–3 张真实视觉" 与小成本。

---

## 6. 系统截图占位符规范（用户授权例外）

taste skill 默认禁止"假截图 / 占位 div"。本期经**用户明确授权**使用占位符，后续替换为真实截图。

- 组件 `ScreenshotPlaceholder`：空白背景（`bg-muted` 或白）+ 1px `border` + 居中**黑色文本**，文本内容为 `系统截图 · {width}×{height}`（如 `系统截图 · 1440×900`）。
- 以 `aspect-ratio` 预留尺寸，避免 CLS。
- 每处占位在代码中标注 `{/* TODO: 替换为真实系统截图 */}`，便于检索替换。

---

## 7. 文件改动清单

### 新增（均在 `frontend/src/pages/showcase/`）
- `ShowcasePage.tsx` —— 页面根：设置 `document.title`、主题锁定、组合各 section。
- `components/ScreenshotPlaceholder.tsx`
- `components/Reveal.tsx` —— IntersectionObserver 滚动揭示，`prefers-reduced-motion` 感知。
- `sections/TopBar.tsx` / `Hero.tsx` / `Overview.tsx` / `Highlights.tsx`（或按亮点拆分）/ `EngineeringBand.tsx` / `TechStack.tsx` / `FinalCta.tsx` / `Footer.tsx`。
- `data.ts` —— 亮点文案 / 图标 / 配置集中存放。

### 修改
- `frontend/src/App.tsx` ——
  - 顶部新增 `const Showcase = lazy(() => import("@/pages/showcase/ShowcasePage"));`
  - 在 `<Route path="/login" ... />` 同级、`ProtectedRoute` 之外新增 `<Route path="/showcase" element={<Showcase />} />`。

---

## 8. 可访问性 / 质量门槛（taste skill 硬规则）

- CTA 文本对比度 ≥ WCAG AA，不换行（"进入系统" 4 字内，单行）。
- Hero 在初始视口内可见（标题 ≤2 行、副文 ≤20 字、CTA 不需滚动即可见）。
- 全页单一主题、单一强调色、单一圆角尺度。
- `prefers-reduced-motion` 降级为静态。
- 移动端每个多列布局显式声明 `<768px` 单列回退。
- 文案中文，发布前做一次 copy 自审（无语病、无 AI 味的生造词、无编造精确数字）。

---

## 9. 验收与验证

### 手动
- 匿名（未登录）访问 `/showcase` 正常渲染；点「进入系统」跳 `/login`。
- 桌面 / 移动两种宽度无布局破裂；`prefers-reduced-motion` 下无位移动画。
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
- 暗色模式专项打磨。
- 多语言 / i18n。
- 任何 nginx / Docker / CICD / 后端改动。
