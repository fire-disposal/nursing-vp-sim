# LLM 管理系统完整设计

> 2026-06-03 | Greenfield design — 从功能需求出发，不受历史包袱约束

---

## 需求模型

一个护理教学系统需要的 LLM 能力：

```
教师/管理员          系统运行时              学生
──────────          ──────────              ────
配置 API 密钥   →   路由选择 config    →    对话/问答/评分
指定用途与模型  →   熔断与回退         →    无感知
查看调用成本    →   日志与统计         →    无感知
```

核心流程只有一条链：**配置 → 路由 → 调用 → 监控**。所有设计围绕这条链展开。

---

## 实体模型

### 决策：Provider 不作为 DB 实体

Provider 信息（有哪些厂商、各自的 base_url、支持哪些模型）是**静态配置**，变化频率极低。用 JSON 文件管理比 DB 表更好：
- 更新模型列表不需要 migration
- 部署时可通过 volume 挂载覆盖
- 版本控制友好
- 无需维护 DB 数据一致性

Provider 分类通过 `base_url` 前缀匹配 JSON 推断，不存 DB 列。

### 两表模型

```
┌─ ApiSecret ─────────────────────┐
│ id                              │
│ label          标注名            │
│ encrypted_key  加密的 API key    │
│ key_suffix     key 末尾 4 位     │
│ base_url ★     API 端点 (NEW)   │
│ created_at                      │
│ updated_at                      │
└────────┬────────────────────────┘
         │ 1:N
         ▼
┌─ LLMConfig ─────────────────────────────┐
│ id                                      │
│ secret_id     FK → ApiSecret            │
│ label         标注（如"评分用Pro"）       │
│ model         模型名                     │
│ purpose       用途                       │
│ priority      优先级（越小越优先）        │
│ weight ★      同 priority 权重 (NEW)     │
│ status        状态: active/degraded/disabled│
│ degraded_reason                        │
│ degraded_until                         │
│ price_input_per_1m    定价              │
│ price_output_per_1m                     │
│ monthly_cost_limit                      │
│ call_count_today   运行时统计            │
│ total_tokens_today                     │
│ total_cost_today                        │
│ monthly_cost_used                       │
│ consecutive_failures                    │
│ last_used_at                            │
│ created_at / updated_at                 │
│                                         │
│ UNIQUE(purpose, priority)               │
└─────────────────────────────────────────┘
```

★ 标记为新增/变更字段。其余保持不变。

**设计原则**：
- `base_url` 上移到 Secret — 因为"这个 key 对应这个端点"是常识，不应在每条 Config 重复
- `weight` — 恢复为同 priority 负载均衡，实现成本仅一行 `random.choices()`
- 不新增其他列 — 当前两表已经充分表达所有语义

---

## Provider 目录

### 文件格式

`backend/providers.json`：

```json
{
  "providers": [
    {
      "id": "deepseek",
      "display_name": "DeepSeek",
      "base_url": "https://api.deepseek.com",
      "models": [
        {"name": "deepseek-v4-pro",   "price_input": 1.0, "price_output": 2.0},
        {"name": "deepseek-v4-flash", "price_input": 0.5, "price_output": 0.5}
      ]
    },
    {
      "id": "openai",
      "display_name": "OpenAI",
      "base_url": "https://api.openai.com/v1",
      "models": [
        {"name": "gpt-4o",      "price_input": 2.5,  "price_output": 10.0},
        {"name": "gpt-4o-mini", "price_input": 0.15, "price_output": 0.6}
      ]
    },
    {
      "id": "ollama",
      "display_name": "Ollama (本地)",
      "base_url": "http://localhost:11434",
      "models": []
    },
    {
      "id": "custom",
      "display_name": "自定义",
      "base_url": "",
      "models": []
    }
  ]
}
```

### Provider 推断

