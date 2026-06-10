# 对话训练页面全面重设

**日期**: 2026-06-10
**状态**: 已设计
**类型**: 架构重构 + UI 重设 + 高级特性实装

---

## 1. 背景与动机

对话训练页面（`/training/:recordId`）已通过插件化改造，但存在以下问题：

1. **插件系统反向**：聊天显示、输入框、顶栏、TTS 等核心 UI 被做成插件，而真正需要扩展的高级特性（情绪状态机、主动追问、体征锚点、护理检查单、高级立绘）插件接口不充分
2. **UI 简陋混乱**：欢迎 banner 是纯文字、侧边栏无法折叠/展开、Tab 图标缺乏标签和统一设计
3. **插件生命周期钩子未连线**：`onInit`、`afterReceive` 等钩子定义了但从未被引擎调用
4. **代码冗余严重**：SidebarHost 内联绕过了插件系统、护理记录仅存 localStorage、问诊检测有两套互不兼容算法、大量遗留代码未清理

本次重设目标：**固化核心 UI、插件系统瘦身为两层（Panel Tab + 生命周期钩子）、全部 7 个高级特性完整实装（含前后端）**。

---

## 2. 架构变更

### 2.1 核心 vs 插件分界

**核心（固定组件，TrainingEngine 直接渲染，不可替换）：**

| 组件 | 位置 | 说明 |
|------|------|------|
| `TrainingHeader` | CSS Grid header 行 | 返回按钮、患者信息、计时器、TTS、结束按钮、情绪指示器 |
| `ChatArea` | CSS Grid content 列 | 聊天区容器，内含 WelcomeScreen（空态）或 ChatDisplay（消息态） |
| `ChatInput` | ChatArea 底部 | 输入框 + 发送，在 ChatArea 容器内部 |
| `PanelHost` | CSS Grid panel 列 | 侧边栏宿主，收集插件 Tab 并渲染，支持折叠/展开 |
| `QuestionnaireOverlay` | Portal overlay | 训前/训后问卷弹窗 |
| `ScoringOverlay + ScoreCard` | Portal overlay | 评分进度条 + 结果卡片 |

**插件（注册到 PanelHost，贡献 Tab + 生命周期钩子）：**

| 优先级 | 插件 | Feature Flag | 有 Tab | 有 Hook |
|--------|------|-------------|--------|---------|
| 1 | inquiry | 无（始终存在） | 是 | 否 |
| 2 | patient-info | 无（始终存在） | 是 | 否 |
| 3 | physical-exam | `physical_exam` | 是 | `afterReceive` |
| 4 | nursing-record | `nursing_record` | 是 | `onEnd` |
| 5 | emotion | `emotion` | 是 | `afterReceive` |
| 6 | initiative | `patient_initiative` | 是 | `onInit`, `afterReceive` |
| 7 | portrait | `portrait` | 是 | `afterReceive` |

### 2.2 删除的插件

| 插件 | 原因 |
|------|------|
| `chat-display` | 固化为 ChatArea 内部组件 |
| `chat-input` | 固化为 ChatInput 组件 |
| `training-header` | 固化为 TrainingHeader 组件 |
| `sidebar-host` | 替换为 PanelHost + 独立插件 |
| `inquiry` (旧) | 改为 inquiry-plugin，统一算法 |
| `timer` | 并入 TrainingHeader |
| `patient-initiative` (旧) | 重写为 initiative-plugin |

### 2.3 删除的遗留代码

- `frontend/src/components/training/` (7 files)
- `frontend/src/components/nursing-record/` (5 files + items，插件版保留)
- `frontend/src/styles/index.css` (2686 行)
- `frontend/src/styles/tokens.css` (166 行)
- `frontend/src/engine/SlotRenderer.tsx`
- `frontend/src/engine/useResponsiveLayout.ts`（简化为 CSS 媒体查询）

---

## 3. 布局系统

### 3.1 CSS Grid

