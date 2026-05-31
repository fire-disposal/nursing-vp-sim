# 虚拟患者训练系统 — 前端

React 19 SPA，为护理学生病史采集训练提供用户界面。

## 技术栈

- React 19 + Vite 8
- react-router-dom v7 (lazy loading)
- recharts (图表) + lucide-react (图标)
- 纯 CSS 设计系统 (tokens.css + 14 UI 组件)
- Biome (linter/formatter)

## 快速启动

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

浏览器打开 `http://localhost:3000`

## 项目结构

```
frontend/src/
├── App.jsx                   # 路由配置 + 权限守卫
├── main.jsx                  # React 入口
├── api.js                    # API 客户端 (37 个函数)
├── pages/                    # 页面组件 (10 个)
├── components/               # 通用组件 (31 个)
│   ├── ui/                   # 设计系统 (14 个)
│   └── teacher/              # 教师端 Tab (9 个)
├── styles/
│   ├── tokens.css            # CSS 变量体系
│   └── index.css             # 全局样式
└── __tests__/                # Vitest 测试 (17 条)
```

## 运行测试

```bash
npx vitest run
```

## 代码检查

```bash
npx biome check src/
npx biome format src/
```