```python
# backend/services/provider_catalog.py (新文件)
import json
from pathlib import Path

_catalog = None

def load_catalog() -> dict:
    global _catalog
    if _catalog is None:
        path = Path(__file__).parent.parent / "providers.json"
        _catalog = json.loads(path.read_text(encoding="utf-8"))
    return _catalog

def match_provider(base_url: str) -> dict | None:
    """根据 base_url 匹配 provider 条目"""
    catalog = load_catalog()
    for p in catalog["providers"]:
        if p["base_url"] and base_url.startswith(p["base_url"]):
            return p
    return None

def infer_provider_name(base_url: str) -> str:
    p = match_provider(base_url)
    return p["id"] if p else base_url.split("://")[-1].split("/")[0]
```

零 DB 存储。URL 推断失败时使用域名作为 fallback 名称。

---

## API 设计

### 命名与路径

所有端点统归 `/api/admin/llm/` 前缀（从 `/api/admin/api/` 迁移），语义更明确。

```
# 密钥管理
GET    /api/admin/llm/secrets
POST   /api/admin/llm/secrets
PUT    /api/admin/llm/secrets/{id}
DELETE /api/admin/llm/secrets/{id}

# 用途配置
GET    /api/admin/llm/configs          ?purpose=&secret_id=
POST   /api/admin/llm/configs
PUT    /api/admin/llm/configs/{id}
DELETE /api/admin/llm/configs/{id}
POST   /api/admin/llm/configs/{id}/toggle
POST   /api/admin/llm/configs/{id}/reset
POST   /api/admin/llm/configs/{id}/test
POST   /api/admin/llm/configs/test-all

# Provider 目录 (NEW)
GET    /api/admin/llm/catalog

# 路由控制
POST   /api/admin/llm/reload

# 环境兜底
GET    /api/admin/llm/fallback
POST   /api/admin/llm/fallback/test

# 监控 (路径不变)
GET    /api/admin/llm-stats
GET    /api/admin/llm-logs
GET    /api/admin/llm-logs/{id}
GET    /api/admin/llm-logs/export
```

### 权限

全部端点使用 `require_permission("api_manage")` 替代 `require_teacher`，为 admin/teacher 角色切割预留。

### 响应结构

```python
# Secret 列表项新增 provider 计算字段
class ApiSecretResponse:
    id, label, key_suffix, base_url,          # 原有 + base_url
    provider: str                              # ★ NEW: infer_provider_name(base_url)
    config_count, total_cost_today, monthly_cost_used
    created_at, updated_at

# Config 列表项
class LLMConfigResponse:
    id, secret_id, secret_label, secret_suffix,  # 关联信息
    label, model, purpose, priority, weight,     # weight ★ NEW
    base_url,                                     # 改为读 secret.base_url || 自身
    provider: str,                                # ★ NEW: 推断
    status, degraded_reason, degraded_until,
    price_input_per_1m, price_output_per_1m, monthly_cost_limit,
    call_count_today, total_tokens_today, total_cost_today,
    monthly_cost_used, consecutive_failures, last_used_at,
    created_at, updated_at
```

### Catalog API

```
GET /api/admin/llm/catalog
```

返回完整 provider 列表（含模型和定价），前端用其渲染模型下拉菜单。

---

## 路由逻辑

### 选择算法

```
select(purpose):
  获取 purpose 对应 configs，按 priority ASC

  对每个 priority 组：
    可用候选 = 过滤掉 disabled 和 冷却中的 degraded
    if 候选为空: continue（下沉到下一 priority）

    加权随机 = random.choices(候选, weights=[c.weight for c in 候选])
    返回选中的 config

  purpose 专属全部耗尽 →
    对 purpose="*" 重复上述过程

  "*" 也全部耗尽 →
    尝试 .env DEEPSEEK_API_KEY (_SyntheticConfig)

    也没有 →
      global_degraded(30s) + raise RuntimeError
```

### 熔断（不变）

| 触发 | 状态 | TTL | 恢复 |
|------|------|-----|------|
| 连续 5 次失败 | degraded | 300s | TTL 到期 |
| HTTP 429 | degraded | 60s | TTL 到期 |
| 月度费用超限 | degraded | 下月 1 日 | TTL 到期 |
| 手动停用 | disabled | 无 | 仅手动 reset |
| 任何成功 | active | — | 立即清除计数器 |

### base_url 读取（兼容期）

```python
base_url = getattr(getattr(config, 'secret', None), 'base_url', None) or config.base_url
```

