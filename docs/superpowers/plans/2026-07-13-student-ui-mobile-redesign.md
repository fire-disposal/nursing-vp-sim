# 学生端移动优先重设计方案

> 2026-07-13 | 目标：完全重设计学生端界面，优先适配移动端网页浏览器

## 一、现状问题汇总

### 1.1 布局问题

| 问题 | 根因 | 影响 |
|------|------|------|
| **双顶栏重叠** | Layout.tsx 的 StudentTopNav（56px）+ TrainingEngine.tsx 内 TrainingHeader（~56px）分别独立渲染，且 TrainingEngine 用 `h-screen`（100vh）导致底部裁切 | 移动端训练页顶部被吃掉 ~15% 可视高度，内容区域额外被裁切 |
| **导航栏训练中无意义** | StudentTopNav 在训练页仍显示「问答」「统计」「问卷」链接 | 浪费空间 + 分散学生注意力 |
| **管理员端侧边栏移动端简陋** | md 以下仅一个汉堡菜单 + 标题文字 | 导航体验差 |

### 1.2 交互问题

| 问题 | 根因 |
|------|------|
| 结束后退/继续训练入口弱 | 训练结束仅弹窗，结束后自动跳转，mobile 无清晰的结果页过渡 |
| 场景工具从侧边浮出 | SceneRenderer 用绝对定位从右侧弹出面板，mobile 小屏下可交互区域严重受限 |
| 计时器/结束按钮在第二顶栏 | 结束按钮不够醒目，不易发现 |
| 配置弹窗在训练前 | TrainingConfigSheet 弹窗中的特性开关学生无法正确判断 |

### 1.3 响应式问题

- `useLayoutMode()` 只分 phone(<768px) 和 desktop(≥768px)，阈值单一
- 多个组件只用 `sm:` 断点区分移动/桌面，缺乏针对小屏的精细化适配
- 未使用 `env(safe-area-inset-*)` 处理全面屏设备的刘海/底部白条
- 未使用 `100dvh`（dynamic viewport height），浏览器地址栏滚动隐藏后底部空间浪费

---

## 二、设计原则

```
移动端绝对优先  →  桌面端兼容适配
沉浸式训练      →  进入训练 = 进入病房，系统 Chrome 消失
底部操作模式    →  所有交互在拇指可达区域
原生感          →  原生滚动、手势、触控反馈、安全区
渐进式呈现      →  不一次性展示全部，按需展开
```

---

## 三、整体方案

### 3.1 路由与布局架构

当前：
```
/<Layout>             → StudentTopNav → <Outlet>
  /home               → StudentDashboard （有系统顶栏）
  /training           → TrainingSelect （有系统顶栏）
  /training/:id       → TrainingEngine（有系统顶栏 + 训练内顶栏 ← 重复）
  /history            → History（有系统顶栏）
  /record/:id         → RecordDetail（有系统顶栏）
  /qa                 → QA（有系统顶栏）
  /stats              → StatsPage（有系统顶栏）
  /my-responses       → MyResponses（有系统顶栏）
  /profile            → Profile（有系统顶栏）
```

改造后：
```
<StudentShell>        → 仅首页/列表页使用，含底部 Tab 导航
  /home               → StudentDashboard （精简版首页）
  /training           → TrainingSelect （精简版列表）
  /history            → History （精简版记录）
  /my-responses       → MyResponses（精简版问卷）
  /qa                 → QA（精简版问答）

<ImmersiveShell>      → 训练页专用，全身沉浸
  /training/:id       → TrainingEngine （无任何系统导航）

<DefaultShell>        → 通用但有顶部返回 + 标题
  /record/:id         → RecordDetail
  /stats              → StatsPage
  /profile            → Profile
```

**路由改造**：在 `App.tsx` 中，学生端路由拆为三组 Shell：

