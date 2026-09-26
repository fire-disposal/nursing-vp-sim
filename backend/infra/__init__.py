"""基础设施层 — 通用技术服务

本包仅包含与护理培训领域无关的通用基础设施：
- logging_setup     — 日志格式化和初始化
- queue             — 异步优先级任务队列
- realtime          — 基于 PostgreSQL LISTEN/NOTIFY 的跨 worker 发布/订阅总栈
- metrics           — 线程安全的应用指标收集
- diagnose          — 诊断快照聚合
- ops_queries       — 运维仪表盘只读查询
- exporter          — CSV/XLSX 通用导出引擎
- scoring_progress  — 内存 TTL 评分进度跟踪

子包：
- llm/  — LLM API 客户端、路由器、限流、日志、解析（与领域无关）
- tts/  — Volcengine 语音合成 WebSocket 客户端
- volc/ — Volcengine 共享认证工具

注意：本包不做 re-export，请从实现所在子模块直接导入
（如 ``from infra.queue import TaskQueue``）。
"""
