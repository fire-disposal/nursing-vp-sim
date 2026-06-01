# API 管理简化设计

## 动机

当前 Provider → Key 两层模型存在以下问题：

1. **概念过载**：purpose、model、priority、weight 分散在 Provider 和 Key 之间，`Key.priority` 甚至未被路由逻辑使用
2. **"不同用途配不同模型"难以实现**：需为同一 API key 创建多条记录，且须在 Provider/Key 两层协调
3. **状态模型不完整**：熔断只有 `disabled`（永久），无自动恢复，多种不可用原因（手动、429、连续失败、超支）共用同一状态
4. **无真正的容灾降级**：当前 provider.priority → key.weight 两层路由，实际行为是隐藏的加权随机而非显式的优先级降级

## 目标

- 两个实体：`ApiSecret`（凭证）+ `LLMConfig`（用途配置）
- 每个用途按 priority 排序的配置列表，选中 active 的 top priority，熔断则降级
- 完善状态模型：四种不可用原因，各有 TTL 和恢复方式
- LLMConfig 支持表单视图 + JSON 视图双模编辑

## 实体模型

### ApiSecret（密钥凭证）

纯认证容器，不参与路由逻辑。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int PK | |
| label | varchar(80) | 如 "DeepSeek 个人账号" |
| encrypted_key | text | 加密存储的 API key |
| key_suffix | varchar(8) | key 尾 4 位 |

### LLMConfig（用途配置）

计费单位，路由单位。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int PK | |
| secret_id | int FK → ApiSecret | 关联密钥凭证 |
| label | varchar(80) | 如 "QA 用 Pro 模型" |
| base_url | varchar(200) | API 端点 |
| model | varchar(80) | 如 deepseek-v4-pro |
| purpose | varchar(40) | qa / scoring / patient_chat / case_generation |
| priority | int | 用途内排序，越小越优先 |
| status | varchar(20) | active / degraded / disabled |
| degraded_reason | varchar(40) | consecutive_failures / rate_limited / cost_exceeded |
| degraded_until | datetime | TTL，NULL 表示无自动恢复 |
| monthly_cost_limit | numeric | 月度费用上限 |
| weight | int | 保留字段，当前不用（标记为 deprecated，为未来负载均衡预留） |
| price_input_per_1m | numeric | 入价/百万token |
| price_output_per_1m | numeric | 出价/百万token |
| call_count_today | int | 今日调用次数 |
| total_tokens_today | bigint | 今日总 token |
| total_cost_today | numeric | 今日总费用 |
| monthly_cost_used | numeric | 本月已用费用 |
| stats_date | date | 统计日期（用于日重置） |
| consecutive_failures | int | 连续失败计数，路由时用于判断熔断 |
| last_used_at | datetime | 最后使用时间 |

**约束**：`(purpose, priority)` unique，同用途内优先级不重复。

**注**：
- `degraded_reason` 为系统写入、只读字段，不暴露在编辑器中
- 原 `rate_limit_until` 字段已合并到 `degraded_until` + `degraded_reason='rate_limited'`，429 冷却统一走 degraded 机制

## 路由规则

```
purpose="scoring" 的配置（按 priority ASC）:
  priority=1  LLMConfig "评分R1"     active    → 使用
  priority=2  LLMConfig "评分V4"     degraded  → 跳过（冷却中）
  priority=3  LLMConfig "评分Flash"  disabled  → 跳过（手动关）
  priority=4  LLMConfig "评分Pro"    active    → 使用（降级到）

遍历 → 跳过 degraded/disabled → 返回第一个 active
全不可用 → RuntimeError("该用途无可用配置")
```

## 状态模型

| 触发原因 | 状态变化 | TTL | 恢复方式 |
|---------|---------|-----|---------|
| 手动停用 | → disabled | 无 | 仅手动 reset |
| 连续失败 ≥5 | → degraded | 5 min | TTL 到自动恢复，或手动 reset |
| 收到 HTTP 429 | → degraded | 60 s | TTL 到自动恢复 |
| 月度费用超限 | → degraded | 到下月 1 日 00:00 | TTL 到自动恢复，或手动 reset |

路由检索时：`degraded` + `now > degraded_until` → 自动切回 `active`。

`disabled` 永不自动恢复。

## 计费