```
桌面端 (≥1024px):
grid-template-areas: "header header" "content panel";
grid-template-columns: 1fr auto;
grid-template-rows: auto 1fr;

┌──────────────────────────┬──────────┐
│      TrainingHeader      │          │
├──────────────────────────┤  Panel   │
│  ChatArea                │  (280px  │
│  ┌────────────────────┐  │   展开)  │
│  │ ChatDisplay        │  │   或     │
│  │ (overflow-y-auto)  │  │  (40px   │
│  ├────────────────────┤  │   折叠)  │
│  │ ChatInput          │  │          │
│  └────────────────────┘  │          │
└──────────────────────────┴──────────┘
```

移动端 (<768px): 单列布局，Panel 通过 FAB 按钮触发全屏 Bottom Sheet。

### 3.2 面板折叠状态

- **展开**: 图标列 40px + Tab 内容面板 240px = 280px
- **折叠**: 仅图标列 40px
- 动画: `transition-all duration-200`
- 折叠时点击图标 → 自动展开并切换 Tab
- `ChatTraining.tsx` 可配置默认展开/折叠

---

## 4. 核心组件

### 4.1 TrainingHeader

```
┌───────────────────────────────────────────────────────────┐
│ ← │ 🧑 张建国         │ ⏱ 24:32 ⏸ │ 🔊 │ 😊 neutral │ 🔴 结束 │
│   │ 急性心肌梗死病例    │            │     │            │         │
└───────────────────────────────────────────────────────────┘
```

- **返回按钮**: 导航到 `/cases`
- **患者信息**: 圆形头像 + 姓名 + 病案标题（portrait 插件可注入立绘 URL）
- **计时器**: 30 分钟倒计时，≤5 分钟橙色，≤2 分钟红色闪烁，支持暂停/继续
- **TTS 开关**: Ear/EarOff 图标，激活时边框高亮
- **情绪指示器**: 由 emotion 插件通过 PluginContext 写入
- **结束按钮**: 红色描边，disabled 当 `messages.length <= 1`

### 4.2 ChatArea

两层结构：`flex flex-col h-full`

```
┌───────────────────────────────────┐
│  ChatDisplay / WelcomeScreen      │  ← flex-1 overflow-y-auto
│  (scrollable)                     │
├───────────────────────────────────┤
│  ChatInput                        │  ← shrink-0
└───────────────────────────────────┘
```

### 4.3 WelcomeScreen

消息为空时显示，垂直居中：

```
         ┌─────────────────┐
         │  🧑 张建国       │
         │  男 · 58岁       │
         │                 │
         │  主诉           │
         │  胸痛3小时...   │
         │                 │
         │  性格特征       │
         │  焦虑、表达清晰  │
         │                 │
         │  病案           │
         │  急性心肌梗死   │
         └─────────────────┘

    💡 在下方输入框开始与患者对话
     试试："您好，请问哪里不舒服？"
```

- 患者信息卡片（shadcn Card）：大头像、姓名、性别年龄、主诉、性格、病案
- 引导提示语 + 可点击快捷问候（点击自动填入输入框）

### 4.4 ChatDisplay

消息列表，每条消息为 `ChatBubble`：
- **patient**（左侧）: `bg-card border rounded-2xl rounded-bl-md`，支持 emotion 插件修改边框色
- **student**（右侧）: `bg-primary text-primary-foreground rounded-2xl rounded-br-md`
- **system**（居中）: `bg-blue-50 border-blue-200`
- 流式传输: patient 气泡末尾闪烁光标
- 自动滚底 + 上滑时显示「↓ 最新消息」按钮

### 4.5 ChatBubble 增强

- 通过 React Context (`EmotionContext`, `PortraitContext`) 读取当前情绪和立绘：
  - 情绪影响患者气泡边框颜色
  - 立绘替换静态 avatar 图片
- `afterReceive` 钩子可修改/屏蔽消息内容

### 4.6 ChatInput

```
┌──────────────────────────────────┐
│ 💬 输入消息与患者对话...        ➤ │
└──────────────────────────────────┘
```

- textarea 支持多行，Enter 发送，Shift+Enter 换行
- 发送按钮主题色，disabled 时降透明度
- 发送中显示加载动画

---

## 5. PanelHost（面板宿主）

### 5.1 展开态

