# 小程序本地调试指南

## 前置条件

1. 微信开发者工具已安装
2. 后端已在本机启动：`npm run dev:backend`（端口 8000）

## 导入项目

1. 打开微信开发者工具 → 导入项目
2. 目录选择 `miniprogram/`
3. AppID 使用测试号（或填入正式 AppID）

## 本地网络配置

**项目配置** (`project.config.json`)：
```json
"setting": {
  "urlCheck": false       // 关闭域名校验，允许 localhost
}
```

**API 地址** (`app.ts`)：
```typescript
globalData: {
  baseUrl: "http://localhost:8000"   // 默认本地后端
}
```

**生产切换**：上线时将 `app.ts` 中 `baseUrl` 改为正式域名，并开启 `urlCheck`。

## 后端环境变量 (`.env`)

```bash
# 微信小程序（本地开发无需填写，上线时必须配置）
# WECHAT_APPID=wx___________
# WECHAT_SECRET=___________

# CORS 允许本地开发
CORS_ORIGINS=http://localhost:3000,http://localhost:8000
```

## 启动步骤

1. **启动后端**：`npm run dev:backend`（项目根目录）
2. **打开小程序**：微信开发者工具 → 打开 `miniprogram/` 目录
3. **登录测试**：使用教师预先创建的账号（教师或学生测试账号（由 .env 中配置的密码创建））

## 注意事项

- 微信开发者工具中 `network` 面板可查看 API 请求
- 若后端未启动，小程序所有请求会显示"网络错误"
- `urlCheck: false` 仅在开发者工具中有效，真机预览仍需配置服务器域名
- 微信登录功能需要正式 AppID + Secret 才可使用，本地开发使用账号密码登录即可