| 维度 | 方式 |
|------|------|
| 单个 LLMConfig | `LLMConfig.total_cost_today`, `monthly_cost_used` |
| 同一 Secret 聚合 | `SUM(LLMConfig.*) WHERE secret_id = X`，用于 API 面板查询 |
| 同一 purpose 聚合 | `SUM(LLMConfig.*) WHERE purpose = 'qa'` |

## API 端点变更

### 新增

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/admin/secrets` | 密钥 CRUD |
| PUT/DELETE | `/api/admin/secrets/{id}` | |
| GET/POST | `/api/admin/configs` | 配置 CRUD |
| PUT/DELETE | `/api/admin/configs/{id}` | |
| POST | `/api/admin/configs/{id}/toggle` | 手动切换 active ↔ disabled |
| POST | `/api/admin/configs/{id}/reset` | 手动恢复（清 degraded 字段 → active） |
| POST | `/api/admin/configs/{id}/test` | 连通性测试 |

### 移除

| 路径 | 说明 |
|------|------|
| `/api/admin/api/providers` | Provider 层删除 |
| `/api/admin/api/keys` | 替换为 configs |
| `/api/admin/api/keys/deepseek` | 快捷添加，改为 configs 端点 |

### 保留兼容

| 原路径 | 行为 |
|------|------|
| `/api/admin/llm-stats` | 统计改为从 LLMConfig 聚合 |
| `/api/admin/llm-logs` | 无变化 |
| `/api/admin/api/health` | 改为 ping 各 config 的 base_url |

## 前端变更

### 管理面板

- **API 密钥** 标签页 → 管理 ApiSecret
- **用途配置** 标签页 → 管理 LLMConfig，按 purpose 分组显示
- 配置编辑器：表单视图 + JSON 视图切换
  - 表单视图：逐字段编辑，下拉选 purpose/secret
  - JSON 视图：一个 `<textarea>` 编辑完整 JSON，保存时 schema 校验
  - 双向同步：切模式时自动序列化/反序列化

### JSON 视图 Schema

```json
{
  "id": 1,
  "secret_id": 1,
  "label": "QA用Pro模型",
  "base_url": "https://api.deepseek.com",
  "model": "deepseek-v4-pro",
  "purpose": "qa",
  "priority": 10,
  "status": "active",
  "monthly_cost_limit": 100.0,
  "price_input_per_1m": 1.0,
  "price_output_per_1m": 2.0
}
```

## 迁移策略

1. Alembic 迁移创建 `api_secrets` + `llm_configs` 表
2. 数据迁移：每个 `(encrypted_key, key_suffix)` 唯一组合生成一个 ApiSecret；每条 `api_keys` 行生成对应的 LLMConfig（从 `api_providers` 取 `base_url`）
3. 路由层替换 `LLMRouter.select_key()` → 基于 LLMConfig 的遍历逻辑
4. 前端重构管理面板（Secrets 页 + Configs 页）
5. 标记旧表（`api_providers`, `api_keys`）为 deprecated，保留数据不下线，后续版本清理

## 回滚方案

### 自动回滚（CD 管道）

部署流水线在 `docker compose up -d` 后执行健康检查（轮询 Docker health + curl /api/health）。如健康检查失败，自动执行：

1. 将 compose 文件中的 image 标签还原为部署前的版本
2. `docker compose down && docker compose up -d`
3. 输出告警日志

### 手动恢复（数据库层面）

Alembic 迁移在 PostgreSQL 上是事务性的。如果迁移失败，数据库自动回到迁移前状态（`api_secrets` 和 `llm_configs` 表不存在，`api_providers` 和 `api_keys` 保持不变）。

若需手动回滚已成功的迁移：
```bash
docker exec nursing-vp-sim-backend-1 alembic downgrade -1
```

### 快照恢复（极端情况）

部署前 CD 自动执行 `pg_dump` 备份。极端情况下手动恢复：
```bash
docker exec -i nursing-db psql -U nursing -d nursing_vp < /opt/nursing-vp-sim/backups/pre-deploy-XXXX.sql
docker compose restart backend
```

### 同 Purpose 同 Priority 冲突处理

迁移使用 `ROW_NUMBER()` 窗口函数去重：同一 purpose 内，第 N 个重复 key 的 priority 自动 = 原始 priority + (N-1)，确保 `UNIQUE(purpose, priority)` 约束不触发冲突。
