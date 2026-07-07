# 小程序 GAP 分析

> 分析日期: 2026-06-12
> 对比基准: Web 前端 (React) vs 微信小程序 (原生)

## 整体评估

小程序学生侧核心链路 **基本跑通**：登录 → 浏览病例 → 开始训练 → 对话 → 结束评分 → 查看记录。但训练体验与 Web 端差距巨大。

---

## P0 — 阻断性缺陷

| # | 问题 | 位置 |
|---|------|------|
| 1 | **单元测试全挂** — `wx`/`getApp` 类型未声明，2 个 suite 0 tests | `tsconfig.test.json` 缺 wechat 类型声明 |
| 2 | **QA 无流式输出** — Web 用 SSE streaming，小程序用同步 POST，等全文返回 | `pages/qa/qa.ts:89` |
| 3 | **`types.gen.ts` 生成有 bug** — `endTraining(recordId)` 内部用 `${record_id}` 而非 `${recordId}`，3 个函数受影响 | `types.gen.ts:1156,1164,1168` |

---

## P1 — 训练体验缺失（Web 有，小程序无）

| Web 功能 | 小程序状态 | 影响 |
|-----------|-----------|------|
| **问诊进度** (inquiry checklist) | 无 | 学生不知道问了什么/遗漏什么 |
| **护理查体** (physical exam) | 快捷操作只是填文本，**未调 exam API** | 虚假功能，后端收不到 exam 数据 |
| **护理记录** (nursing record) | 完全缺失 | 无法记录结构化护理数据 |
| **情绪状态** (emotion) | 完全缺失 | 看不到患者信任/舒适度 |
| **主动追问** (initiative) | 完全缺失 | 患者不会主动提问 |
| **练习模板选择** (PracticeSelectModal) | 缺失，始终用默认配置 | 不能选不同练习场景 |
| **问卷自动检测** (before/after overlay) | 问卷是独立手动页，不会自动弹 | 可能漏填训前/训后问卷 |
| **重新评分** (retry scoring) | 缺失 | 评分失败后没法重试 |
| **功能开关** (feature toggles) | 缺失 | 训练中无法开关特性 |
| **阶段推进** (advance phase) | 缺失 | 无法手动推进训练阶段 |

---

## P2 — 次要差距

| 项目 | 状态 |
|------|------|
| TTS 语音播报 | 无 |
| 对话导出 | 无 |
| 学习笔记 CRUD | 无 |
| 记录详情评语展开 | 有基础展示，无展开/折叠 |
| 首页"继续训练"按钮 | 有 |
| 作业倒计时/逾期状态 | 有 |

---

## 当前已可用

- 微信一键登录 + 账号密码登录 + 注册
- 病例浏览（难度筛选）
- SSE 流式训练对话
- 结束训练 + 轮询评分
- 分数展示（总分 + 维度进度条 + 优势/弱点/建议）
- 训练历史（筛选 + 删除）
- 对话回放
- 个人信息编辑 + 改密码 + 微信绑定
- 反馈提交
- 问卷作答 + 历史查看

---

## 建议推进顺序

1. **修复 P0**：jest 类型声明、生成器 `${record_id}` bug、QA 加流式支持
2. **训练插件最小集**：至少补齐 inquiry progress + physical exam API 调用 + emotion 展示
3. **问卷自动检测** + 重新评分
4. 其余按需

---

## 技术债务

- `miniprogram/api/training.ts` 与 `types.gen.ts` 存在类型/函数重复定义
- `miniprogram/api/assignments.ts` API 路径 `/students/assignments` 未纳入 `types.gen.ts` 自动生成
- 生成器 `scripts/generate-miniapp-api.mjs` 未处理路径参数驼峰转换 (`record_id` → `recordId`)
