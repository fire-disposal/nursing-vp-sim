# 患者头像与立绘展示区 设计文档

**日期**: 2026-05-30  
**分支**: `feat/patient-avatar`  
**状态**: 设计中

## 1. 概述

为患者训练界面补充患者形象展示功能：
- 对话气泡旁添加患者/护士小头像（即时通讯风格）
- 对话区左侧添加可收起的立绘展示区，含患者形象 + 病历卡预留区

## 2. 需求

### 2.1 头像素材
- 患者：8 种 PNG 头像（4 年龄段 × 2 性别）
  - 儿童 (0-14) 男/女、青年 (15-35) 男/女、中年 (36-59) 男/女、老年 (60+) 男/女
- 护士：1 种通用 PNG 头像
- 来源：用户自行提供，开发时用占位图

### 2.2 对话气泡头像
- 患者消息（左侧气泡）：左侧配患者小头像 (32px)
- 学生消息（右侧气泡）：右侧配护士头像 (32px)

### 2.3 立绘展示区
- 位置：ChatTraining 对话区左侧，可收起侧栏
- 上部：`PatientPortrait` 组件，大尺寸患者立绘
- 下部：病历卡预留区（虚线框占位，为后续表单填写扩展）

## 3. 实现方案

### 3.1 文件结构
```
frontend/src/
├── assets/avatars/
│   ├── patient_child_male.png
│   ├── patient_child_female.png
│   ├── patient_youth_male.png
│   ├── patient_youth_female.png
│   ├── patient_middle_male.png
│   ├── patient_middle_female.png
│   ├── patient_elder_male.png
│   ├── patient_elder_female.png
│   └── nurse.png
├── utils/
│   └── avatar.js          # 头像选择工具函数
├── components/
│   └── PatientPortrait.jsx # 立绘展示组件
```

### 3.2 avatar.js 工具函数
```js
// 年龄段判定
export function getAgeGroup(age) {
  if (age < 15) return 'child';
  if (age < 36) return 'youth';
  if (age < 60) return 'middle';
  return 'elder';
}

// 返回患者头像资源
export function getPatientAvatar(age, gender) {
  const group = getAgeGroup(age);
  const sex = gender === '女' ? 'female' : 'male';
  return avatars[`patient_${group}_${sex}`];
}

// 返回护士头像资源
export function getNurseAvatar() {
  return avatars.nurse;
}
```

### 3.3 PatientPortrait 组件
- Props: `patientInfo: { age, gender, name }`, `collapsed`, `onToggle`
- 收起/展开通过 props 控制，由父组件 ChatTraining 管理状态
- 默认展开状态
- 宽度约 280px，高度撑满对话区
- 收起按钮在侧栏右边缘

### 3.4 ChatTraining 改造点
- 引入 `getPatientAvatar` / `getNurseAvatar`
- 消息气泡添加 `<img>` 头像
- 添加 `PatientPortrait` 侧栏，管理 `showPortrait` 状态
- 对话区布局：flex 横向排列 Portrait + Conversation + Input

## 4. 不变更范围
- CaseSelect.jsx / DashboardHome.jsx 图标占位保持不变
- 后端数据模型和 API 不变（已有 age、gender 字段）