```
// App.tsx 改造示意
<Routes>
  <Route path="/login" ... />
  <Route element={<ProtectedRoute />}>
    {/* Group 1: Bottom Tab Shell — 主要导航页 */}
    <Route element={<StudentTabShell />}>
      <Route path="/home" ... />
      <Route path="/training" ... />
      <Route path="/history" ... />
      <Route path="/my-responses" ... />
      <Route path="/qa" ... />
    </Route>
    {/* Group 2: Immersive Shell — 训练页 */}
    <Route element={<ImmersiveShell />}>
      <Route path="/training/:recordId" ... />
    </Route>
    {/* Group 3: Default Shell — 其他页 */}
    <Route element={<DefaultShell />}>
      <Route path="/record/:id" ... />
      <Route path="/stats" ... />
      <Route path="/profile" ... />
    </Route>
  </Route>
  ...
</Routes>
```

---

### 3.2 Shell 组件设计

#### StudentTabShell — 底部 Tab 导航壳

```
┌──────────────────────────────┐
│                              │  ← 粘性标题栏，h-12 (48px)
│  首页 / 病例训练 / ...       │     可显示当前页标题
│                              │
├──────────────────────────────┤
│                              │
│                              │  ← flex-1 填满，overflow-y-auto
│       页面内容区域            │
│                              │
│                              │
├──────────────────────────────┤
│  🏠  📋   🩺  📝   ❓       │  ← 底部 Tab 栏，h-14 (56px) + safe-area-bottom
│  首页 训练 记录 问卷 问答    │     5 个主要入口
└──────────────────────────────┘
```

- 标题栏只在需要时显示分段标题，大多数列表页不需要
- 底部 Tab 栏始终可见，用户可在 5 个主要页面间快速切换
- Tab 栏使用 `position: fixed; bottom: 0` + `pb-[env(safe-area-inset-bottom)]`

#### ImmersiveShell — 训练沉浸壳

```
┌──────────────────────────────┐
│                              │  ← 极小顶栏，h-11 (44px) 
│  ←  患者头像  姓名  计时器   │     只含返回 + 患者信息 + 计时
│                    [🔴结束] │     结束按钮显眼红色，h-8
├──────────────────────────────┤
│                              │
│                              │
│       对话区                  │  ← flex-1，overflow-y-auto
│                              │     使用 100dvh 适配动态视口
│                              │
├──────────────────────────────┤
│  [🩺查体] [📝记录] [📊MEWS]│  ← 工具按钮栏，h-10 (40px)
│                              │     点击展开 BottomSheet
├──────────────────────────────┤
│  📝 输入问诊内容…     [发送] │  ← 输入区，h-12 + safe-area-bottom
│                    (长按语音)│     
└──────────────────────────────┘
```

- **无 StudentTopNav**，无管理侧边栏
- **无 h-screen**，改用 flex-1 自然填充
- 工具按钮从底部弹出 `BottomSheet`（替代当前右侧悬浮 SceneRenderer）
- 结束按钮红色+固定

#### DefaultShell — 通用导航壳

```
┌──────────────────────────────┐
│  ← 返回    页面标题    ┆     │  ← h-11 (44px)，轻量
├──────────────────────────────┤
│                              │
│       页面内容                │  ← flex-1
│                              │
└──────────────────────────────┘
```

---

### 3.3 训练页（Immersive）移动端详细设计

#### 3.3.1 顶栏设计方案

```
┌────────────────────────────────────┐
│ ← [返回]                           │
│                                     │
│  [头像] 张三                         │
│         肺炎链球菌感染确诊           │
│                                     │
│                      ⏱ 15:32       │
│                      [🔴 结束]      │
└────────────────────────────────────┘
```

实现：`position: sticky; top: 0; z-index: 10`

关键点：
- 背景半透明毛玻璃效果（backdrop-filter: blur + bg-card/80）
- 患者头像用真实图片（优先从 `getPatientPortraitUrl`）
- 计时器在剩余 ≤ 5 分钟时变为红色闪烁
- 结束按钮固定在右上角，圆形红色，带「结束」文字

