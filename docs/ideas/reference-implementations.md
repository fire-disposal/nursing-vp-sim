# 参考实现（同类系统与标准）

> 2026-09-27。用途：给「情境层」找参照，不重复造轮子。**每条只写偷什么 / 别碰什么**。
> 本文件属**参考类**：不约束代码；字段级映射随调研结果并入 §五。
> 诚实边界：产品与规范会变；标 ⚠ 的条目我未逐一核对当前版本，链接以官方站为准。

## 一、LLM 角色扮演前端（最接近"运行时 + 作者面"）

| 参考 | 偷 | 别碰 |
|---|---|---|
| **SillyTavern**（AI 酒馆）<br>docs.sillytavern.app · github.com/SillyTavern/SillyTavern | **角色卡字段**（description / personality / scenario / first_mes / example_dialogue——与我们病例 schema 几乎同形）；**World Info / Lorebook**：关键词触发的上下文注入 = 我们 `actors[].knows/unaware` 的"按需披露"；**群聊**：多角色 + 发言顺序 + talkativeness = 我们 `actors[]` 的 `medium`/顺序；Author's Note（深度注入） | 用提示词硬凑的**状态跟踪**（漂移、不可验证）。我们坚持服务端持有状态，正是因为这是社区最痛的坑 |
| **Character Card V2**（社区规范）⚠ | 卡片**字段集合与版本字段**的收敛方式 | 把"人设"塞进单段自由文本就没有结构可言 |
| **Risu AI / Chub / AI Dungeon** ⚠ | 回合管线上的**脚本钩子**与变量（社区版的 `timeline[]` + `affordances[]`） | 无判读、无证据的自由漫游 |

## 二、互动叙事 / 戏剧管理（"meta 层"的学术老家）

| 参考 | 偷 | 别碰 |
|---|---|---|
| **Façade / Prom Week** ⚠ | **节拍管理器（drama manager）**：触发器之上再一层"该给哪个节拍"的**选择策略**；多智能体**社会状态**的表示 | 重型叙事规划器 |
| **Ink**（inklestudios.com/ink）· **Yarn Spinner**（yarnspinner.dev） | 如何在 LLM 场景里嵌入**脚本化片段**（医生电话、交接班）：变量 + 命令 + 编织；"命令"就是 affordance 的词汇表 | 用它重写整条对话 |
| **Inform 7 / TADS / Twine** ⚠ | "声明式世界模型 + 解释器"这一形态本身（`Situation` 就是朝这个方向） | 解析器式交互（我们靠自然语言） |

## 三、虚拟病人标准与商业产品（本领域的既有答案）

| 参考 | 偷 | 别碰 |
|---|---|---|
| **MedBiquitous Virtual Patient 标准**（ANSI/MEDBIQ VP.10.1）⚠ medbiq.org | 虚拟病人 = **数据可用性模型 + 活动模型 + 播放器**这层官方语言；活动模型 ≈ 我们的 `affordances[]` | 它的 XML 复杂度 |
| **Laerdal vSim for Nursing / NLN vSim / Shadow Health** ⚠ | 它们都做"**多信息源 + 病情恶化 + 记录**"→ 反证"只问诊太薄"；Laerdal 的**场景脚本**就是"事件 × 时间"表 = 我们的 `timeline[]` | 写死的分支树（LLM 角色可替代大量分支） |

## 四、学习记录与发布标准

| 参考 | 偷 | 别碰 |
|---|---|---|
| **xAPI**（ADL）github.com/adlnet/xAPI-Spec | 语句形状 **actor / verb / object / result / context / timestamp** —— 我们"体验记录"导出（`experience_export.py` 的 `timeline`）已经同形，可直接对齐命名 | 全套 LRS 基建 |
| **H5P / Moodle / LTI**（1EdTech）⚠ | 活动类型（H5P content types）与**下发给班级**的标准通道 | 全套 LMS 包袱 |

## 五、字段级映射

> 待补：由 `RefSurvey` 调研把上述参考物映射到 `backend/modules/situations/schema.py` 的字段（偷 / 改名采用 / 需要扩展 / 不取），并列出它们踩过的坑与我们哪条规则正好挡住。