```
┌────┬──────────────────────────┐
│ ↕  │ 📋 问诊进度    badge:3/8 │ ← 标题：icon + label + badge
│    ├──────────────────────────┤
│ 📋 │                          │
│ 👤 │  Tab 内容               │ ← overflow-y-auto
│ 🩺 │  <PluginComponent />     │
│ 📝 │                          │
│ 😊 │                          │
│ 💬 │                          │
│ 🎨 │                          │
└────┴──────────────────────────┘
  40px      240px
```

- 折叠按钮(↕)在顶部
- 图标列竖排，活跃 Tab 高亮 `bg-primary/10 text-primary`
- Badge 在图标右上角（数字或红点）

### 5.2 折叠态

```
┌────┐
│ ↕  │
│    │
│ 📋³│ ← badge
│ 👤 │
│ 🩺 │
│ 📝⁵│
│ 😊 │
│ 💬¹│ ← 红点（有追问）
│ 🎨 │
└────┘
```

### 5.3 Tab 内容区

- 统一标题栏：插件 icon + label，下方分割线
- 内容区可滚动，flex-1
- 插件组件接收 `PanelTabProps { ctx, features, isCollapsed }`

### 5.4 移动端

- FAB 固定在右下角，显示活跃 Tab 图标
- 点击展开全屏 Bottom Sheet，顶部横向滚动 Tab 栏
- 下滑或点 ✕ 关闭

---

## 6. 插件系统接口

```typescript
interface PanelPlugin {
  id: string;
  featureFlag?: string;
  meta: { name: string; description?: string };

  tab: {
    icon: ComponentType<{ size?: number }>;
    label: string;
    badge?: (ctx: PluginContext) => BadgeInfo | null;
    priority?: number;       // 排序，越小越靠前
  };

  component: ComponentType<PanelTabProps>;
  hooks?: PluginHooks;
}

interface BadgeInfo {
  text: string;
  variant: "default" | "destructive";
}

interface PluginHooks {
  onInit?: (ctx: PluginContext) => void | (() => void);
  onDestroy?: () => void;
  beforeSend?: (text: string, ctx: PluginContext) => string;
  afterReceive?: (msg: ChatMessage, ctx: PluginContext) => ChatMessage | null;
  onPhaseChange?: (from: string, to: string, ctx: PluginContext) => void;
  onEnd?: (reason: "manual" | "timeout", ctx: PluginContext) => void;
}

interface PanelTabProps {
  ctx: PluginContext;
  features: Record<string, boolean>;
  isCollapsed: boolean;
}
```

TrainingEngine 负责在适当时机调用各插件的生命周期钩子。

---

## 7. 插件详细设计

### 7.1 Inquiry Plugin（问诊进度）

- **Tab**: 进度条 + 要求列表（完成✓绿色 / 未完成○灰色）
- **算法**: 统一使用子串匹配（替换旧版二元语法算法）
- **数据源**: `ctx.patient.requiredInquiries` + `ctx.messages`
- **Badge**: `完成数/总数`

### 7.2 Patient Info Plugin（患者情况）

- **Tab**: 姓名、年龄性别、主诉卡片、性格特征、病案
- **数据源**: `ctx.patient`

### 7.3 Physical Exam Plugin（护理查体）

- **Tab**: 8 个操作按钮网格 + 已查体征结果展示区
- **afterReceive**: 检测患者回复中的 `exam_result`，解析结构化数据，渲染为读数卡片（血压 `120/80 mmHg` 等），缓存到插件内部状态
- **Badge**: 已查体征数
- **Backend**: SSE 事件新增 `exam_result` 类型，操作执行器返回结构化数据

### 7.4 Nursing Record Plugin（护理记录）

- **Tab**: 8 节 30 项表单（基于现有 config.ts），8 个 section 可折叠
- **持久化**: 使用 `GET/POST /api/nursing-records/{id}` 替换 localStorage
- **自动填充**: 查体数据自动填入对应字段
- **onEnd**: 训练结束时检查未填项，通过 bus 通知评分弹窗提示
- **Badge**: `已填项/总项数`

