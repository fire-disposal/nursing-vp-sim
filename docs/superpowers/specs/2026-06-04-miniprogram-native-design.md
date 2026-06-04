# 微信小程序 — 学生训练端 设计说明书

> 分支: `feat/miniprogram-native` | 日期: 2026-06-04

## 技术选型

原生微信小程序（TypeScript），不引入跨端框架。

| 层面 | 方案 |
|------|------|
| 语言 | TypeScript（严格模式） |
| UI | 原生 WXML + WXSS + 自研轻量组件 |
| HTTP | `wx.request` 封装 + JWT 拦截器 |
| 类型 | `openapi.json` → 代码生成脚本 → `types.ts` + `api.ts` |
| 状态 | `wx.setStorageSync` + Page `data` |
| 语音输入 | `wx.getRecorderManager()` |
| 语音朗读 | `wx.createInnerAudioContext()` + 后端 TTS 代理 |
| 图表 | ECharts 小程序版 (`ec-canvas`) |
| WebSocket | `wx.connectSocket()`（流式对话 + 评分状态推送） |

## 架构图

```
┌─────────────────────────────────────────────┐
│                微信小程序                     │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐ │
│  │  Login   │  │  Cases   │  │  Training  │ │
│  │  登录页  │  │ 病例选择  │  │  对话训练   │ │
│  └────┬─────┘  └────┬─────┘  └─────┬──────┘ │
│       │              │               │       │
│  ┌────┴──────────────┴───────────────┴─────┐ │
│  │           API Layer (api.ts)            │ │
│  │  wx.request + JWT + 错误处理 + 重试     │ │
│  └────────────────────┬───────────────────┘ │
│                       │ HTTPS               │
└───────────────────────┼─────────────────────┘
                        │
┌───────────────────────┼─────────────────────┐
│            FastAPI Backend                   │
│  /api/auth  /api/cases  /api/training       │
│  /api/chat  /api/qa     /api/stats          │
└─────────────────────────────────────────────┘
```

## 项目结构

```
miniprogram/
├── app.ts                    # 应用入口，全局数据
├── app.json                  # 窗口配置 + 页面路由 + 权限
├── app.wxss                  # 全局样式 + 设计 tokens
├── project.config.json       # 微信开发者工具配置
├── tsconfig.json
├── sitemap.json
│
├── api/
│   ├── types.ts              # 代码生成 DTO 类型
│   ├── client.ts             # wx.request 封装 (JWT、超时、重试)
│   ├── auth.ts               # 登录/用户 API
│   ├── cases.ts              # 病例 API
│   ├── training.ts           # 训练 API
│   ├── chat.ts               # 对话 API (sync + WebSocket)
│   ├── qa.ts                 # 问答 API
│   └── stats.ts              # 统计 API
│
├── components/
│   ├── navbar/               # 自定义导航栏（适配刘海屏）
│   ├── message-bubble/       # 聊天气泡
│   ├── case-card/            # 病例卡片
│   ├── stat-card/            # 统计卡片
│   ├── empty-state/          # 空状态占位
│   ├── loading/              # 加载指示器
│   ├── record-row/           # 训练记录行
│   └── voice-button/         # 语音输入按钮
│
├── pages/
│   ├── login/                # 登录页
│   │   ├── login.ts
│   │   ├── login.wxml
│   │   └── login.wxss
│   ├── home/                 # 首页仪表盘
│   ├── cases/                # 病例选择
│   ├── training/             # 对话训练（核心）
│   ├── history/              # 训练记录列表
│   ├── record-detail/        # 记录详情 + 评分
│   ├── qa/                   # 护理问答
│   └── stats/                # 训练统计
│
├── utils/
│   ├── storage.ts            # wx.storage 同步/异步封装
│   ├── format.ts             # 日期/时长格式化
│   └── constants.ts          # 业务常量
│
└── scripts/
    └── generate-api.ts       # openapi.json → api/types.ts 生成器
```

