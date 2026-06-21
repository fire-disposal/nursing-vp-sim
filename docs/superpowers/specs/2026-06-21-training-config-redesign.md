# 训练配置重设计：从 Feature Flags 到 Session Choices

**日期**: 2026-06-21
**分支**: `redesign/training-config`
**状态**: 设计中

## 背景

系统定位为**虚拟标准化病人（VSP）**。学生与 VSP 互动的方式不应该是"功能开关列表"，而应该是自然语言的选择。当前 6 个 feature flag 的平铺式呈现，是后台配置思维泄漏到了前端。

同时，插件架构已消亡，功能已内聚。"练习模板（Practice）" 预设体系是插件时代的遗留——学生已经在绕过它（"直接开始"按钮）。

## 目标

将学生自主练习的起点从 **"选病例→选模板→开始"** 简化为 **"选病例→选配置→开始"**，配置以学生可理解的选择式界面呈现。

## 产品模型：三种选择

```
你要练什么？
  [ ] 护理查体         —— 除了问诊，还要做体格检查

患者要有多真实？
  ( ) 基础             —— 纯问诊，患者被动应答
  (●) 进阶             —— 患者有情绪变化、会主动追问

训练结束后：
  [ ] 填写评估问卷

时长： [15 min] ═══○════ 60 min
```

### 映射关系

| 学生看到 | 后端实际 |
|----------|----------|
| 护理查体 ✅ | `physical_exam=true` |
| 进阶模式 | `emotion=true` + `patient_initiative=true` + 若查体也勾选则 `exam_emotion_bridge=true` |
| 基础模式 | 全部 false（默认） |
| 评估问卷 ✅ | `questionnaire=true` |

`allow_pause` 暴露在训练页面计时器区域，不作为预设选项。

## 改动范围

### 删除

| 文件 | 说明 |
|------|------|
| `frontend/src/components/training/PracticeSelectModal.tsx` | 学生不再选模板 |
| `backend/data/session_configs/` | 4 个 JSON 降级预设 |
| `backend/contexts/training/config_loader.py` | 仅被 session_configs 使用 |

### 新建

| 文件 | 说明 |
|------|------|
| `frontend/src/components/training/TrainingConfigModal.tsx` | 3 选 + 时间滑块配置面板 |
| `backend/migrations/versions/XXXX_drop_practice_mode_assessment.py` | DROP COLUMN mode, assessment |

### 修改

| 文件 | 改动 |
|------|------|
| `backend/core/feature_flags.py` | 重命名为 `capabilities.py`，新增 `effective_features()` 纯函数，`ALL_CAPABILITY_KEYS` 导出 |
| `backend/models.py` | `Practice` 删除 `mode`、`assessment` 字段 |
| `backend/schemas/practice.py` | 对应删除 mode、assessment |
| `backend/schemas/training.py` | `TrainingStartRequest` 新增 `features: dict?` + `time_limit_minutes: int?` |
| `backend/contexts/training/router/session.py` | 替换 `_resolve_features()` 为 `effective_features()`；统一 config 构建为工厂函数；`start_training` 处理直接配置分支 |
| `backend/contexts/training/router/scoring.py` | `resolve_features` 导入路径改为 `capabilities` |
| `backend/contexts/training/router/progress.py` | 同上 |
| `backend/contexts/training/router/chat.py` | 同上 |
| `backend/contexts/training/router/physical_exam.py` | 同上 |
| `backend/routers/admin/practices.py` | 去除 mode 读写 |
| `frontend/src/api/cases.ts` | `startTraining` 签名扩展 |
| `frontend/src/pages/CaseSelect.tsx` | 替换 PracticeSelectModal → TrainingConfigModal |
| `frontend/src/components/training/TrainingHeader.tsx` | 训练中开关限制为仅 `allow_pause` |
| `frontend/src/components/training/PracticeSelectModal.tsx` 引用处 | 移除引用（仅 CaseSelect.tsx） |
| `frontend/src/pages/admin/PracticesPage.tsx` | 移除 mode 下拉框，精简功能列表 |

### 不改动

- `Practice` 管理后台 CRUD — 教师创建作业仍需要（`behavior`、`features` 保留）
- `POST /training/start-from-assignment` — 作业流程不变
- Feature flag 在后端的存储方式不变（仍为 `practice_snapshot.features` dict）

## 后端清理维度

### 1. `_resolve_features` → `effective_features()`

纯函数，输入学生选择 + case 强制插件 → 输出完整 feature dict。无副作用。

### 2. `Practice.mode` + `Practice.assessment` 删除

两者整个代码库无运行时引用。需 DDL migration。

### 3. config 构建统一

`start_training` 中三处分叉收敛为一个 `_build_config()`。

### 4. `feature_flags.py` → `capabilities.py`

重命名，`FEATURE_FLAGS` → `ALL_CAPABILITIES`，语义更准确。

## 扩展性

新增一个学生可感知的能力只需：
1. `capabilities.py` 注册 `Capability`
2. `TrainingConfigModal` 对应分类下加选项卡片（或新建分类）
3. 映射逻辑在 `effective_features()` 中加一行

分类固定：练什么 / 真实度 / 训练后。不新增分类则不改结构。

## 边界情况

| 场景 | 处理 |
|------|------|
| 学生不选任何功能 | 合法——基础纯问诊模式 |
| 进阶+查体：自动启用 exam_emotion_bridge | 前端提示"查体操作会影响患者信任度" |
| 已有 Practice 但学生自定义 | 后端 `features` 参数优先级高于 `practice_id` 查找 |
| Migration 已有 Practice 数据 | mode/assessment 列直接 DROP，数据丢失无影响（从未被读取） |
| 时间限制不在 5-60 范围 | 前端 slider 限制，后端 clamp |