### 7.5 Emotion Plugin（情绪状态机）

- **Tab**: 当前情绪大标签（5 态之一 + 颜色指示），情绪变化时间线
- **afterReceive**: 调用 state API 获取情绪，写入 `EmotionContext`
  - Open → 绿色边框
  - Relaxed → 蓝色边框
  - Neutral → 默认
  - Defensive → 橙色边框
  - Withdrawn → 红色边框
- **Backend**: 已有 `emotion.py` 5 态引擎，通过 state API 读取

### 7.6 Initiative Plugin（主动追问）

- **Tab**: 追问状态指示、追问历史列表、下次追问倒计时
- **onInit**: 每 5s 轮询 state API，触发条件满足时调用 trigger endpoint
- **afterReceive**: 患者追问作为 system 消息注入对话流
- **Badge**: 红色圆点（有待处理追问时）
- **Backend**: 已有 `initiative.py`，state API 增强返回详情

### 7.7 Portrait Plugin（高级患者立绘）

- **Tab**: 当前立绘缩略图、表情状态说明
- **afterReceive**: 根据 emotion context 选择对应立绘 URL，写入 `PortraitContext`
- **素材路径**: `/public/portraits/{case_id}/{emotion}.png`，未提供时 fallback 到静态 avatar
- **影响范围**: ChatBubble 患者头像、WelcomeScreen 患者头像、TrainingHeader 患者头像
- 美术素材暂时以占位文件代替

---

## 8. 后端变更

### 8.1 API 端点

| 方法 | 路径 | 说明 | 状态 |
|------|------|------|------|
| `GET` | `/api/training/{id}/state` | 响应增加 `emotion`、`initiative` 详情 | 修改 |
| `POST` | `/api/training/{id}/initiative/trigger` | 保持不变 | 不变 |
| `GET` | `/api/nursing-records/{id}` | 返回结构化 JSONB `sheet_data` | 修改 |
| `POST` | `/api/nursing-records/{id}` | 接收结构化 JSONB `sheet_data` | 修改 |
| `GET` | `/api/training/{id}/emotion/history` | 情绪变化历史 | 新增 |
| `GET` | `/api/training/{id}/initiative/history` | 追问触发历史 | 新增 |

### 8.2 训练状态 API 增强响应

```json
{
  "emotion": { "current": "relaxed", "score": 1, "history": [...] },
  "personality": { "health_literacy": "normal", "verbosity": "terse", ... },
  "initiative": {
    "elapsed_seconds": 45,
    "threshold_seconds": 60,
    "should_trigger": false,
    "last_triggered_at": "...",
    "history": [...]
  },
  "exam_anchors": { "vital_signs": {...}, "skin": "...", "pain_score": 3 },
  "current_phase": "history_taking",
  "feature_flags": { ... }
}
```

### 8.3 SSE 事件类型扩展

| 事件类型 | 新增/已有 | 数据格式 |
|---------|----------|---------|
| `content` | 已有 | `{"content": "..."}` |
| `system` | 已有 | `{"system": "..."}` |
| `done` | 已有 | `{"done": true, "id": N}` |
| `error` | 已有 | `{"error": "..."}` |
| `exam_result` | **新增** | `{"exam_result": {"type": "vitals", "data": {"blood_pressure": "120/80", ...}}}` |
| `emotion_change` | **新增** | `{"emotion_change": {"from": "neutral", "to": "relaxed", "trigger": "empathy"}}` |
| `initiative` | **新增** | `{"initiative": {"content": "（患者犹豫了一下）那个...医生..."}}` |

### 8.4 NursingRecord 模型

```python
class NursingRecord(Base):
    __tablename__ = "nursing_records"
    id = Column(Integer, primary_key=True)
    record_id = Column(Integer, ForeignKey("training_records.id"), unique=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    sheet_data = Column(JSONB, default={})   # { section_key: { item_key: value } }
    status = Column(String, default="draft")  # draft / completed
    updated_at = Column(DateTime)
```

替换现有 4 个 text 字段（subjective, objective, assessment, plan）。

### 8.5 API 客户端重新生成

