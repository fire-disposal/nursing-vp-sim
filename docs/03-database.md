# 03 — 数据库设计

> 适用版本: v2026.05.31 | 最后更新: 2026-05-31

数据库：PostgreSQL 15，通过 SQLAlchemy 2.0 ORM + Alembic 管理迁移。

---

## 数据库配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 数据库 | PostgreSQL 15 | Docker Compose 部署，开发环境可连本地 |
| ORM | SQLAlchemy 2.0 | 声明式映射，UtcDateTime 时区保护 |
| 迁移 | Alembic | 版本化 schema 变更 |
| 默认连接 | `postgresql://postgres:postgres@localhost:5432/vptest` | 可通过 DATABASE_URL 覆盖 |
| Docker 连接 | `postgresql://nursing:${POSTGRES_PASSWORD}@db:5432/nursing_vp` | docker-compose.yml 内配置 |
| pool_pre_ping | True | 连接前检测有效性 |
| pool_recycle | 3600s | 每小时回收连接 |

---

## ER关系

```
User (1) ──→ (N) TrainingRecord (1) ──→ (1) Case
                    │
                    ├──→ (N) Message
                    ├──→ (1) Score
                    └──→ (N) Note

User (1) ──→ (N) QARecord
User (1) ──→ (N) LLMCallLog

ApiProvider (1) ──→ (N) ApiKey

PromptTemplate (独立，无外键依赖)
```

---

## 表结构

### users — 用户表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 用户ID |
| username | VARCHAR(50) | UNIQUE, NOT NULL | 登录账号 |
| password_hash | VARCHAR(255) | NOT NULL | bcrypt哈希密码 |
| role | VARCHAR(10) | NOT NULL, DEFAULT "student" | student / teacher |
| display_name | VARCHAR(50) | NOT NULL | 显示姓名 |
| student_id | VARCHAR(30) | NULLABLE | 学号 |
| created_at | DATETIME (UTC) | DEFAULT NOW | 创建时间 |

种子数据：
- admin / admin123 (teacher)
- student1~5 / 123456 (student)

### cases — 病例表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 病例ID |
| name | VARCHAR(100) | NOT NULL | 病例名称（症状描述，不泄露诊断） |
| description | TEXT | NULLABLE | 病例简介 |
| case_data | JSON | NOT NULL | 完整病例数据（患者信息/病史/难度/时限等） |
| created_at | DATETIME (UTC) | DEFAULT NOW | |

### training_records — 训练记录表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 记录ID |
| user_id | INTEGER | FK→users.id | 学生ID |
| case_id | INTEGER | FK→cases.id | 病例ID |
| status | VARCHAR(20) | DEFAULT "in_progress" | in_progress / completed |
| scoring_status | VARCHAR(20) | NULLABLE | pending / processing / completed / failed |
| scoring_error | VARCHAR(500) | NULLABLE | 评分失败原因 |
| start_time | DATETIME (UTC) | DEFAULT NOW | 开始时间 |
| end_time | DATETIME (UTC) | NULLABLE | 结束时间 |

### messages — 对话消息表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 消息ID |
| record_id | INTEGER | FK→training_records.id | 所属训练 |
| role | VARCHAR(10) | NOT NULL | student / patient |
| content | TEXT | NOT NULL | 消息内容 |
| created_at | DATETIME (UTC) | DEFAULT NOW | 时间戳 |

复合索引: `(record_id, created_at)` — 对话加载热路径

