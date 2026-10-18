# nursing-vp-sim

护理学生练问诊，缺的不是案例，是能反复练、还能按条目打分的病人。

**状态**：可用，单个生产实例在跑；**入口**：[iomt.205716.xyz](https://iomt.205716.xyz)；**仓库**：`fire-disposal/nursing-vp-sim`

## 本质

让 LLM 扮演病人、按条目评分并交由教师复核的护理虚拟病人训练平台。

## 选型

基于 FastAPI + React 的训练平台，前端 React 19 + Mantine，后端 FastAPI + SQLAlchemy，数据 PostgreSQL 15，语音火山引擎 TTS，部署 Docker Compose + Nginx。

- 前端
  - React 19
    - Mantine 9
      - @mantine/form
      - @mantine/modals
      - @mantine/notifications
    - TanStack Query
    - React Router
    - Zustand
    - Recharts
    - Vite
    - Vitest
- 后端
  - Python 3.13
    - FastAPI
      - Pydantic
      - uvicorn
    - SQLAlchemy 2.0
      - Alembic
- 数据
  - PostgreSQL 15
    - psycopg 3
- 模型与语音
  - LLMRouter
  - 火山引擎 TTS
- 部署
  - Docker Compose
  - Nginx
  - GitHub Actions

## 功能

- 对话：LLM 角色扮演 + SSE 流式输出；隐藏背景按语义逐步披露，出站有泄漏守卫
- 情绪：四维（信任 / 焦虑 / 烦躁 / 配合）带版本持久化，驱动患者措辞与行为；结果页有轨迹与事件标注
- 评分：基础 rubric 19 个条目（沟通 14 / 病史采集 5），护理记录维度按需追加；条目 0–2 分，raw_max 38 映射到 100
- 评分韧性：失败重试、超时结算置 failed、幻觉维度过滤、越界裁剪与总分重算
- 教师复核：独立 `ScoreReview` 存储，逐项改分，对话回放与证据点击联动
- 导出：`GET /records/{id}/experience` 输出自包含 JSON（时间线、消息、查体、情绪事件、评分口径、`gaps`）
- 病例：`backend/data/cases` 14 个内置病例，启动时按指纹收敛；AI 生成 + 校验器
- 管理面：作业、班级、角色权限、问卷、成本管理、审计日志、反馈
- 语音：TTS 合成与打断可用；STT 与双工对谈未做

## 启动流程

```bash
pnpm install
cd backend && uv sync && cd ..
cd frontend && pnpm install && cd ..
cp .env.example .env     # JWT_SECRET_KEY / FERNET_KEY / DEEPSEEK_API_KEY / DATABASE_URL
pnpm run dev             # 后端 :8000，前端 :3000
```

需要本地 PostgreSQL 15，库名写在 `DATABASE_URL`，首次启动自动 seed 测试账号。

```bash
pnpm check               # ruff format + ruff check + ty + biome + tsc
pnpm test:backend        # pytest，纯逻辑，不依赖数据库
cd frontend && pnpm vitest run
```

发版：`pnpm run tag` 推送 `v*` tag 触发部署；回滚走 Actions 的 Emergency Rollback。

## 边界与已知问题

- 旧 README 说“记录该次体验差一个导出面”，但端点与前端下载都已实现（`router/session_views.py`、`utils/export-record.ts`），文档需要同步。
- 双工语音（持续拾音 + 端点检测 + 打断）未实现，当前是单向播报可中断。
- 只有 production 一个实例，staging 已于 2026-09-14 退役；没有灰度环境。
- `production` 当前未配 Required reviewers，推 tag 即发版；README 与 onboarding 说法不一致，以实际配置为准。
- 评分总分口径随运行时 rubric 变化：病例追加护理记录维度后条目数与总分都会变，跨病例比较要看 `grade_policy` 的口径字段。
- 兜底分（`Score.fallback`）被 `grade_conditions()` 排除在成绩与排行榜统计之外，降级等于不参与统计；改分走教师复核。
- 测试不覆盖真实模型与语音链路（后端 145 个测试文件、前端 103 个）。

## 文档索引

- [docs/README.md](docs/README.md) — 文档总览
- [docs/architecture.md](docs/architecture.md) — 架构
- [docs/operations.md](docs/operations.md) — 运维
- [AGENTS.md](AGENTS.md) — 开发约定
