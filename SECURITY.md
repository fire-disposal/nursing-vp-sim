# Security Policy

## Supported Versions

Only the latest tagged version (`vYYYY.MM.DD-N`) receives security updates.

## Reporting a Vulnerability

Report vulnerabilities privately — do NOT file a public issue.
Open a GitHub issue with label `security` for non-critical items.

We aim to acknowledge receipt within 48 hours and provide a fix timeline within 5 business days.

## 安全最佳实践

### 贡献者

- 不在代码、commit、PR 中硬编码密钥
- 所有密钥通过 `.env`（已 gitignore）环境变量获取
- PR 必须通过 CI 检查（ruff + biome + tsc + pytest + alembic roundtrip）
- 涉迁移的 PR 须通过 DDL/data 分离检查

### 部署

- 生产环境使用独立 SECRET_KEY（≥32 字符）
- 数据库密码通过环境变量传入，不硬编码
- 禁止提交 `.env` 或公开分享
- 定期轮换 API Key

## 依赖审计

```bash
cd backend && uv sync                     # 同步 lockfile 并检查过时
cd frontend && pnpm audit                 # 前端安全审计
```