### scores — 评分表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 评分ID |
| record_id | INTEGER | FK→training_records.id, UNIQUE | 所属训练（一对一） |
| total_score | FLOAT | NOT NULL | 总分 (100分制) |
| detail_scores | JSON | NULLABLE | 分项得分（含逐项评分 + evidence/reason） |
| strengths | JSON | NULLABLE | 优点列表 |
| weaknesses | JSON | NULLABLE | 不足列表 |
| missed_content | JSON | NULLABLE | 漏问内容列表 |
| suggestions | TEXT | NULLABLE | 改进建议文本 |
| rubric_version | VARCHAR(50) | NULLABLE | 评分标准版本 (如 nursing_history_v1@1.0) |
| model_name | VARCHAR(50) | NULLABLE | 评分所用模型 |
| prompt_version | INTEGER | NULLABLE | Prompt 版本号 |
| score_scale | INTEGER | DEFAULT 100 | 评分制 (100 = 百分制) |
| review_status | VARCHAR(20) | DEFAULT "pending" | 教师复核状态 (pending / reviewed) |
| reviewed_by | INTEGER | FK→users.id, NULLABLE | 复核人 |
| reviewed_at | DATETIME (UTC) | NULLABLE | 复核时间 |
| review_detail_scores | JSON | NULLABLE | 复核后的分项得分 |
| review_comment | TEXT | NULLABLE | 复核备注 |
| created_at | DATETIME (UTC) | DEFAULT NOW | |

detail_scores 结构（100分制）：

```json
{
  "沟通技能": {
    "score": 65,
    "max": 74,
    "items": [
      {"id": "comm_01", "name": "学生与病人打招呼并问候", "score": 3, "evidence": "对话中的具体证据(30-80字)", "reason": "评分理由(20-50字)"},
      {"id": "comm_02", "name": "学生询问病人的姓名和个人信息", "score": 2, "evidence": "...", "reason": "..."}
    ]
  },
  "病史采集": {
    "score": 21,
    "max": 26,
    "items": [...]
  }
}
```

### llm_call_logs — LLM调用审计日志表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 日志ID |
| user_id | INTEGER | FK→users.id, NULLABLE | 触发调用的用户 |
| record_id | INTEGER | FK→training_records.id, NULLABLE | 关联训练记录 |
| case_id | INTEGER | FK→cases.id, NULLABLE | 关联病例 |
| purpose | VARCHAR(30) | NOT NULL | 调用目的 (chat / scoring / qa) |
| provider | VARCHAR(20) | NOT NULL | LLM 提供商 |
| model | VARCHAR(50) | NOT NULL | 模型名 |
| temperature | FLOAT | NOT NULL | 温度参数 |
| max_tokens | INTEGER | NOT NULL | 最大 token 数 |
| input_chars | INTEGER | NULLABLE | 输入字符数 |
| output_chars | INTEGER | NULLABLE | 输出字符数 |
| estimated_input_tokens | INTEGER | NULLABLE | 估算输入 token |
| estimated_output_tokens | INTEGER | NULLABLE | 估算输出 token |
| estimated_cost | FLOAT | NULLABLE | 估算费用(USD) |
| latency_ms | INTEGER | NULLABLE | 调用延迟(毫秒) |
| status | VARCHAR(20) | NOT NULL | success / error |
| error_type | VARCHAR(50) | NULLABLE | 错误类型 |
| error_message | VARCHAR(500) | NULLABLE | 错误信息 |
| request_chars | INTEGER | NOT NULL | 请求字符数 |
| response_chars | INTEGER | NULLABLE | 响应字符数 |
| api_key_id | INTEGER | FK→api_keys.id, NULLABLE | 使用的 API Key |
| meta | JSON | NULLABLE | 附加元数据 |
| created_at | DATETIME (UTC) | DEFAULT NOW | |

### notes — 笔记表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 笔记ID |
| record_id | INTEGER | FK→training_records.id | 所属训练 |
| user_id | INTEGER | FK→users.id | 作者 |
| content | TEXT | NOT NULL | 笔记内容 |
| created_at | DATETIME (UTC) | DEFAULT NOW | |
| updated_at | DATETIME (UTC) | DEFAULT NOW | |

> 后端保留，前端已移除（v1.4）。可后续恢复或清理。

### qa_records — 护理问答案记录表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 记录ID |
| user_id | INTEGER | FK→users.id | 提问用户 |
| question | TEXT | NOT NULL | 问题内容 |
| answer | TEXT | NOT NULL | AI 回答 |
| created_at | DATETIME (UTC) | DEFAULT NOW | |

