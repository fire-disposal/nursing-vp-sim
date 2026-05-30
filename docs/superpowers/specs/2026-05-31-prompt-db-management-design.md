# Prompt 模板 DB 化 + 热管理 — 架构设计

> 2026-05-31 | feature/multi-api-management

## 动机

当前所有 LLM 提示词（system prompt / user prompt template）硬编码在 `backend/prompts.py` 中，痛点：

- 修改提示词需要重新部署
- 无法 A/B 测试不同 prompt 版本的效果
- 没有 prompt 变更历史和版本管理
- 无法在运行时观察 prompt 的调用成本/成功率

**目标：** 将 prompt 模板完全数据库化，支持版本管理、运行时热切换、变量模板渲染，并提供统一的回退策略。

---

## 变更范围总览

| 变更 | 类型 |
|------|------|
| 新增 `prompt_templates` 表 | Migration |
| 新增 `backend/services/prompt_manager.py`（PromptManager 单例 + PromptTemplate 类） | 新增 |
| 改造 `routers/qa.py`、`routers/chat.py`、`services/scoring.py` 的 prompt 获取方式 | 改造 |
| 新增 `backend/routers/admin_prompts.py`（CRUD 端点） | 新增 |
| 新增 `frontend/src/components/teacher/PromptManagementTab.jsx` | 新增 |
| `backend/prompts.py` 保留为 fallback 默认值 / seed 源 | 不变 |

---

## 1. 数据库 Schema

### `prompt_templates`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO_INCREMENT | |
| purpose | VARCHAR(40) NOT NULL | `patient_chat` / `scoring` / `qa` / `summary` |
| version | INT NOT NULL DEFAULT 1 | 同 purpose 下递增 |
| name | VARCHAR(80) | 管理员可读名称，如 "v3-精细化评分" |
| system_prompt | TEXT NOT NULL | system role 模板（含 `{var}` 占位） |
| user_prompt | TEXT | user role 模板（可选，scoring 需要） |
| template_engine | VARCHAR(20) DEFAULT 'format' | Python `str.format`，预留 `jinja2` 扩展 |
| variables | JSON | `[{"name": "patient_name", "desc": "患者姓名"}, ...]` |
| is_active | BOOL DEFAULT FALSE | 同 purpose 下有且仅有一条 active |
| created_by | VARCHAR(80) | |
| remark | TEXT | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

约束：
- 唯一键：`(purpose, version)` 防止重复版本号
- 应用层保证：同一 purpose 下只有一行 `is_active=true`

---

## 2. 运行时架构

### `PromptTemplate` 类

```python
class PromptTemplate:
    """单个 prompt 模板，支持变量渲染"""
    id: int
    purpose: str
    version: int
    system_prompt: str       # 含 {var} 占位的模板
    user_prompt: str | None
    variables: list[dict]

    def render(self, **kwargs) -> str:
        """渲染 system_prompt，校验所有变量"""

    def render_pair(self, **kwargs) -> tuple[str, str]:
        """渲染 system + user prompt 对（scoring 场景）"""
```

### `PromptManager` 单例

```python
class PromptManager:
    _cache: dict[str, PromptTemplate]   # purpose → 当前 active 模板
    _last_valid_cache: dict | None
    _lock: asyncio.Lock

    async def load_from_db(self):
        """从 DB 加载所有 is_active=True 的模板到内存
        若某 purpose 无 active 记录 → seed 默认值写入 DB
        若 DB 连接失败 → 保留 _last_valid_cache
        若校验失败（模板语法错误）→ 保留旧缓存 + ERROR 日志
        """

    async def get(self, purpose: str) -> PromptTemplate:
        """
        优先级：
        1. 内存缓存命中 → 直接返回
        2. 缓存未命中 → 触发 load_from_db → 重新获取
        3. DB 加载失败 → 降至 4
        4. 所有兜底失败 → 使用 _hardcoded_fallback(purpose)
        """

    async def reload(self):
        """热加载，管理员修改后调用"""

    def _hardcoded_fallback(self, purpose: str) -> PromptTemplate:
        """从 prompts.py 硬编码构造 PromptTemplate 返回（不写 DB）"""
```

### 调用方集成

