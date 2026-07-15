# LLM 管理页面重设计

## 目标

将 LLM 管理子页面从"密钥→用途指派"模式重构为"用途→模型指派"模式，消除反直觉交互，让管理员自然理解配置流程。

## 当前问题

1. 密钥管理（API Secrets）和用途路由（Purpose Bindings）混在一个卡片内，层级不清
2. 用途路由默认折叠，密钥创建后需要额外步骤才能绑定，路径不直观
3. "环境变量兜底"作为常驻行混在密钥列表，身份模糊
4. 用途行操作按钮过多（启/停、测试、删除挤在一起），单字按钮不明确
5. 核心交互是"指派密钥"而非"指派模型"——但实际部署通常只有 1 个 Key，模型选择才是真正的决策点

## 设计方案

### 前端

#### 页面整体布局

```
┌──────────────────────────────────────────────┐
│  费用概览（4 张 StatCard，保持现有）           │
├──────────────────────────────────────────────┤
│  API 密钥（紧凑表格列表）                      │
│  可收起/展开，含环境变量兜底行                  │
├──────────────────────────────────────────────┤
│  用途配置（5 张卡片网格，2×3 排布）            │
└──────────────────────────────────────────────┘
```

三层结构，去掉了外层 `"密钥与用途管理"` 包装 Card，两块各自独立。

#### 用途卡片

每张卡片包含：

- **标题行**：用途名称 + 状态指示点（正常/已停用）
- **描述行**：用途说明文字
- **模型选择器**：主交互，下拉选择该密钥支持的模型
- **密钥标识**：当前指派的密钥标签（1 个密钥时只读，多个时可切换）
- **参数标签**：tokens / temperature / 并发数等，只读信息标签
- **开关**：启用/停用该用途的 toggle

卡片示例：

```
┌─────────────────────────────────────┐
│ 💬 患者对话                   ● 正常 │
│ 学生模拟问诊时的患者回复（Flash）      │
│                                     │
│ 模型  [deepseek-v4-flash      ▼]    │
│ 密钥  主密钥 (sk-...abc7)     [✎]   │
│                                     │
│ 512 tokens · temp 0.3 · 50 并发     │
└─────────────────────────────────────┘
```

- 模型选择器值变更 → 更新 `llm_configs.model_override`（后端 PATCH）
- 密钥切换 → 更新 `llm_configs.secret_id`
- 模型下拉选项来源：后端 `/v1/models` 探测对应密钥支持的模型列表
- 参数标签来源：`llm_profile.py` 默认值（只读展示）

#### 密钥管理区

表格式紧凑列表，替代当前的非结构化行列表：

```
API 密钥                           [+ 添加密钥]  [测试连通性]

┌──────────────────────────────────────────────────────────────┐
│ ● 主密钥  sk-...abc7   正常   ¥320.50 / 不限  编辑  删除    │
│ ● 备用    sk-...def3   正常     ¥0.00 / ¥100  编辑  删除    │
├──────────────────────────────────────────────────────────────┤
│ ◐ 环境变量兜底  sk-...****  可用  12次 · ¥0.05      [ℹ️]    │
└──────────────────────────────────────────────────────────────┘
```

- 密钥行：标签、后缀、状态、费用、操作（文字按钮）
- 兜底行有分隔线 + 特殊样式（muted 底色），明确非普通密钥身份
- "测试连通性"测试全部密钥，替代原来放在用途路由区的按钮

#### 状态管理

- 用途的启用/停用通过卡片右上角 toggle 控制 → 调 `toggleConfig` API
- 密钥的编辑 → 复用现有 `SecretModal`（dialog）
- 密钥的删除 → confirm dialog，如有关联用途则提示先解绑
- 不再有"重置"按钮（degraded 状态系统自动恢复，手动干预通过编辑密钥操作）

### 后端

#### Schema 变更

**`llm_configs` 表新增字段：**

```python
# backend/models/llm.py
model_override = Column(String(80), nullable=True, default=None)
```

**Pydantic schema 适配：**

```python
# LLMConfigCreate / LLMConfigUpdate 新增可选字段
model_override: str | None = None

# LLMConfigResponse 新增字段
model_override: str | None = None
```

#### 路由逻辑变更

LLM Router 在解析配置时检查 `model_override`：

```python
def resolve_model(purpose: str, config: LLMConfig | None) -> str:
    if config and config.model_override:
        return config.model_override
    return get_model(purpose)  # llm_profile 默认值
```

即：`model_override` 非空时使用之，否则回退到 `llm_profile.py` 的默认 model。

#### 新增 API（可选）

`GET /api/admin/secrets/{secret_id}/models` — 探测该密钥支持的模型列表（调用 `/v1/models`），供前端模型选择器下拉选项。

如不新增此端点，前端可复用 `POST /configs/{id}/test` 的探测逻辑或在前端缓存已知模型列表。

#### 数据迁移

```sql
ALTER TABLE llm_configs ADD COLUMN model_override VARCHAR(80);
```

- 迁移类型：DDL（`ddl/` 目录）
- 现有行 `model_override` 均为 NULL，行为不变

### 组件拆分

当前 `ApiManagementTab.tsx`（552 行单文件）拆为：

| 组件 | 职责 | 行数估算 |
|------|------|---------|
| `ApiManagementTab.tsx` | 组合容器，数据查询 + 状态管理 | ~100 |
| `SecretList.tsx` | 密钥表格 + 兜底行 | ~120 |
| `PurposeCardGrid.tsx` | 5 卡片网格容器 | ~30 |
| `PurposeCard.tsx` | 单张用途卡片 | ~130 |
| `SecretModal.tsx` | 保持现有，无需改动 | — |

### 不涉及的部分

- `CostDashboard.tsx` — 费用仪表盘不变
- `MonitorTab.tsx` — LLM 调用监控不变
- `CallLogDetail.tsx` / `CallLogTimeline.tsx` — 调用日志不变
- `SystemOpsPage.tsx` — 系统运维页不变
- `LLMAPITab.tsx` — 入口组件微调（去掉 Card 包装）
- `llm_profile.py` — profile 默认值不变，model 覆盖通过 `llm_configs.model_override` 实现

### 风险

- `model_override` 未校验模型名有效性 — 填写无效模型名会导致 LLM 调用失败。前端下拉框限制可选项可降低风险
- 探测模型列表依赖密钥 API 可用性 — 网络故障时下拉框可能为空，需前端兜底（允许手动输入 + 显示 profile 默认模型作为参考）
