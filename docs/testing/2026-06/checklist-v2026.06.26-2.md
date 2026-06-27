# v2026.06.26-2 测试清单

**版本**: v2026.06.26-1 → v2026.06.26-2
**环境**: https://test.205716.xyz

无需测试 — 纯架构重组与 CI/CD 优化，无用户可见功能变更：

1. 前端 lib/→utils/ 目录合并 + 95 文件 import 路径机械替换
2. 前端死代码切除 (definePlugin, PluginDashboard)
3. 前端 components/teacher/→admin/ 重命名
4. 前端 Showcase 独立为 src/showcase/
5. 前端 plugin 概念清洗 (PluginContext→PanelContext 等)
6. 前端 API 层补全 (notifications, system-notifications, exam, questionnaire)
7. 前端 axios-instance.ts→client.ts 重命名
8. 后端 models.py 拆分为 models/ 包 (12 域文件)
9. 后端 routers 重组 (admin_*.py→admin/, diagnose/ops 收束)
10. CI/CD workflow 文件更名 (cd→deploy-production, staging→deploy-staging 等)
11. 监控脚本自动部署 + daily_report.py 端点更新
12. 维护模式系统全线移除
13. rollback 多版本迁移支持