兼容期内双读。后续版本可移除 `config.base_url` 列。

---

## 前端设计

### 核心思路：一个页面看全部

当前问题是 Config / Secret / Health 三个子标签页割裂。新设计用一个统一页面解决。

### 布局

```
┌──────────────────────────────────────────────────────────┐
│  LLM 管理                                                │
│                                                           │
│  ┌─ 环境兜底 ──────────────────────────────────────────┐ │
│  │ DeepSeek · sk-...abcd · ● 可用          [测试连通]  │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌─ API 密钥 ──────────────────────────────────────────┐ │
│  │                                                       │ │
│  │  ┌──────────────┐  ┌──────────────┐                  │ │
│  │  │ DeepSeek     │  │ Ollama 本地  │  [+ 添加密钥]   │ │
│  │  │ sk-...abcd   │  │ (无 key)     │                  │ │
│  │  │ 3 配置 · 活跃│  │ 1 配置 · 待用│                  │ │
│  │  │ ¥0.01 / ¥1.2│  │ ¥0 / ¥0     │                  │ │
│  │  └──────────────┘  └──────────────┘                  │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌─ 用途配置 ─────── [+ 添加配置] ─────────────────────┐ │
│  │                                                       │ │
│  │ ▼ 患者对话 (patient_chat)                             │ │
│  │  pri  label        key      model           status    │ │
│  │  10   Flash·对话   DeepSeek  deepseek-v4-.. ● 活跃   │ │
│  │                               调用 42 · ¥0.01        │ │
│  │                                                       │ │
│  │ ▼ 评分 (scoring)                                      │ │
│  │  pri  label        key      model           status    │ │
│  │  10   Pro·评分     DeepSeek  deepseek-v4-.. ● 活跃   │ │
│  │                               调用 3 · ¥0.005        │ │
│  │                                                       │ │
│  │ ▼ 通配 (兜底)                                          │ │
│  │  pri  label        key      model           status    │ │
│  │  100  Ollama·本地  Ollama   qwen2.5:7b      ○ 禁用   │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌─ 路由预览 ──────────────────────────────────────────┐ │
│  │  patient_chat → Flash(10) → 通配·Ollama(100,禁用)     │ │
│  │  scoring     → Pro(10)   → 通配·Ollama(100,禁用)     │ │
│  │  qa          → (无配置)  → 通配·Ollama(100,禁用)     │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  [测试全部连接] [重载路由]                                │
└──────────────────────────────────────────────────────────┘
```

### 交互说明

**环境兜底栏**：折叠式 banner，默认收缩只显示状态行。展开显示模型、端点、延迟详情。

**密钥卡片行**：横向卡片，每张显示 provider 图标、key 脱敏信息、关联 config 数量、成本合计。点击卡片进入编辑弹窗。"添加"按钮在最右。

**用途配置区**：按 purpose 分组（可折叠）。每组显示该 purpose 的所有 config + 通配 config（灰色标记）。表内每行显示关联密钥标签（带 provider 色标）、模型名、状态徽标。操作按钮：编辑/开关/测试/删除。

**路由预览**：紧凑的一行文字，展示每个 purpose 的路由链。绿色=当前选用，灰色=跳过/禁用，红色=无可用。

### Config 创建/编辑弹窗

