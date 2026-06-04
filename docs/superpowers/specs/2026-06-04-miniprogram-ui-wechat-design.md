# 小程序 UI 优化 & 微信认证设计

## 需求概述

优化微信小程序整体 UI 设计，补齐 Tab 导航，新增微信一键注册/登录及已有账号微信绑定功能。

## 一、Tab 导航结构

将当前无 Tab 的小程序改为标准底部 Tab 栏：

| Tab | 页面路径 | 说明 |
|-----|---------|------|
| 首页 | `pages/home/home` | 数据看板、快速开始、推荐病例、最近记录 |
| 训练 | `pages/cases/cases` | 病例列表 + 难度筛选 |
| 记录 | `pages/history/history` | 训练历史记录列表 |
| 我的 | `pages/profile/profile` | **新增**，用户信息、微信绑定、菜单列表 |

- `pages/training/training`（训练对话）和 `pages/record-detail/record-detail`（记录详情）保持页面跳转，不在 Tab 中
- `pages/login/login` 为独立入口页，不在 Tab 中

## 二、微信认证流程

### 2.1 登录页改造

默认展示微信登录模式，可切换为账号密码模式：

**微信登录模式（默认）：**
- Lottie 动画（复用 Web 端 `frontend/src/assets/lottie/animation.json`，"Online Doctor App"）
- 品牌标识
- 「微信一键登录」绿色按钮
- 底部「使用账号密码登录 →」文字链接切换

**账号密码模式（切换后）：**
- Lottie 动画收起
- 品牌标识
- 用户名、密码输入框 + 登录按钮
- 底部「← 返回微信登录」文字链接切回

### 2.2 微信登录/注册流程

```
用户点击「微信一键登录」
  → wx.login() 获取 code
  → POST /api/auth/wechat/login {code}
     ├─ openid 已绑定用户 → 返回 token，登录成功
     └─ openid 未绑定 (need_bind=true)
          → 弹出「设置昵称」弹窗/半屏
          → 用户填写 display_name
          → POST /api/auth/wechat/register {code, display_name}
          → 自动生成 username (wx_ + 随机串) 和随机密码
          → 创建用户，绑定 openid，返回 token
          → 登录成功
```

### 2.3 已有账号绑定微信

在「我的」页面 → 菜单项「微信绑定」：
- 未绑定状态：右侧显示「未绑定」，点击触发绑定
- `wx.login()` → `POST /api/auth/wechat/bind {code}`
- 已绑定状态：右侧显示「已绑定」绿色标识

## 三、「我的」页面设计

新建 `pages/profile/profile`，传统小程序列表式菜单：

```
┌──────────────────────────┐
│  我的                     │
├──────────────────────────┤
│  👤 昵称    角色: 学生    │  ← 用户信息区
├──────────────────────────┤
│  训练统计             →   │
│  微信绑定       未绑定 →   │  ← 动态状态
│  意见反馈             →   │
│  关于我们             →   │
│  设置                 →   │
├──────────────────────────┤
│       [退出登录]          │  ← 底部红色按钮
└──────────────────────────┘
```

- **微信绑定**：菜单项右侧动态显示状态，绑定成功后刷新
- **意见反馈**：新增反馈页，星级评分 + 标签 + 可选文字，调用已有 `POST /api/feedback`
- **训练统计**：跳转统计概览
- **设置/关于我们**：预留入口，当前可展示版本号

## 四、后端变更

新增一个端点：

| 端点 | 说明 |
|------|------|
| `POST /api/auth/wechat/register` | 接收 `code` + `display_name`，自动生成 username 和 password，创建用户并绑定 openid，返回 `TokenResponse` |

已有端点 `POST /api/auth/wechat/login` 和 `POST /api/auth/wechat/bind` 无需修改。

## 五、整体视觉升级

以现有 `app.wxss` 设计令牌体系为基础增强：

- **全局**：增加渐变背景变量、品牌色深浅变体、图标色变量
- **Tab 栏**：`app.json` 中配置 `tabBar`，使用自定义图标，活跃态品牌色高亮
- **登录页**：Lottie 动画（`lottie-miniprogram` 库）、Web 端同款渐变背景
- **首页**：统计卡片增强阴影、圆角、数字动画效果
- **病例页**：病例卡片增加图标装饰、标签优化
- **记录页**：记录行增加分割线、删除交互确认弹窗
- **训练页**：聊天气泡增加头像占位、发送按钮动效、得分弹窗优化
- **我的页**：标准 cell 列表样式、用户头像区域渐变背景

保持与 Web 端品牌色 `#2563eb` 一致的视觉体系。