```
┌─────────────────┐
│   routers/qa.py  │──► prompt = await mgr.get("qa")
│                  │     messages = [{"role":"system", "content": prompt.system_prompt}]
└─────────────────┘

┌─────────────────┐
│  routers/chat.py │──► prompt = await mgr.get("patient_chat")
│                  │     system = prompt.render(
│                  │         patient_name=..., chief_complaint=...,
│                  │         present_illness=..., ...
│                  │     )
│                  │     messages = [{"role":"system", "content": system}, ...]
└─────────────────┘

┌──────────────────┐
│ services/scoring  │──► prompt = await mgr.get("scoring")
│                  │     system, user = prompt.render_pair(
│                  │         rubric_dim_text=...,
│                  │         rubric_json_template=...,
│                  │         required_inquiries=...,
│                  │         conversation_text=...,
│                  │     )
│                  │     messages = [{"role":"system","content": system},
│                  │                 {"role":"user","content": user}]
└──────────────────┘
```

---

## 3. 回退方案（核心保障）

| 场景 | 行为 |
|------|------|
| 首次启动，DB 中无任何 prompt_templates | `load_from_db` 检测到空表 → 从 `prompts.py` 硬编码写入 seed 数据到 DB，设 `is_active=true` |
| DB 连接超时/失败 | 保留 `_last_valid_cache`，WARN 日志，返回缓存值 |
| 某 purpose 无 active 记录（被管理员误删） | 直接从 `prompts.py` 硬编码构造 `PromptTemplate` 返回（`_hardcoded_fallback`），不写 DB |
| 热加载后新模板有 `str.format` 语法错误 | 校验不通过 → 保留旧缓存 + ERROR 日志，热加载失败告警 |
| 模板变量缺失（调用方未提供某变量） | `str.format` 抛出 `KeyError` → 记录 ERROR 日志 + 返回完整错误信息到日志 |
| 所有缓存丢失 + DB 不可用 | `_hardcoded_fallback` 生效，服务降级但不停机 |

**关键设计原则：** `prompts.py` 永远不会被删除，始终作为"源码级别的最终保底"。PromptManager 的最内层兜底就是 `_hardcoded_fallback()`。

---

## 4. Web UI 管理面板

管理侧边栏 **「API 管理」** 下新增 **「Prompt 管理」** Tab：

### 4.1 Prompt 列表

- 按 `purpose` 筛选（下拉：patient_chat / scoring / qa）
- 表格：版本号、名称、is_active 标记、变量数量、创建人、更新时间
- 操作栏：新建版本、激活、删除

### 4.2 新建/编辑弹窗

- Purpose 选择（创建后不可改）
- 版本号自动递增
- 名称输入
- System Prompt 编辑器（大文本框，等宽字体，语法高亮 `{var}` 占位符）
- User Prompt 编辑器（可选，仅 scoring 显示）
- Variables 配置面板：
  - 自动从模板中提取 `{xxx}` 变量名
  - 管理员补充 desc 描述
  - 校验：模板中未声明的变量标红警告
- 「校验语法」按钮 → 调用后端 `/api/admin/prompts/validate`
- 保存后提示是否立即激活

### 4.3 激活流程

- 点击激活 → PUT `/api/admin/prompts/{id}/activate`
- 后端：同 purpose 下取消所有 `is_active` → 设目标行 `is_active=true` → 自动触发 `PromptManager.reload()`

---

## 5. API 端点

```
GET    /api/admin/prompts?purpose=              → 列表（支持 purpose 筛选）
POST   /api/admin/prompts                       → 新建版本
PUT    /api/admin/prompts/{id}                   → 编辑模板
DELETE /api/admin/prompts/{id}                   → 删除（不能删除当前 active）
POST   /api/admin/prompts/{id}/activate          → 激活版本
POST   /api/admin/prompts/validate               → 模板语法校验
POST   /api/admin/prompts/reload                 → 强制热加载
```

---

## 6. 迁移策略

### 阶段 1 — 兼容过渡

1. `prompt_templates` 表新建
2. 启动时若表中无 `is_active=true` 的记录 → 从 `prompts.py` 写入 seed
3. `PromptManager.get()` 优先读 DB → 回退到 `prompts.py`
4. 现有功能完全不受影响

### 阶段 2 — 割接