#### 3.3.2 对话区

- 单列全宽，无两侧 padding
- 气泡从两侧对齐（左：患者，右：学生）
- 患者气泡带头像缩略图
- 流式加载时显示打字动画（已有）
- 新消息自动滚底
- 支持手动上拉查看历史

#### 3.3.3 工具按钮栏

```
┌────────────────────────────────────┐
│ [🩺 查体] [📝 护理记录] [📊 MEWS]  │
│ [🎤 语音输入]                      │  ← 更多按钮展开
└────────────────────────────────────┘
```

- 只展示当前病例启用的能力（由 case_data.capabilities 决定）
- 点击后从底部弹出 **BottomSheet**，非侧边栏

BottomSheet 实现要点：
- `position: fixed; bottom: 0; left: 0; right: 0`
- 拖拽手柄可调整高度（25%/50%/full）
- 背景遮罩层
- 内容区域可滚动

查体 BottomSheet 示例：

```
┌────────────────────────────────────┐
│ ─── (拖拽手柄)                      │
│                                     │
│ 护理查体                            │
│                                     │
│ ┌─────────┐ ┌─────────┐            │
│ │  体温    │ │  血压    │            │
│ │ 38.5°C  │ │ 135/85  │            │  ← 网格按钮布局
│ ├─────────┤ ├─────────┤            │
│ │  心率    │ │  血氧    │            │
│ │  88     │ │  97%    │            │
│ └─────────┘ └─────────┘            │
│ ┌─────────┐ ┌─────────┐            │
│ │  呼吸    │ │  疼痛    │            │
│ │  20     │ │  3/10   │            │
│ └─────────┘ └─────────┘            │
│                                     │
│ [自定义查体]                         │
└────────────────────────────────────┘
```

#### 3.3.4 输入区

```
┌────────────────────────────────────┐
│ 📝 输入问诊内容…      [提交] [🔴]  │
│                                        │  ← 结束按钮固定在右下角
└────────────────────────────────────┘
```

- 输入框自动增高（max-h-32）
- 右侧发送按钮（蓝色）
- 右下角悬浮结束按钮（红色，圆形 `position: fixed`）
- 发送后清空输入框

#### 3.3.5 训练结束流程

```
点击结束 → 确认弹窗（底部弹出）→ 确认 → 过渡动画 → 结果页
                                   ↓
                             自动生成评分
                                   ↓
                          跳转至 RecordDetail
                          （或停留训练结果摘要）
```

- 确认弹窗用 BottomSheet 代替 Dialog
- 评分生成中显示进度条（已有 ScoringOverlay）
- 完成后显示简洁的结果摘要 + 返回入口

---

### 3.4 首页（/home）移动端设计

```
┌──────────────────────────────┐
│  🖐 欢迎回来，张三            │  ← 简洁标题
│                               │
│ ┌──────────────────────────┐ │
│ │ 继续上次的训练             │ │  ← 有进行中训练时显示
│ │ 肺炎链球菌感染 · ⏱ 5:20  │ │     卡片式，可点
│ │ [继续]                    │ │
│ └──────────────────────────┘ │
│                               │
│ ┌─────┐ ┌─────┐ ┌───────┐  │
│ │  12  │ │  8   │ │ 85.3  │  │  ← 统计卡片，横向滚动
│ │ 训练  │ │ 完成  │ │ 均分   │  │
│ └─────┘ └─────┘ └───────┘  │
│                               │
│ 📋 待完成练习                   │
│ ┌──────────────────────────┐ │
│ │ 📝 病史采集基础训练        │ │  ← 教师布置的待完成练习
│ │   截止：07/20             │ │     卡片列表
│ │ [开始]                    │ │
│ └──────────────────────────┘ │
│                               │
│ ⭐ 推荐病例                     │
│ ┌─────┐ ┌─────┐ ┌──────┐   │  ← 水平滚动（snap-scroll）
│ │病例A │ │病例B │ │病例C  │   │
│ │ 初级  │ │ 中级  │ │ 高级  │   │
│ └─────┘ └─────┘ └──────┘   │
│                               │
└──────────────────────────────┘
```