### api_providers — LLM API Provider 表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | Provider ID |
| name | VARCHAR(100) | NOT NULL | 显示名称（如 "DeepSeek 官方"） |
| base_url | VARCHAR(500) | NOT NULL | API 基础地址 |
| api_type | VARCHAR(20) | DEFAULT "openai" | openai / custom |
| description | TEXT | NULLABLE | 备注说明 |
| is_active | BOOLEAN | DEFAULT TRUE | 是否启用 |
| created_at | DATETIME (UTC) | DEFAULT NOW | |
| updated_at | DATETIME (UTC) | DEFAULT NOW | |

### api_keys — API Key 表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | Key ID |
| provider_id | INTEGER | FK→api_providers.id | 所属 Provider |
| key_value | TEXT | NOT NULL | **加密存储**的 API Key（Fernet） |
| key_alias | VARCHAR(100) | NULLABLE | 别名（如 "办公网络用"） |
| model | VARCHAR(50) | NOT NULL | 模型名 |
| priority | INTEGER | DEFAULT 0 | 优先级（越大越优先） |
| weight | INTEGER | DEFAULT 1 | 路由权重 |
| is_active | BOOLEAN | DEFAULT TRUE | 是否启用 |
| rate_limit | INTEGER | NULLABLE | 速率限制 (RPM) |
| circuit_breaker_threshold | INTEGER | DEFAULT 5 | 熔断失败次数阈值 |
| circuit_breaker_cooldown | INTEGER | DEFAULT 60 | 熔断冷却秒数 |
| consecutive_failures | INTEGER | DEFAULT 0 | 连续失败计数 |
| circuit_open_until | DATETIME (UTC) | NULLABLE | 熔断恢复时间 |
| input_price | FLOAT | NOT NULL | 输入价格 ($/1M tokens) |
| output_price | FLOAT | NOT NULL | 输出价格 ($/1M tokens) |
| total_calls | INTEGER | DEFAULT 0 | 累计调用次数 |
| total_cost | FLOAT | DEFAULT 0 | 累计费用(USD) |
| last_used_at | DATETIME (UTC) | NULLABLE | 最后使用时间 |
| last_health_check | DATETIME (UTC) | NULLABLE | 最后健康检查时间 |
| health_status | VARCHAR(20) | DEFAULT "unknown" | healthy / unhealthy / unknown |
| created_at | DATETIME (UTC) | DEFAULT NOW | |
| updated_at | DATETIME (UTC) | DEFAULT NOW | |

### prompt_templates — Prompt 模板表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, 自增 | 模板ID |
| name | VARCHAR(100) | NOT NULL | 模板名称 |
| purpose | VARCHAR(30) | NOT NULL | 用途 (chat / scoring / qa / guard) |
| version | INTEGER | DEFAULT 1 | 版本号 |
| content | TEXT | NOT NULL | 模板内容（支持 `{变量}` 占位） |
| description | TEXT | NULLABLE | 说明 |
| is_active | BOOLEAN | DEFAULT FALSE | 是否当前激活版本 |
| created_at | DATETIME (UTC) | DEFAULT NOW | |
| updated_at | DATETIME (UTC) | DEFAULT NOW | |

唯一约束: `(name, purpose, version)` — 同一用途+名称下版本号唯一
激活规则: 同一 (name, purpose) 下同时只有一个 `is_active=true`

---

## 数据初始化流程

1. 服务启动时通过 Alembic 执行数据库迁移（自动创建表结构）
2. 检查 `users` 表是否为空
3. 若为空，执行种子数据插入：
   - 创建1个教师账号 + 5个学生测试账号
   - 从 `backend/cases/*.json` 读取病例数据并插入
   - 创建默认 DeepSeek Provider + 从 `.env` 读取 `DEEPSEEK_API_KEY` 创建默认 Key
