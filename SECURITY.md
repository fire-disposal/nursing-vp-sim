# Security Policy

## Supported Versions

Only the latest tagged version (`vYYYY.MM.DD-N`) receives security updates.
Previous versions should be upgraded promptly.

## Reporting a Vulnerability

Report vulnerabilities privately by contacting the repository maintainer.
Do NOT file a public issue for security vulnerabilities.

Contact: Open a GitHub issue with label `security` for non-critical items,
or reach out directly if you have the maintainer's contact.

We aim to acknowledge receipt within 48 hours and provide a fix timeline
within 5 business days.

## 安全最佳实践

### 对于贡献者

- 不要在代码、commit message、PR 描述中硬编码密钥
- 所有密钥通过环境变量获取，使用 `.env` 文件（已被 gitignore）
- PR 必须通过 CI 检查（ruff + biome + tsc + pytest）
- 涉及数据库迁移的 PR 必须通过 alembic roundtrip 检查

### 对于部署

- 生产环境必须使用独立的 SECRET_KEY（至少 32 字符）
- 数据库密码必须通过环境变量传入，不硬编码
- 禁止将 `.env` 文件提交到仓库或公开分享
- 定期轮换 API Key

## 依赖审计

```bash
# 后端
cd backend && uv pip list --outdated

# 前端
npm audit
```
