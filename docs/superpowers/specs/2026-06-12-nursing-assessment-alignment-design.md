# 护理评估单对齐 — 入院患者评估表

**Date:** 2026-06-12
**Status:** draft

## 背景

将现有"护理问诊记录单"（8 Section / 34 字段）替换为完整的"入院患者评估表"，对齐标准护理入院评估内容。

## 范围

- **前端 config**：完全重写 `config.ts`，拆分为多文件
- **前端 types**：新增 `compound` 和 `repeater` 两种 item 类型
- **前端组件**：新增 `CompoundItem.tsx` 和 `RepeaterItem.tsx`
- **前端 Panel**：渲染器适配新类型
- **后端**：零变更 — `sheet_data` JSONB 自动兼容新结构
- **数据库**：零变更 — 无 DDL 迁移
- **旧数据**：保留。加载时旧 key 不匹配自动显示空值

## 新表单结构（8 Section）

### Section 1: `medical_history` (病史)
| key | type | label | note |
|-----|------|-------|------|
| `chief_complaint` | textarea | 主诉 | |
| `present_illness` | textarea | 现病史 | |

### Section 2: `daily_living` (日常生活状况)
| key | type | label | note |
|-----|------|-------|------|
| `diet_types` | checkbox_group | 膳食种类 | 选项: 普食/软食/流质/半流/鼻饲/治疗膳食/禁食/忌食，每项可填餐/日或忌食内容 |
| `eating_method` | checkbox_group | 进食方式 | 选项: 正常/鼻饲/全肠造瘘/全静脉营养/其他，其他可填详情 |
| `appetite` | radio | 食欲 | 正常/增加/亢进/减退/厌食 |
| `defecation` | compound | 排便 | trigger=radio(正常/便秘/腹泻/失禁/造瘘/其他)，便秘→日/次+辅助排便，腹泻→次/日，造瘘→能否自理 |
| `urination` | compound | 排尿 | trigger=radio(正常/增多/减少)，增多/减少→次/日+颜色 |
| `activity_ability` | radio | 活动能力 | 无限制/坐椅子/床旁活动/卧床 |
| `self_care` | radio | 自理能力 | 完全自理/部分自理/完全依靠 + 子标注(进食饮水/穿衣/沐浴洗漱/如厕) |
| `sleep` | compound | 睡眠 | trigger=radio(正常/失眠)，失眠→描述输入 |
| `smoking` | compound | 吸烟 | trigger=radio(无/偶吸/大量)，偶吸/大量→支/日+已抽年+已戒年 |
| `alcohol` | compound | 饮酒 | trigger=radio(无/偶饮/大量)，偶饮/大量→两/月+已饮年+已戒年 |
| `drug_dependence` | compound | 药物依赖 | trigger=radio(无/有)，有→药名/剂量 |

### Section 3: `past_history` (既往史)
| key | type | label | note |
|-----|------|-------|------|
| `health_status` | radio | 既往健康状况 | 良好/一般/差 |
| `illness_history` | compound | 既往患病/住院史 | trigger=radio(无/有)，有→描述 |
| `infectious_history` | compound | 传染病史 | trigger=radio(无/有)，有→描述 |
| `vaccination_history` | compound | 预防接种史 | trigger=radio(无/有)，有→描述 |
| `surgery_history` | compound | 手术/外伤史 | trigger=radio(无/有)，有→描述 |
| `allergy` | checkbox_group | 过敏史 | 选项: 无/食物/药物/不详/其他，食物/药物/其他可填描述 |
| `marriage_age` | input | 结婚年龄 | unit: 岁 |
| `spouse_health` | compound | 配偶健康状况 | trigger=radio(健在/患病/已故)，已故→死因 |
| `reproduction` | repeater | 生育史 | 单行5个 input: 妊娠/顺产/流产/早产/死产，unit: 次/胎 |
| `menstruation` | repeater | 月经史 | 单行5个 input: 初潮(岁)/行经期(天)/周期(天)/绝经年龄(岁)/末次月经 |
| `family_history` | repeater | 家族史 | 4行(父/母/子女/兄弟姐妹)，每行: status(radio:健在/患病/已故)+cause(input，已故时显示) |

### Section 4: `system_review` (系统回顾)
10个子系统，每子系统含一个 checkbox_group（含"正常/无异"选项 + 症状选项 + "其它"选项）+ 其它输入框：

| sub-key | label | 症状选项数 |
|---------|-------|-----------|
| `head_neck` | 头颅五官 | 6 |
| `respiratory` | 呼吸系统 | 7 |
| `circulatory` | 循环系统 | 5 |
| `digestive` | 消化系统 | 12 |
| `urinary` | 泌尿系统 | 9 |
| `hematologic` | 血液系统 | 8 |
| `endocrine` | 内分泌及代谢 | 9 |
| `musculoskeletal` | 肌肉骨骼系统 | 5 |
| `nervous` | 神经系统 | 8 |
| `mental` | 精神状态 | 7 |

### Section 5: `psychological` (心理评估)
| key | type | label | options |
|-----|------|-------|---------|
| `self_view` | radio | 对自我的看法 | 满意/不满意/其它 |
| `emotion` | radio | 情绪 | 镇静/易激动/焦虑/恐惧/悲哀/其它 |
| `disease_awareness` | radio | 对疾病的认识 | 完全/部分/不认识/未被告知 |
| `life_events` | compound | 过去1年重要生活事件 | trigger=radio(无/有)，有→描述 |
| `confidant` | radio | 遇困难向谁倾诉 | 父母/子女/其它 |
| `religion` | radio | 宗教信仰 | 无/佛教/基督教/伊斯兰教/其它 |

