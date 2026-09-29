# 情境训练（scenario_training）

机制在代码里，本文不复述：`backend/modules/scenario_training/**`、`frontend/src/scenario/**`。

## 只在文档里能知道的事

1. **内容只有一份，没有修订系统**：`st_packs.content` 是当前内容，`st_packs.version` 是每次保存递增的整数。
   没有"修订号 / 形状版本 / 转换 / 旧修订不能开新局"这套东西——内容在**写入时**校验，运行时读到的必然合法。
2. **可复现性靠会话自带**：开新局时把当时的内容快照进 `st_sessions.pack_content`（+ `pack_version`）。
   回放与判读读那份快照，因此**后来改病例不影响旧局**；也因此不需要归档（`st_session_archives` 已删）。
3. **学生可见性只由 `published` 表达**（`state` 已删）：学生列表只列已上架病例，未上架不能开新局；
   下架不删数据，老会话照常可读可继续。
4. **内容在库里，不在镜像里**：发版不会换内容。仓库 `packs/*.json` 是**播种/交换**来源，
   改了它必须重装（`install_scenario_pack`），否则库里还是旧内容。
5. **情境时间是累计值**：只有声明为耗时的动作推进（`Affordance.time_cost`）；说话、观察、澄清、求提示都不推进。
6. **演出者（DM）当前不得写临床状态**，只能写作者声明的可写键（社会/情绪）。
   **待定**：用户倾向放宽 DM 写权限（含临床），聚焦单场景先试；未决之前不改。
7. **图片**：只支持作者预置图片（`st_assets`，按 `pack_key + asset_id`）。**绘画/生成已放弃**（相关表与端点已删）。

## 运行与观测

```bash
# 装/核对内容（--check 只读：比对库内 content 与仓库文件，不一致时退出码 1）
docker exec nursing-vp-sim-backend-1 python -m scripts.install_scenario_pack [--check]

# 开关（缺失即关闭 => /api/scenario/** 404）
SCENARIO_TRAINING_ENABLED=true
```

- 生产切换与回滚：`ops/scenario-training.md`
- 诊断字段契约：`ops/diagnostics.md` 的 `scenario` 块

## 已知边界

- 判读未经教师判例校准，**不作课程成绩**。
- 未测量读数必须显示为未知（不得用包内初值冒充已测）。
- 演出阶段不做逐字流式：SSE 只推真实阶段（`phase`）与提交后的 `committed`。

## 下一步：agent 运行时（**未实施**，已定方向）

现在仍是"两阶段调用 + 声明式规则"（解析自由表达 → 演出）。下一代的裁定（未落地）：

- **把内容当材料、把能力当工具**：病例退化为"轻结构化文档 + 图片"，模型通过工具演绎世界：
  世界类（改数值/揭示线索/推进时间/人物进出）、人物类（说话）、读取类（看状态/谁知道什么/最近事件）、
  **呈现类**（要求界面演出来：监护仪读数、图片、提问、白板、时间线）。
- **唯一保留的线协议是 `ScenarioView`**：工具只产生进入现有视图的条目，**前端继承**（学生交互、设备面板、
  资料栏、复盘、冲突与断流处理全部不改）。
- **随之上线的删除**：`reactions` 的大部分、`ClauseKind` 多数条件、`presentation.hud/board/panels` 声明、
  `teaching_focus`、`dims`、两阶段调用（合成一个 agent loop）。
- **保留的确定性**（判读与回放的成立条件）：数值状态 + 谁改的（事件账本）、时间推进、信息隔离、
  `rubric` 判据。每次工具调用落一条事件。
- **图片闸门（已定）**：`assets[].reveal_with`（可选，any-of）——声明了它就必须等对应线索被揭示才允许发送；
  模型提前要发 → 拒绝这一次调用并记账，**不整条回合判死**。
- 模型能力已核对：`deepseek-v4-flash-vision-exp` 现路由到 **V4.1-Flash**（552B MoE、原生视觉、
  1M 上下文、工具调用支持 `strict` 模式、KV cache 成本降为 1/4–1/8），足以支撑多步工具循环。
