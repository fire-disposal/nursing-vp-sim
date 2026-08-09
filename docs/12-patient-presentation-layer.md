# 患者表现层（Patient Presentation Layer）

> 情绪数据 → 患者表现 的分离抽象。技术栈分叉点：表现策略可插拔，切换只改一行策略链。
> 关联：`docs/realistic-patient-avatar-plan.md`（写实头像接入方案与溯源）。

## 1. 定位与目标

### 1.1 背景

- 训练页患者呈现历史上经历多套方案：SVG 参数化动态脸（`face/*` + `PremiumFaceArtwork`）→ 情绪 PNG 变体（`patient-portrait.ts`）→ 静态头像（简洁画风按年龄/性别、写实画风按病例绑定）。
- 动态情绪换脸按论文展示需要**停用**，但实现保留；未来可能引入 **AI 生成视频**（按情绪剪切切换的动态头像）。
- 多套方案并存导致路由逻辑分散，缺统一协议。

### 1.2 目标

1. 情绪数据与渲染表现解耦：上游只管"情绪快照 + 身份"，下游只管"怎么渲染"。
2. 所有策略同一编写范式：`{ kind, build, render }` 一个模块。
3. 切换技术栈 = 改一行策略链常量；新增策略 = 一个模块 + 一行注册，业务组件零改动。
4. 语义可回退：策略不适用返回 `null`，链上下一策略接管，永不渲染空白。

## 2. 架构总览

```
trainingStore / SSE
   │  EmotionSnapshot（emotion 6态 / emotion4D 9态 / values 四维）
   │  PatientIdentity（name / gender / age）
   ▼
buildPatientPresentation(patient, emotion)          ← 纯函数，走策略链
   │  链顺序即优先级；build() 返回 null = 不适用 → 下一策略
   ▼
PatientPresentation（判别联合：static | realistic | png-variant | svg | video）
   │
   ▼
PatientPresenter  →  PRESENTERS[kind].render(payload, ctx)   ← 注册表分发
```

### 2.1 代码结构

```
frontend/src/components/training/presentation/
├── types.ts                  协议：输入契约 / 表现负载 / 呈现器接口
├── build.ts                  策略链常量 + buildPatientPresentation
├── registry.ts               PRESENTERS 注册表（单一分发点）
├── PatientPresenter.tsx      按 kind 分发渲染的组件
├── build.test.ts             协议单元测试
└── presenters/
    ├── shared.tsx            图片类负载共享渲染（renderAvatarImage，支持 fill）
    ├── staticAvatar.tsx      策略：简洁画风 PNG 路由
    ├── realisticAvatar.tsx   策略：写实画风病例路由
    ├── pngVariant.tsx        策略：情绪 PNG 变体路由
    ├── svgFace.tsx           策略：参数化 SVG 动态渲染
    └── videoScheduler.tsx    策略：视频调度器（预留，媒体流剪切）
```

## 3. 协议定义（`types.ts`）

### 3.1 输入契约

```ts
interface EmotionSnapshot {
  emotion: EmotionState;      // 6 态（withdrawn/defensive/anxious/neutral/relaxed/open）
  emotion4D: Emotion4DLabel;  // 9 态 4D 权威表现标签（open_trusting/…/neutral）
  values: EmotionValues;      // 四维 0-1：{ trust, anxiety, irritation, cooperation }
}

interface PatientIdentity {
  name: string | null;
  gender: string | null;
  age: number | null;
}
```

身份（是谁）与情绪（什么状态）正交，策略按需消费。

### 3.2 渲染上下文（渲染期参数，与策略选择解耦）

```ts
interface PresentationContext {
  size?: number;              // 定尺寸边长；fill 时忽略
  rounded?: "full" | "2xl";   // full=小圆头像，2xl=大脸卡片
  fill?: boolean;             // 铺满容器宽（w-full + aspect-square），大脸自适应侧边组件
  className?: string;
}
```

`build` 决定"是什么"，`render` 决定"怎么展示"——尺寸/圆角不进策略选择逻辑。

### 3.3 表现负载（判别联合，消费端获得类型收窄）

```ts
type PatientPresentation =
  | { kind: "static";       src: string; alt: string }
  | { kind: "realistic";    src: string; alt: string }
  | { kind: "png-variant";  src: string; alt: string }
  | { kind: "svg"; cfg: FaceConfig; extras: PremiumExtras; appearance: AppearanceProfile }
  | { kind: "video"; alt: string; poster: string; current: EmotionState;
      sources: Partial<Record<EmotionState, string>> };
```

### 3.4 呈现器接口（范式约束）