设计实现完成后，基于 OpenAPI schema 重新生成 `frontend/src/api/` 下的 TypeScript 客户端代码。

---

## 9. 实现文件结构（目标）

```
frontend/src/
├── engine/
│   ├── TrainingEngine.tsx           # 重写：核心布局 + 钩子调用
│   ├── PanelHost.tsx                # 新：面板宿主
│   ├── PluginRegistry.ts           # 简化：仅管理 PanelPlugin
│   ├── MessageBus.ts               # 不变
│   ├── StreamManager.ts            # 增强：解析 SSE 新事件类型
│   ├── ScoreManager.ts             # 不变
│   ├── PatientProvider.tsx         # 不变
│   ├── PluginContext.tsx           # 新：EmotionContext, PortraitContext 等
│   ├── types.ts                    # 简化类型定义
│   └── tts/                        # 不变
│
├── components/
│   └── training/
│       ├── TrainingHeader.tsx      # 新写：顶栏
│       ├── ChatArea.tsx            # 新写：聊天区容器
│       ├── ChatDisplay.tsx         # 新写：消息列表
│       ├── ChatBubble.tsx          # 增强：情绪/立绘支持
│       ├── ChatInput.tsx           # 新写：输入框（在 ChatArea 内）
│       ├── WelcomeScreen.tsx       # 新写：患者信息卡片
│       ├── PanelHost.tsx           # 新写：面板宿主
│       ├── QuestionnaireOverlay.tsx
│       ├── ScoringOverlay.tsx
│       └── ScoreCard.tsx
│
├── plugins/
│   ├── inquiry/                    # 问诊进度（新写）
│   ├── patient-info/               # 患者情况（新写）
│   ├── physical-exam/              # 护理查体（增强）
│   ├── nursing-record/             # 护理记录（增强：后端持久化）
│   ├── emotion/                    # 情绪状态机（新写）
│   ├── initiative/                 # 主动追问（重写）
│   ├── portrait/                   # 高级立绘（新写，占位素材）
│   ├── questionnaire/              # 问卷（不变）
│   └── dev-tools/                  # 调试工具（可选保留）
│
├── pages/
│   └── ChatTraining.tsx            # 简化：组装插件列表
│
├── api/
│   ├── chat.ts                     # 重新生成
│   ├── training-state.ts           # 重新生成
│   ├── nursing-records.ts          # 新增
│   └── api-client.ts               # 重新生成
│
└── styles/
    └── tailwind.css                 # 清理后保留

public/
└── portraits/                       # 立绘素材目录（占位）
    └── {case_id}/
        └── {emotion}.png
```

---

## 10. spec 自审

### 10.1 占位符检查
- 无 TODO/TBD 遗留
- 所有 API 路径、数据类型、组件接口均已明确定义

### 10.2 一致性检查
- 架构（第二/六节）与布局（第三节）一致：PanelHost 作为核心组件，插件注册 Tab
- 插件接口（第六节）与各插件设计（第七节）一致：所有钩子类型均被使用
- 后端 API（第八节）与插件需求一致：emotion/initiative/nursing-record 所需端点均定义

### 10.3 范围检查
- 覆盖 7 个插件、6 个核心组件、4 个 API 变更、清理计划
- 单一训练对话页面，不含其他页面改动

### 10.4 歧义检查
- 所有 "增强"/"修改" 状态有具体变更说明
- 删除清单物品均有明确原因
- 素材占位路径已指定

---

## 11. ChatTraining.tsx 最终组装示例

```tsx
export default function ChatTraining() {
  const { recordId } = useParams<{ recordId: string }>();

  const panelPlugins = useMemo(() => [
    inquiryPlugin,
    patientInfoPlugin,
    physicalExamPlugin,
    nursingRecordPlugin,
    emotionPlugin,
    initiativePlugin,
    portraitPlugin,
  ], []);

  return (
    <TrainingEngine
      recordId={recordId!}
      features={{
        physical_exam: true,
        nursing_record: true,
        emotion: true,
        patient_initiative: true,
        portrait: true,
      }}
      panelPlugins={panelPlugins}
    />
  );
}
```