## 页面设计

### 1. 登录页 `/pages/login/login`

```
┌──────────────────────┐
│                      │
│      [听诊器图标]     │
│    虚拟患者训练系统    │
│                      │
│   ┌────────────────┐ │
│   │   用户名        │ │
│   ├────────────────┤ │
│   │   密码          │ │
│   └────────────────┘ │
│                      │
│   [  ===== 登录 ===== ] │
│                      │
└──────────────────────┘
```

- 调用 `POST /api/auth/login`，存储 `access_token` + `user_id` + `role`
- 登录成功跳转 `/pages/home/home`
- 错误提示红色 toast

### 2. 首页 `/pages/home/home`

```
┌──────────────────────┐
│  虚拟患者训练系统      │
├──────────────────────┤
│  ┌────┐ ┌────┐ ┌────┐│
│  │3次 │ │120min│ │85分││
│  │训练│ │时长 │ │均分││
│  └────┘ └────┘ └────┘│
├──────────────────────┤
│  ◆ 开始新训练          │
│    选择病例，开始对话   │
├──────────────────────┤
│  推荐病例:             │
│  ┌──────────────────┐ │
│  │ ★☆☆ 初级          │ │
│  │ 咳嗽咳痰伴呼吸困难 │ │
│  │ 老年男性，COPD... │ │
│  └──────────────────┘ │
│  ┌──────────────────┐ │
│  │ ★★☆ 中级          │ │
│  │ 足部皮肤破溃...   │ │
│  └──────────────────┘ │
├──────────────────────┤
│  最近训练:             │
│  • 咳嗽病例  85分 ✓  │
│  • 消化病例  62分 ⚠  │
├──────────────────────┤
│  [训练] [问答] [统计]  │  ← tabBar
└──────────────────────┘
```

### 3. 病例选择 `/pages/cases/cases`

```
┌──────────────────────┐
│  ← 返回    病例选择    │
├──────────────────────┤
│  [全部] [★初级] [★★中级] [★★★高级] │
├──────────────────────┤
│  ┌──────────────────┐ │
│  │ ★☆☆ 初级          │ │
│  │ 咳嗽咳痰伴呼吸困难 │ │
│  │ 68岁男性，COPD... │ │
│  │        [开始训练] │ │
│  └──────────────────┘ │
│  ┌──────────────────┐ │
│  │ ★★☆ 中级          │ │
│  │ 足部皮肤破溃...   │ │
│  │        [开始训练] │ │
│  └──────────────────┘ │
└──────────────────────┘
```

- 调用 `GET /api/cases` 获取列表
- 选择病例 → `POST /api/training/start` → 跳转训练页

### 4. 对话训练 `/pages/training/training` (核心)

```
┌──────────────────────┐
│ [←] 王建国 · 咳嗽病例  ⏱12:34 [结束]│
├──────────────────────┤
│                      │
│    护士你好，我这两天  │
│    喘不上来气...      │
│                      │
│              您哪里   │
│              不舒服？ │
│                      │
│    我胸口闷，特别是    │
│    走路的时候...      │
│                      │
├──────────────────────┤
│ [🎤] [________输入___] [→]│
└──────────────────────┘
```

- **顶栏**: 患者名 + 病例名 + 倒计时 + 结束按钮
- **消息区**: 患者白色靠左、学生蓝色靠右
- **输入栏**: 语音按钮 + 文本输入 + 发送
- **结束训练**: `POST /api/training/{id}/end` → 轮询评分状态 → 评分弹窗

**流式对话方案 (WebSocket)**:
- 后端新增 `ws://host/ws/chat/{record_id}` 
- 前端 `wx.connectSocket()` 连接
- 消息格式:
  ```json
  {"type": "chunk", "content": "你"}
  {"type": "chunk", "content": "好"}
  {"type": "done", "id": 123}
  ```