- 卡片化设计，去除表格
- 水平滚动区域使用 CSS `scroll-snap-type: x mandatory`
- 统计卡片用横向滚动的 sliding cards

---

### 3.5 训练列表页（/training）移动端设计

```
┌──────────────────────────────┐
│  训练中心                      │
│                               │
│ ┌──────────────────────────┐ │
│ │  🩺 病史采集     [12]    │ │  ← 训练类型选择 Tab
│ │  🚑 预检分诊     [4]     │ │     左右可滑动
│ └──────────────────────────┘ │
│                               │
│ [全部] [初级] [中级] [高级]  │  ← 难度筛选 pills
│                               │
│ ┌──────────────────────────┐ │
│ │ 肺炎链球菌感染             │ │  ← 病例卡片
│ │ 男 45岁 · 主诉：发热咳嗽  │ │
│ │ ⭐⭐⭐                    │ │
│ │ [开始训练]                │ │
│ ├──────────────────────────┤ │
│ │ 急性心肌梗死               │ │
│ │ 男 60岁 · 主诉：胸痛      │ │
│ │ ⭐⭐⭐⭐                  │ │
│ │ [开始训练]                │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

- 病例卡片全宽，上滑加载更多
- 筛选条件用横向可滚动的 pills
- 搜索框整合在顶部
- 点击「开始训练」直接启动（跳过配置弹窗，从 case_data 读取默认配置）

---

### 3.6 训练记录列表页（/history）移动端设计

```
┌──────────────────────────────┐
│  训练记录                      │
│                               │
│ [全部] [进行中] [已完成]      │  ← 状态筛选 tabs
│                               │
│ ┌──────────────────────────┐ │
│ │ 📅 07/12 15:30            │ │
│ │ 肺炎链球菌感染             │ │
│ │ ✅ 已完成  ⭐ 85          │ │  ← 右侧评分
│ │ [查看详情 >]              │ │
│ ├──────────────────────────┤ │
│ │ 📅 07/10 10:00            │ │
│ │ 急性心肌梗死               │ │
│ │ ⏳ 进行中  < 未完成       │ │
│ │ [继续训练 >]              │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

- 卡片替代当前 Table
- 状态用颜色圆点 + 文字标识
- 评分用分数 + 星级

---

### 3.7 训练详情页（/record/:id）移动端设计

```
┌──────────────────────────────┐
│  ←  训练结果                   │  ← DefaultShell
│                               │
│ ✅ 训练完成                     │
│ 🏆 总评分：85 / 100            │
│ ⏱ 耗时：18分32秒               │
│                               │
│ ┌──────────────────────────┐ │
│ │ 📊 评分详情               │ │  ← 可折叠区域，默认展开
│ │ 问诊完整性   90/100  ⭐   │ │     进度条 + 分数
│ │ 护理评估     80/100  ⭐  │ │
│ │ 沟通技巧     85/100  ⭐  │ │
│ │ 临床判断     82/100  ⭐  │ │
│ └──────────────────────────┘ │
│                               │
│ ┌──────────────────────────┐ │
│ │ 💬 对话回放               │ │  ← 折叠，默认收起
│ │ 点击展开查看完整对话      │ │
│ └──────────────────────────┘ │
│                               │
│ ┌──────────────────────────┐ │
│ │ 📝 教师评语               │ │  ← 有审核时显示
│ │ "问诊记录完整，建议加强"  │ │
│ └──────────────────────────┘ │
│                               │
│ [🔄 重新训练] [📤 分享结果]  │  ← 底部操作按钮
└──────────────────────────────┘
```

---

## 四、具体代码改造清单

### Phase 1 — 布局重构（核心骨架）