```ts
interface PatientPresenter {
  kind: PresentationKind;
  build(patient: PatientIdentity | null, emotion: EmotionSnapshot): PatientPresentation | null;
  // 纯函数；null = 本策略不适用，交给链上下一策略
  render(payload: PatientPresentation, ctx: PresentationContext): ReactNode;
  // 内部按 kind 收窄后渲染
}
```

### 3.5 设计原则

| 原则 | 说明 |
|---|---|
| build 纯函数 | 不触碰 React，可单元测试，便于未来接入导播/调度等新 kind |
| null = 让位 | 路由器语义：未命中（如写实未绑定、视频无源）自然回退 |
| 链终止于恒适用策略 | `static` 恒适用，保证链永不落空 |
| 判别联合 | 类型安全分发，漏分支编译期报错 |
| 单一注册表 | 新增策略 = 模块 + 注册一行，业务组件不动 |

## 4. 策略链与分发

### 4.1 当前生产链（`build.ts`）

```ts
export const PRESENTATION_CHAIN: PresentationKind[] = ["video", "realistic", "static"];
```

- `video`（预留）：无源时 `build` 返回 `null` 自动让位，接通但惰性。
- `realistic`：论文病例命中写实头像；未命中让位。
- `static`：恒适用，链兜底。
- `buildPatientPresentation` 对非法链（如不含 static）有防御性兜底。

### 4.2 切换技术栈（一行）

| 目标 | 链 |
|---|---|
| 当前生产（视频预留 + 写实 + 简洁） | `["video", "realistic", "static"]` |
| 复活 SVG 动态渲染 | `["svg"]` |
| 启用情绪 PNG 变体 | `["png-variant", "static"]` |
| 只写实 | `["realistic", "static"]` |
| 接入 AI 视频 | `["video", "realistic", "static"]`（源表填充后自动生效） |

## 5. 各策略：现状与未来思路

### 5.1 `static` — 简洁画风 PNG 路由（生产启用）

- **实现**：`avatar.ts` → `getBasePatientAvatar(patient)`。按年龄分组（child ≤12 / youth ≤25 / middle <60 / elder ≥60）× 性别取 `assets/avatars/simple/patient_<group>_<sex>.png`。
- **特性**：恒适用，策略链兜底；欢迎页/聊天区小圆头像走 `getPatientAvatar = realistic ?? base`（组合语义与此链一致）。
- **测试**：`avatar.test.ts` 覆盖分组/性别/匿名兜底。
- **未来**：稳定终态，无开发计划。

### 5.2 `realistic` — 写实画风专属病例头像路由（生产启用）

- **实现**：`avatar.ts` → `getRealisticPatientAvatar(name)`。按患者姓名查 `realisticAvatarsByName`，经 `import.meta.glob` 动态解析 `assets/avatars/realistic/*.png`；未绑定或文件缺失返回 `null` 让位。
- **资源**：`frontend/src/assets/avatars/realistic/`，1536×1536 PNG，虚构人物（合规见 `realistic-patient-avatar-plan.md`）。
- **当前绑定**：

  | 患者 | 资源 |
  |---|---|
  | 王建国（68 男，case1） | `case-chest-pain-elder-male.png` |
  | 张美华（55 女，case4） | `case-fever-middle-female.png` |

- **特性**：文件放入目录即自动生效（glob），无需改代码。
- **测试**：`build.test.ts` 链路由 + `avatar.test.ts` 原语（绑定命中 / 未绑定 null / 组合回退）。
- **未来思路**：
  - 绑定表外部化（JSON/env 注入），病例扩充不碰源码；
  - 为更多论文病例生成头像，沉淀提示词模板库（含一致性锁定手法：固定光线/色彩/构图参数块）；
  - 头像生成溯源信息入库（提示词 + 生成时间 + 模型），满足论文合规可追溯。

### 5.3 `png-variant` — 情绪 PNG 变体路由（预留，未启用）

- **实现**：`patient-portrait.ts` → `getPatientPortraitUrl(patient, emotion)`。按 6 态情绪取 `simple/patient_<group>_<sex><suffix>.png` 变体。
- **后缀映射**：`withdrawn→-s`、`defensive→-a`、`anxious→-n`、`relaxed/open→-h`、`neutral→基础图`。
- **启用**：切链 `["png-variant", "static"]`。
- **测试**：`patient-portrait.test.ts` 覆盖映射与回退。
- **未来思路**：
  - 6 态 → 9 态 4D 标签映射补齐（当前只消费 `EmotionState`）；
  - 若 video 方案落地，本策略可下线（职责被视频调度器吸收）。

### 5.4 `svg` — 参数化 SVG 动态渲染（预留，未启用）

