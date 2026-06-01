# Prompt Variable Registry — 工程设计 Spec

## 背景

当前系统的 Prompt 模板系统基础架构扎实（版本化、热重载、硬编码兜底），但变量管理存在以下问题：

1. **变量元数据形同虚设** — `desc` 字段始终为空，API/UI 没有编辑入口
2. **变量值来源与模板声明完全解耦** — 调用点硬编码变量值来源，模板不知道值从哪来
3. **变量合法性无校验** — 教师可创建包含非法变量的模板，运行时崩溃
4. **`qa` 模板存在安全隐患** — 调用点不传任何变量值，但系统不阻止教师为 QA 模板添加变量
5. **预览数据与运行时数据不一致** — `prompt_static.py` 的示例变量是独立维护的硬编码数据
6. **变量定义分散** — 4 个调用点文件各自隐式定义变量，无统一视角

## 目标

- 每个 purpose 的所有合法变量在**单一位置**集中定义（VariableRegistry）
- 模板创建/更新时**即时校验**变量合法性
- 调用点通过 registry 提供的接口声明"我为哪些变量提供值"
- 前端能够**展示和编辑**变量的描述、来源、类型
- 预览 API 的示例数据与运行时数据**同源**

## 设计原则

- 不动数据库 schema — 复用现有 `PromptTemplate.variables` JSONB 字段
- 不动模板语法 — 保持 `{#variable_name#}` 不变
- 不变更现有的渲染结果
- 调用点的业务逻辑（如 `hidden_info_rules` 计算）保持不变，只增加声明层

---

## 一、VariableRegistry — 变量注册表

### 1.1 数据结构

```python
# backend/services/variable_registry.py

@dataclass
class VariableDef:
    name: str           # 变量名，如 "patient_info"
    type: str           # "string" | "json" | "text"
    description: str    # 中文描述，如 "患者基本信息（姓名，年龄，性别）"
    source: str         # 来源说明，如 "病例数据 > patient_info"
    required: bool      # 是否必须由调用点提供
    default_example: str # 预览时使用的示例值

class VariableRegistry:
    """集中管理所有 purpose 的合法变量定义"""
    
    _registry: dict[str, list[VariableDef]]
    
    def get_variables(self, purpose: str) -> list[VariableDef]: ...
    def get_variable_names(self, purpose: str) -> set[str]: ...
    def validate_template_vars(self, purpose: str, template_vars: set[str]) -> list[str]: ...
    def get_sample_kwargs(self, purpose: str) -> dict[str, str]: ...
```

### 1.2 注册的变量

| purpose | 变量名 | 类型 | 来源 |
|---------|--------|------|------|
| patient_chat | `communication_style` | string | case_data.communication_style |
| patient_chat | `patient_info` | string | case_data.patient_info 拼接 |
| patient_chat | `chief_complaint` | string | case_data.chief_complaint |
| patient_chat | `present_illness` | string | case_data.present_illness |
| patient_chat | `allergy_history` | string | case_data.allergy_history |
| patient_chat | `hidden_info_rules` | text | 运行时根据学生消息计算 |
| scoring | `scoring_rubric` | text | prompt_static.build_scoring_rubric() |
| scoring | `conversation_text` | text | Message 表拼接 |
| case_generation | `description` | string | 教师输入 |
| case_generation | `reference_material` | text | 教师输入 + 参考病例数据 |
| qa | （无变量） | — | QA 模板为纯静态 |

### 1.3 验证逻辑

```python
def validate_template_vars(self, purpose, template_vars):
    known = self.get_variable_names(purpose)
    unknown = template_vars - known
    missing = known - template_vars  # 仅 required=True 的才是错误
    
    errors = []
    if unknown:
        errors.append(f"未知变量: {', '.join(unknown)}")
    return errors
```

- 未知变量 → 阻止创建/更新，返回 400
- 缺少 required 变量 → 警告但不阻止（模板可能不需要所有变量）

---

## 二、PromptManager 改造

### 2.1 `render()` 增加变量校验

```python
class PromptTemplateObj:
    def render(self, **kwargs) -> str:
        # 现有逻辑：替换变量，缺失抛 RuntimeError
        # 新增：调用前记录实际传入的变量名，供调试
        ...
```

改动量最小——`render()` 本身逻辑不变，仅在渲染失败时增强错误信息（包含"期望什么变量、实际传入什么变量"）。

### 2.2 `_upsert_v1_defaults()` 同步 registry

V1 模板启动覆盖时，`variables` JSONB 不再从模板文本提取然后置空 desc，而是**从 registry 获取完整元数据**写入。

---

## 三、Admin API 改造

### 3.1 create / update 接口

```python
# admin_prompts.py:39 (create) / :67 (update)

# 校验变更：
# 1. 从模板文本提取变量名 → template_vars
# 2. registry.validate_template_vars(purpose, template_vars)
#    未知变量 → 400 错误
# 3. 保存时 variables JSONB 不从文本自动提取，改为从 registry 获取完整元数据
```

