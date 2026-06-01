# 管理端病例筛选功能 — 设计文档

## 概述

在管理员"病例管理"页面 (`CasesTab.jsx`) 添加筛选条，支持按困难程度和病例名称过滤。

## 筛选条件

| 条件 | 前端控件 | 后端参数 | 说明 |
|------|---------|---------|------|
| 困难程度 | `<select>` 下拉 | `difficulty: int` | 1=初级, 2=中级, 3=高级, 留空=全部 |
| 病例名称 | `<input>` 文本 | `name: str` | 后端 `ilike` 模糊搜索 |

## 接口变更

**`GET /api/cases/manage/list`** 新增可选参数：
- `name: Optional[str]` — 对 `Case.name` 做 `ILIKE` 模糊匹配
- `difficulty: Optional[int]` — 通过 JSONB 路径 `case_data->'difficulty'` 过滤

计数 (`total`) 需反映过滤后的结果。

## 前端变更 (`CasesTab.jsx`)

- 新增 `filters` state：`{ name: "", difficulty: "" }`
- 在按钮行和表格之间插入 `.filter-bar`（仿 `RecordsTab.jsx` 模式）
- 表格上方显示 "共 N 条" 计数
- `fetchCases` 传递 filters 到 API
- filter 变化时自动 reset offset 到 0

## 表单变更 (CasesTab.jsx)

编辑/创建病例表单新增 difficulty 字段（下拉选择），置于"基础信息"区域：
- `NEW_CASE_TEMPLATE` 增加 `difficulty: 1`
- `buildCaseData()` 写入 `case_data.difficulty`
- `parseCaseData()` 读取 `cd.difficulty`
- 表单 UI：`<select>` 选项 初级(1) / 中级(2) / 高级(3)

## 非目标

- 学生端 `CaseSelect.jsx` 已有独立筛选，不动