- **实现**：`face/*` 全套 + `PremiumFaceArtwork`：
  - `expressionMap.ts`：`FaceConfig`（眉角/眼开合/眼型/嘴型/腮红/眼泪），9 态标签基调 + 数值修正；
  - `premiumExtras.ts`：头倾角/汗滴/皱眉等动态层；
  - `appearance.ts`：性别 × 年龄组静态外观（发型/皱纹/肤色），与情绪正交（防笛卡尔积）；
  - `PremiumFaceArtwork.tsx`：分层 SVG + 眨眼定时器（`useId` 防渐变 ID 冲突）。
- **启用**：切链 `["svg"]`。
- **保留入口**：`pages/face-lab/FaceLabPage.tsx` 开发实验室（外观 × 情绪 × 数值实时预览）。
- **已知边界**：`appearanceForPatient` 只识别英文 `male`/`female`（生产数据恰为英文，无碍；中文性别会回落 female）。
- **测试**：`PatientFace.test.tsx` + `face/*` 相关用例。
- **未来思路**：
  - 表情细腻度：皮肤/皱纹随年龄动态化、微表情时序；
  - 渲染性能：避免情绪高频切换时整树重渲染（memo 化 FaceArtwork）；
  - 与 video 并存策略：无视频源病例回退 SVG，而非直接跳静态图。

### 5.5 `video` — 视频调度器（预留实现，无源惰性）

- **实现**：`videoScheduler.tsx`：
  - `VIDEO_SOURCES`：`病例姓名 → { 情绪 → 视频 URL }` 源表，当前为空；
  - `build`：无源或当前情绪无对应段 → 返回 `null` 让位；
  - `VideoFace`：`<video key={src} autoPlay loop muted playsInline>`，情绪切换即换 `src`（`key` 强制重载实现**媒体流剪切**）；某情绪缺段 → poster（写实/简洁头像）兜底；
  - 已在生产链首位，**填源表即激活，生产零代码改动**。
- **测试**：`build.test.ts` 验证无源让位。
- **未来思路（规划，未实现）**：
  - **AI 视频生成管线**：以写实基础 PNG 作首帧参考（image-to-video），固定提示词模板只改表情/微动作变量，锁定跨剪辑角色一致性；
  - **剪辑集**：优先 `neutral / anxious / withdrawn / defensive` 四段，其余情绪走 poster 兜底（协议已支持）；
  - **循环质量**：提示"looping, subtle motion, breathing, blinking"，5-8s、720p、1:1、H.264 MP4；
  - **调度增强**：相邻情绪段预加载、切换交叉淡化（当前为硬切）、段间无缝循环校验；
  - **托管**：正式走 CDN URL（MB 级不入 bundle）；原型可临时 `public/videos/`；
  - **映射**：9 态 4D 标签 → 6 态剪辑的聚合策略（dominant state）。

## 6. 接入指南

### 6.1 新增一个策略

1. `presentation/presenters/` 下建模块，按范式实现 `{ kind, build, render }`；
2. 在 `registry.ts` 注册一行；
3. （可选）在 `types.ts` 的判别联合加 kind；
4. 在 `build.ts` 的策略链按优先级插入；
5. 补 `build.test.ts` 用例（至少：命中/让位/兜底）。

### 6.2 接入视频（激活预留调度器）

```ts
// videoScheduler.tsx
const VIDEO_SOURCES = {
  "王建国": {
    neutral: "/videos/jianguo-neutral.mp4",
    anxious: "/videos/jianguo-anxious.mp4",
    withdrawn: "/videos/jianguo-withdrawn.mp4",
  },
};
```

填入即走 `["video", "realistic", "static"]`，无需其他改动。

### 6.3 消费方接入

```tsx
const presentation = buildPatientPresentation(patient, { emotion, emotion4D, values });
<PatientPresenter presentation={presentation} fill />   // 大脸：铺满容器宽
<PatientPresenter presentation={presentation} size={36} rounded="full" />  // 小圆头像
```

## 7. 测试与验证

| 层 | 用例 | 覆盖 |
|---|---|---|
| `build.test.ts` | 8 | 默认链路由、写实命中、SVG 4D→FaceConfig、变体映射、video 让位、非法链兜底 |
| `avatar.test.ts` | 18 | 分组路由、写实原语（命中/null）、组合回退 |
| `PatientStage.test.tsx` | 3 | 大脸 fill 渲染、移动端折叠、无患者兜底 |
| `patient-portrait.test.ts` | 6 | 变体映射与回退 |

- 全量：`cd frontend && npx vitest run`（344 用例）、`npx tsc --noEmit`、`npx vite build`。
- 发布：`pnpm run tag` → staging 自动部署；生产走人工流程（红线见 `AGENTS.md`）。

## 8. 相关文档

- `docs/realistic-patient-avatar-plan.md` — 写实头像接入方案、合规要求、截图检查清单、AI 提示词。
- `docs/04-frontend.md` — 前端整体架构。