| 文件 | 操作 | 说明 |
|------|------|------|
| `App.tsx` | 改造 | 学生端路由改为三组 Shell（TabShell / ImmersiveShell / DefaultShell） |
| **新增** `components/shell/StudentTabShell.tsx` | 创建 | 底部 Tab 导航壳 |
| **新增** `components/shell/ImmersiveShell.tsx` | 创建 | 训练沉浸壳 |
| **新增** `components/shell/DefaultShell.tsx` | 创建 | 通用导航壳 |
| `components/Layout.tsx` | 精简 | 仅保留管理员端侧边栏，学生端移至 Shell |
| `config/navigation.tsx` | 调整 | APP_ROUTES 学生端路由移除 Layout 依赖 |

### Phase 2 — 训练页移动端重写

| 文件 | 操作 | 说明 |
|------|------|------|
| `TrainingEngine.tsx` | 改造 | 移除 `h-screen` → `h-full`；依赖于 ImmersiveShell |
| `TrainingHeader.tsx` | 重写 | 改为移动端沉浸顶栏（44px，毛玻璃，计时+结束） |
| **新增** `components/training/ToolBar.tsx` | 创建 | 工具按钮栏（查体/记录/MEWS） |
| **新增** `components/training/BottomSheet.tsx` | 创建 | 通用底部弹出面板 |
| `SceneRenderer.tsx` | 废弃/改造 | 侧边 Icon 栏转为 ToolBar BottomSheet |
| **新增** `components/training/ExamBottomSheet.tsx` | 创建 | 查体 BottomSheet 面板 |
| **新增** `components/training/RecordBottomSheet.tsx` | 创建 | 护理记录 BottomSheet |
| **新增** `components/training/MewsBottomSheet.tsx` | 创建 | MEWS 评分 BottomSheet |
| `ChatArea.tsx` | 调整 | 去除多余的 EmotionIndicator 区域，整合到气泡内 |
| `ChatInput.tsx` | 调整 | 增加右下角悬浮结束按钮 |
| `ChatDisplay.tsx` | 调整 | 移动端气泡样式微调 |

### Phase 3 — 训练配置改造

| 文件 | 操作 | 说明 |
|------|------|------|
| `TrainingConfigSheet.tsx` | 简化/废弃 | 学生端不再展示能力开关，直接从 case_data 读取 |
| `TrainingSelect.tsx` | 调整 | 点击开始直接启动，不弹配置弹窗 |
| `backend/core/case_schema.py` | 改造 | 新增 `capabilities` 字段 |
| `backend/core/capabilities.py` | 改造 | `resolve_features` 增加 case_data 参数 |
| `backend/contexts/training/router/session.py` | 调整 | 创建训练记录时从 case_data 解析 features |

### Phase 4 — 列表页卡片化

| 文件 | 操作 | 说明 |
|------|------|------|
| `pages/History.tsx` | 改造 | Table → Card 列表 |
| `pages/DashboardHome.tsx` | 调整 | 移动端卡片布局 |
| `pages/TrainingSelect.tsx` | 调整 | 移动端卡片布局 |
| `pages/QA.tsx` | 调整 | 移动端适配 |

### Phase 5 — CSS / 主题 / 全局

| 文件 | 操作 | 说明 |
|------|------|------|
| `styles/tailwind.css` | 新增 | safe-area 变量、dvh 工具类 |
| `cn.ts` 或全局 | 新增 | `100dvh` fallback |

---

## 五、关键技术细节

### 5.1 安全区适配

```css
/* 全局工具类 */
.safe-area-top {
  padding-top: env(safe-area-inset-top, 0px);
}
.safe-area-bottom {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
```

TabShell 的底部 Tab 栏和训练页的输入区均需应用。

### 5.2 动态视口高度

```tsx
// 替代 h-screen / h-[100vh]
style={{ height: 'calc(100dvh, var(--100vh-fallback))' }}
```