### 3.2 validate 端点增强

现有 `/validate` 只检查语法。增加：
- 报告未知变量
- 报告变量类型不匹配（future）

### 3.3 sample-vars 端点

当前 `prompt_static.get_sample_vars()` 提供硬编码示例。
改为调用 `registry.get_sample_kwargs(purpose)`。

### 3.4 active/preview 端点

不变——仍渲染模板并返回原始/渲染对比。

---

## 四、调用点改造

### 4.1 不改变量值组装逻辑

```python
# chat.py:52-59 — 原有逻辑保持不变
patient_info_str = f"{pi.get('name', '患者')}，{pi.get('age', '')}岁，{pi.get('gender', '')}"
hidden_info_rules = "\n".join(...)

system_prompt = tmpl.render(
    communication_style=str(case_data.get("communication_style", "友善自然")),
    patient_info=patient_info_str,
    chief_complaint=str(case_data.get("chief_complaint", "未知")),
    present_illness=str(case_data.get("present_illness", "未知")),
    allergy_history=str(case_data.get("allergy_history", "无")),
    hidden_info_rules=hidden_info_rules,
)
```

### 4.2 增加默认值兜底

从 registry 获取每个变量的 `default_example`，当业务数据缺失时使用。

```python
vars_def = registry.get_variables("patient_chat")
defaults = {v.name: v.default_example for v in vars_def}

system_prompt = tmpl.render(
    communication_style=case_data.get("communication_style") or defaults.get("communication_style", ""),
    ...
)
```

---

## 五、prompt_static.py 精简

- 删除 `get_sample_vars()` 函数
- 删除 `_SAMPLE_VARS` 硬编码字典
- `build_scoring_rubric()` 保留（它不完全是变量逻辑）

---

## 六、前端改造

### 6.1 变量标签增强

当前只显示彩色标签 + 变量名。改造为：

```
┌──────────────────────────────────────────────────┐
│ 模板变量（3 个）                    [展开/收起]    │
│                                                    │
│ ┌─ patient_info ─────────────────────────────────┐ │
│ │ 描述: 患者基本信息（姓名，年龄，性别）            │ │
│ │ 来源: 病例数据 > patient_info                   │ │
│ │ 示例: 张三，45岁，男                            │ │
│ │ 类型: string                                   │ │
│ └────────────────────────────────────────────────┘ │
│                                                    │
│ ┌─ hidden_info_rules ────────────────────────────┐ │
│ │ 描述: 本轮可透露的隐藏信息                       │ │
│ │ 来源: 运行时根据学生触发的关键词动态计算          │ │
│ │ 示例: - 关于咯血：最近一周痰中带血丝...          │ │
│ │ 类型: text                                     │ │
│ └────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### 6.2 变量描述可编辑

变量卡片中的"描述"字段为内联编辑——教师可自定义描述文本。修改后通过 PUT 接口保存到 `variables[].desc`。

### 6.3 预览改进

预览 Modal 中的"填充值"不再使用独立维护的示例数据，而是显示从 registry 获取的 `default_example`。

---

## 七、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/services/variable_registry.py` | **新增** | 变量注册表核心模块 |
| `backend/services/prompt_manager.py` | 修改 | V1 覆盖时从 registry 同步元数据；render 增强错误信息 |
| `backend/routers/admin_prompts.py` | 修改 | create/update 增加注册表校验；sample-vars 改用 registry |
| `backend/prompt_static.py` | 修改 | 删除 `get_sample_vars()` 和 `_SAMPLE_VARS` |
| `backend/routers/chat.py` | 修改 | 增加 registry 默认值兜底 |
| `backend/routers/qa.py` | 修改 | 无实质变更（无变量） |
| `backend/services/scoring.py` | 修改 | 增加 registry 默认值兜底 |
| `backend/routers/cases.py` | 修改 | 增加 registry 默认值兜底 |
| `backend/tests/test_variable_registry.py` | **新增** | 注册表单元测试 |
| `frontend/src/components/teacher/PromptManagementTab.jsx` | 修改 | 变量卡片 UI；描述编辑；预览数据源 |
| `docs/superpowers/specs/2026-06-01-prompt-variable-registry.md` | **新增** | 本 spec 文件 |

## 八、风险与回滚

- **Registry 与模板不同步**：如果 V1 模板更新了但没有同步更新 registry，变量集不一致。缓解：registry 是唯一事实来源，V1 模板由 registry 驱动。
- **调用点未声明新变量**：如果教师在 template 中加了新变量但不在 registry 中 → 会被校验拦截。
- **向后兼容**：现有模板的 `variables` JSONB 格式不变，只是内容更丰富（增加了 desc/source/type 字段）。旧数据中这些字段缺失 → 前端按缺失处理，不崩溃。