**语音输入**:
```typescript
const recorder = wx.getRecorderManager()
recorder.start({ format: 'mp3', duration: 60000 })
recorder.onStop((res) => {
  // 上传音频到后端 STT 代理
  wx.uploadFile({ url: '/api/voice/transcribe', filePath: res.tempFilePath })
})
```

**语音朗读**:
- 后端新增 `POST /api/voice/tts` 返回 MP3 二进制
- 前端 `wx.downloadFile()` → `wx.createInnerAudioContext()` 播放
- 流式场景：后端逐句返回音频片段，前端队列播放

### 5. 训练记录 `/pages/history/history`

```
┌──────────────────────┐
│  训练记录             │
├──────────────────────┤
│  [全部] [进行中] [已完成] │
├──────────────────────┤
│  咳嗽病例  85分 ✓ 完成 │
│  2024-06-03 14:30    │
├──────────────────────┤
│  消化病例  62分 ⚠ 完成 │
│  2024-06-02 10:15    │
├──────────────────────┤
│  足部病例  --  进行中  │
│  2024-06-04 09:00    │
├──────────────────────┤
│         加载更多       │
└──────────────────────┘
```

### 6. 记录详情 `/pages/record-detail/record-detail`

```
┌──────────────────────┐
│  ← 返回  训练详情     │
├──────────────────────┤
│      总  分           │
│       85              │
│   ━━━━━━━━━━━━━━━    │
│   沟通技能    28/30   │
│   病史采集    57/70   │
├──────────────────────┤
│  ✓ 优势:              │
│  • 开场白自然友好      │
│  • 询问了过敏史       │
├──────────────────────┤
│  ⚠ 待改善:            │
│  • 未询问用药史       │
├──────────────────────┤
│  对话回放:            │
│  患者：...            │
│  学生：...            │
└──────────────────────┘
```

## API 客户端代码生成

**输入**: `openapi.json`（项目根目录）
**输出**: `miniprogram/api/types.ts`

**生成规则**:
1. 解析 `paths` → 提取 method、path、requestBody、responses
2. 解析 `components/schemas` → 生成 TypeScript interface
3. 生成 API 函数：
```typescript
// 自动生成示例
export function login(data: LoginRequest): Promise<LoginResponse> {
  return request('POST', '/api/auth/login', data)
}
export function getCases(params?: { offset?: number; limit?: number }): Promise<PaginatedResponse<CaseBrief>> {
  return request('GET', '/api/cases', undefined, params)
}
```

**`request()` 封装**:
```typescript
function request<T>(method: string, path: string, data?: any, params?: any): Promise<T> {
  const token = wx.getStorageSync('access_token')
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${path}`,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      timeout: 120000,
      success: (res) => {
        if (res.statusCode === 401) {
          wx.redirectTo({ url: '/pages/login/login' })
          return
        }
        if (res.statusCode >= 400) reject(res.data)
        else resolve(res.data as T)
      },
      fail: reject,
    })
  })
}
```

## 新增后端端点

| 端点 | 用途 |
|------|------|
| `WS /ws/chat/{record_id}` | 流式对话 WebSocket |
| `POST /api/voice/transcribe` | 语音转文字代理 |
| `POST /api/voice/tts` | 文字转语音代理 |

## 实现计划

| 阶段 | 内容 | 时间 |
|------|------|------|
| 1 | 项目脚手架 + 代码生成脚本 + `request()` 封装 | 0.5d |
| 2 | 登录页 + 首页仪表盘 | 1d |
| 3 | 病例选择 + 对话训练（sync 模式） | 1.5d |
| 4 | 训练记录 + 记录详情 | 0.5d |
| 5 | WebSocket 流式对话 + 后端适配 | 1d |
| 6 | 语音输入 + TTS 朗读 | 0.5d |
| 7 | 问答 + 统计 | 0.5d |
| 8 | 测试 + 调优 | 0.5d |
| **合计** | | **~6d** |