或直接用 Tailwind CSS v4 自定义 utility：
```css
@utility h-dscreen {
  height: 100dvh;
}
@utility h-fscreen {
  height: 100vh; /* fallback */
}
```

### 5.3 底部面板 (BottomSheet) 通用组件

Props：
```tsx
interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  snapPoints?: [number, number, number]; // 弹出高度比例 [25%, 50%, 90%]
  defaultSnap?: number;                  // 默认展开比例（索引）
  children: ReactNode;
}
```

### 5.4 TrainingEngine `h-screen` 修复

当前（有 bug）：
```tsx
<div className="flex h-screen">
```

修复：
```tsx
<div className="flex flex-1 min-h-0">
```

配合 ImmersiveShell：
```tsx
// ImmersiveShell.tsx
export default function ImmersiveShell() {
  return (
    <div className="flex flex-col h-dscreen safe-area-top">
      <Outlet />
    </div>
  );
}
```

### 5.5 训练开始流程改造

当前：
```
选病例 → 弹 TrainingConfigSheet（含能力开关） → 启动
```

改造后：
```
选病例 → API start_training（无配置弹窗） → 直接进入训练
```

能力开关从病例 `case_data.capabilities` 读取：

```python
# 新增 case_data.capabilities 字段
class CaseDataSchema(JsonbModel):
    capabilities: dict[str, bool] = {
        "physical_exam": False,   # 是否启用查体
        "nursing_record": False,  # 是否启用护理记录
        "patient_initiative": False,  # 是否启用主动追问
    }
```

教师端编辑病例时可以设置这些。学生端不再展示开关。

### 5.6 结束按钮设计

移动端结束按钮两处放置：
1. **顶栏右上角** — 红色圆形按钮（小屏备选方案）
2. **输入框右下角** — 悬浮红色圆形按钮（推荐）

```tsx
// 悬浮结束按钮
<button
  onClick={handleEndClick}
  className="fixed bottom-20 right-4 z-50 flex size-12 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-lg active:scale-95 transition-transform"
  aria-label="结束训练"
>
  <PhoneOff size={20} />
</button>
```

---

## 六、实施路线

```
Phase 1 (骨架)
  ├── App.tsx 路由改造
  ├── 新建 3 个 Shell 组件
  ├── Layout.tsx 精简
  └── 验证：首页/Tab切换正常，训练页无双顶栏

Phase 2 (训练页)
  ├── TrainingHeader 重写
  ├── BottomSheet 通用组件
  ├── ToolBar + 各功能 BottomSheet
  ├── h-screen → h-full 修复
  └── 悬浮结束按钮

Phase 3 (配置改造)
  ├── case_schema.py 新增 capabilities
  ├── capabilities.py resolve_features 调整
  ├── session.py 改造
  └── TrainingConfigSheet 简化

Phase 4 (列表页卡片化)
  ├── History → CardList
  ├── TrainingSelect → CardList
  ├── DashboardHome → Cards
  └── QA 移动端适配

Phase 5 (打磨)
  ├── safe-area 适配
  ├── 手势/动画
  ├── 暗色模式验证
  └── 桌面端回归测试（至少 1024px 可用）
```

---

## 七、设计参考链接

| 参考来源 | 借鉴点 | 链接 |
|----------|--------|------|
| Duolingo 教学界面 | 沉浸式学习壳、底部操作、进度条 | duolingo.com |
| Telegram WebZ | 底部面板、流畅动画 | web.telegram.org |
| Discord Mobile | 底部 Tab、频道内沉浸 | discord.com/app |
| Linear 移动端 | 原生感设计系统 | linear.app |
| iOS Health App | 卡片式统计、水平滚动 | (系统应用) |
| 丁香医生问诊 | 问诊对话界面 | dxy.com |

---

## 八、预览

需要我为这些设计出图吗？可以制作：
1. 移动端训练页的 Figma 风格低保真原型（Excalidraw）
2. 工具按钮 BottomSheet 交互流程
3. TabShell 底部导航在不同页面的状态图