```
┌─ 添加配置 ───────────────────────┐
│                                  │
│  关联密钥  [DeepSeek ▼]          │  ← 选择后自动加载模型列表
│            base_url: api.deep... │  ← 只读，继承自密钥
│                                  │
│  模型      [deepseek-v4-flash ▼] │  ← 下拉预设 + 可自定义输入
│            或输入自定义模型名     │
│                                  │
│  用途      [患者对话 ▼]          │  ← 下拉：通配/QA/对话/评分/病例
│                                  │
│  优先级    10                    │  ← 默认取值该 purpose 最大+10
│                                  │
│  权重      10                    │  ← 1-100，同 priority 负载均衡
│                                  │
│  定价      ┌──────┬──────┐      │
│            │ 入 ¥1│ 出 ¥2│      │  ← 选择模型后自动填，可覆盖
│            └──────┴──────┘      │
│                                  │
│  月度预算  [________] 元 (可选)  │
│                                  │
│            [取消]  [保存]        │
└──────────────────────────────────┘
```

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| **后端** | | |
| `backend/providers.json` | 新增 | Provider 目录配置 |
| `backend/services/provider_catalog.py` | 新增 | 目录加载 + URL 匹配 |
| `backend/models.py` | 改造 | ApiSecret +base_url; LLMConfig +weight |
| `backend/schemas.py` | 改造 | 响应加 provider/weight/base_url |
| `backend/routers/admin_api.py` | 重构 | 端点迁移到 `/admin/llm/`，加 catalog 端点 |
| `backend/services/llm_router.py` | 改造 | 加权随机选择；base_url 双读 |
| `backend/services/llm_service.py` | 改造 | provider_name 修正；base_url 双读 |
| `backend/main.py` | 改造 | seed 适配 base_url |
| **前端** | | |
| `frontend/src/api/api-client.ts` | 改造 | 端点路径更新 + catalog 调用 |
| `frontend/src/api/api-types.gen.ts` | 重新生成 | 新 schema 类型 |
| `frontend/src/components/teacher/ApiManagementTab.tsx` | 重写 | 统一单页布局 |
| `frontend/src/components/teacher/ConfigModal.tsx` | 改造 | 模型下拉动态加载 |
| `frontend/src/components/teacher/SecretModal.tsx` | 改造 | 增加 base_url 字段 |
| **迁移** | | |
| Alembic migration | 新增 | api_secrets +base_url; llm_configs +weight |

### 保留不变的文件

| 文件 | 说明 |
|------|------|
| `backend/services/llm_logging.py` | 批量日志写入（路径适配即可） |
| `backend/services/llm_cache.py` | 响应去重缓存 |
| `backend/services/patient_guard.py` | 角色安全护栏 |
| `backend/services/prompt_manager.py` | Prompt 管理 |
| `backend/services/variable_registry.py` | 变量注册 |
| `backend/services/crypto_utils.py` | 加密 |
| `backend/services/scoring.py` | 评分服务 |
| `backend/routers/admin_prompts.py` | Prompt 管理端点 |
| `backend/routers/admin.py` | LLM 监控端点 |
| `frontend/src/components/teacher/MonitorTab.tsx` | 监控页 |
| `frontend/src/components/teacher/PromptManagementTab.tsx` | Prompt 页 |
| `frontend/src/components/teacher/RubricTab.tsx` | 评分标准页 |

---

## 迁移策略

### Alembic migration

```python
def upgrade():
    op.add_column('api_secrets', sa.Column('base_url', sa.String(200), nullable=False, server_default=''))
    op.add_column('llm_configs', sa.Column('weight', sa.Integer(), nullable=False, server_default='1'))

def downgrade():
    op.drop_column('api_secrets', 'base_url')
    op.drop_column('llm_configs', 'weight')
```

### 数据回填（migration 后手动执行）

```sql
UPDATE api_secrets s
SET base_url = (
    SELECT c.base_url FROM llm_configs c
    WHERE c.secret_id = s.id AND c.base_url != ''
    LIMIT 1
)
WHERE s.base_url = '';
```

### 端点迁移

新旧端点共存一个版本：旧路径 `/api/admin/api/*` 保留并内部转发到新路径 `/api/admin/llm/*`。下一版本移除旧路径。

### LLMConfig.base_url 移除

`llm_configs.base_url` 列保留，标记 deprecated。路由逻辑双读。全部稳定后单独 migration 移除。

---

## 设计原则总结

| 原则 | 体现 |
|------|------|
| 只有痛点才改 | 不加 provider 独立表、不加健康探测（TTL+回退链够用） |
| 低成本高收益 | weight 一行代码、providers 一个 JSON、base_url 一次 migration |
| 推断优于存储 | provider 分类不存 DB，URL 匹配推断 |
| 一个页面管全部 | 前端合并三标签为一个统一视图 |
| 权限边界清晰 | `api_manage` 而非 `require_teacher` |
| 兼容期不破坏 | 双读 base_url，新旧端点共存 |