### Section 6: `social` (社会评估)
| key | type | label | options |
|-----|------|-------|---------|
| `family_relation` | radio | 家庭关系 | 和睦/冷淡/紧张 |
| `marital_status` | radio | 婚姻状况 | 未婚/已婚/离婚/丧偶/其它 |
| `living_situation` | radio | 居住情况 | 独居/和家人同住/和亲友同住/老人院 |
| `occupation` | radio | 职业状况 | 在岗/下岗/务农/无业/个体经营/丧失劳动能力 |
| `education` | radio | 文化程度 | 文盲/小学/初中/高中中专/大专/大学及以上 |
| `social_interaction` | radio | 社会交往 | 正常/较少/回避 |
| `payment_method` | compound | 医疗费用支付 | trigger=radio(公费/医疗保险/自费/其它)，其它→描述 |
| `hospitalization_concern` | checkbox_group | 住院顾虑 | 选项: 无/经济负担/自理能力/预后/其它，其它可填详情 |

### Section 7: `nursing_diagnosis` (初步护理诊断)
| key | type | label |
|-----|------|-------|
| `preliminary_diagnosis` | textarea | 初步护理诊断 |

### Section 8: `signature` (签名)
| key | type | label |
|-----|------|-------|
| `nurse_signature` | input | 护士签名 |
| `date` | input | 日期 |

## 技术设计

### 新增 TypeScript 类型

```typescript
type ItemType = "input" | "textarea" | "select" | "radio" | "checkbox_group" | "vital_sign" | "compound" | "repeater";

interface CompoundItem extends BaseItem {
  type: "compound";
  trigger: SelectItem | RadioItem;                // 触发控件
  branches: Record<string, RecordSheetItem[]>;    // key=trigger值, value=子字段列表
}

interface RepeaterField {
  key: string;
  type: ItemType;
  label: string;
  unit?: string;
  placeholder?: string;
  options?: string[] | CheckboxOption[];
  showWhen?: { [fieldKey: string]: string };      // 条件显示
}

interface RepeaterRow {
  key: string;
  label: string;
}

interface RepeaterItem extends BaseItem {
  type: "repeater";
  rows: RepeaterRow[];
  fields: RepeaterField[];
}

// ReadonlySheetValue 扩展为嵌套结构
interface ReadonlySheetValue {
  [sectionKey: string]: {
    [itemKey: string]: unknown;
    // compound 值: { trigger: string, ...subFields }
    // repeater 值: { [rowKey]: { [fieldKey]: unknown } }
  };
}
```

### 文件结构

```
frontend/src/plugins/nursing-record/
├── config.ts                        # 聚合导出: NURSING_RECORD_SHEET_CONFIG
├── configs/
│   ├── medical-history.ts
│   ├── daily-living.ts
│   ├── past-history.ts
│   ├── system-review.ts
│   ├── psychological.ts
│   ├── social.ts
│   ├── nursing-diagnosis.ts
│   └── signature.ts
├── types.ts                         # 类型定义（扩展）
├── items/
│   ├── InputItem.tsx                 # 不变
│   ├── TextareaItem.tsx             # 不变
│   ├── SelectItem.tsx               # 不变
│   ├── RadioItem.tsx                # 不变
│   ├── CheckboxGroupItem.tsx        # 不变（已支持 detail input）
│   ├── VitalSignItem.tsx            # 保留但不再被新config引用
│   ├── CompoundItem.tsx             # 新增
│   └── RepeaterItem.tsx             # 新增
├── NursingRecordPanel.tsx           # 微调：适配新类型
└── index.ts                         # 不变
```

### CompoundItem 组件逻辑

- 渲染 trigger 控件（radio 或 select）
- 监听 trigger 值变化，显示/隐藏对应 branches 的子字段
- 子字段渲染复用现有 item 组件（InputItem、TextareaItem 等）
- 值结构：`{ trigger: string; [subKey]: value }`

### RepeaterItem 组件逻辑

- 渲染为表格/卡片列表，每行对应一个 row
- 每行渲染 fields 数组指定的控件
- 支持 `showWhen` 条件显示（如家族史"死因"仅当 status=已故时显示）
- 值结构：`{ [rowKey]: { [fieldKey]: value } }`

### NursingRecordPanel 变更

- `renderItem()` 函数增加 `case "compound"`、`case "repeater"` 分支
- localStorage key 保持 `nursing_record_sheet_{recordId}`
- 填写进度统计需递归计算 compound/repeater 内子字段

### 后端：不变

- `NursingRecord` 模型、API、schemas 完全不变
- `sheet_data` JSONB 自动存储任意 JSON 结构
- 旧前端提交的旧结构数据与新结构共存于同一列，互不干扰

## 不包含

- 旧表单数据迁移/转换（旧数据自然保留，新填为新结构）
- 移动端/小程序适配（仅 Web 前端）
- 评分/打分集成（护理评估单仅作数据采集，评分由 rubrics 系统独立管理）
- 导出/打印功能
- `vital_sign` item 类型移除（代码保留避免破坏性变更，仅不再被 config 引用）

## 风险

- **填写中途结构变更**：旧 localStorage 数据 key 不匹配新 config → 表单显示为空 → 可接受（用户重新填写）
- **localStorage 容量**：200+ 字段全部填写后 JSON 串约 10-20KB → 远低于 5MB 限制 → 无风险