5. 管理员通过 UI 编辑 prompt 并激活，`PromptManager.reload()` 即时生效
6. `prompts.py` 的 `build_patient_system_prompt()` 和 `build_scoring_prompt_from_rubric()` 保留为 fallback 函数

### 阶段 3 — 清理（后续大版本）

7. 移除 `prompts.py` 中的主逻辑，仅保留 fallback 函数
8. 前端渲染不再依赖硬编码 prompt 路径

---

## 7. 模板变量定义

### patient_chat 变量

| 变量名 | 来源 | 说明 |
|--------|------|------|
| `patient_name` | case JSON.`patient_info.name` | 患者姓名 |
| `patient_age` | case JSON.`patient_info.age` | 患者年龄 |
| `patient_gender` | case JSON.`patient_info.gender` | 患者性别 |
| `chief_complaint` | case JSON.`chief_complaint` | 主诉 |
| `present_illness` | case JSON.`present_illness` | 现病史 |
| `past_history` | case JSON.`past_history` | 既往史 |
| `medication_history` | case JSON.`medication_history` | 用药史 |
| `allergy_history` | case JSON.`allergy_history` | 过敏史 |
| `family_history` | case JSON.`family_history` | 家族史 |
| `social_history` | case JSON.`social_history` | 社会史 |
| `communication_style` | case JSON.`communication_style` | 沟通风格描述 |
| `hidden_info_rules` | `build_patient_system_prompt` 预计算 | 已触发的隐藏信息规则 |

### scoring 变量

| 变量名 | 来源 | 说明 |
|--------|------|------|
| `rubric_dim_text` | rubric JSON → 预计算文本 | 评分维度人类可读描述 |
| `rubric_json_template` | rubric JSON → 预计算 JSON | LLM 返回 JSON 格式模板 |
| `required_inquiries` | case JSON.`required_inquiries` | 必要采集内容清单 |
| `conversation_text` | DB 对话记录 | 完整对话文本 |

### qa 变量

无变量。纯 system prompt 文本。

---

## 8. 与 multi-api-management 分支的关系

Prompt 管理和 API 管理的架构模式完全一致：

| 维度 | API 管理 (已实现) | Prompt 管理 (新增) |
|------|-------------------|---------------------|
| 数据模型 | `api_providers` / `api_keys` / `api_key_rules` | `prompt_templates` |
| 内存缓存 | `LLMRouter._cache` | `PromptManager._cache` |
| 热重载 | `LLMRouter.load_from_db` / `refresh_router()` | `PromptManager.load_from_db` / `reload()` |
| 回退策略 | `_last_valid_cache` → .env | `_last_valid_cache` → `prompts.py` |
| 路由键 | `purpose` | `purpose` |
| Admin API | `routers/admin_api.py` | `routers/admin_prompts.py` |
| 前端 Tab | `ApiManagementTab` | `PromptManagementTab` |
| Seed 策略 | 启动时从 .env 写入 DB | 启动时从 `prompts.py` 写入 DB |

两者共享同一个 `purpose` 命名空间，Log 层 (`LLMCallLog`) 天然可以关联 key 版本 + prompt 版本的成本分析。

---

## 9. 可靠性设计

| 场景 | 行为 |
|------|------|
| 热加载导致零可用 prompt | 校验失败 → 保留上次缓存 + ERROR 日志 |
| DB 断连加载失败 | 保留上次缓存 + 降级 `prompts.py` + WARN 日志 |
| 所有 purpose 的 prompt 都丢失 | `_hardcoded_fallback` 生效，服务降级但不停机 |
| 热加载 | 新配置校验通过 → atomic swap 缓存，零停机 |
| 模板变量缺失 | `str.format` 抛 `KeyError` → ERROR 日志 + 失败返回 |
| 并发请求 | PromptManager 读不加锁，写（reload）用 `asyncio.Lock` |

---

## 10. 安全设计

| 威胁 | 对策 |
|------|------|
| 恶意 prompt 注入 | 仅管理员可编辑，audit log 记录 `created_by` |
| Prompt 泄露到前端 | API 返回完整 system_prompt（管理员可见），普通用户不可访问 prompt 端点 |
| 模板注入 (SSTI) | 使用 Python `str.format()` 而非 `eval()`，可变变量内容来自可信数据源 |
