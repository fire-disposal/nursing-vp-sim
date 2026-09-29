# 情境训练（scenario_training）

机制在代码里，本文不复述：`backend/modules/scenario_training/**`、`frontend/src/scenario/**`。

## 运行时：一个模型循环，不是一条规则表

学生的每一次动作走同一条路（`runtime/session.py`）：

```
平台确定性结算（声明动作的 effects/reveals + 时间） → 模型循环（原生 function calling）
  → 每次工具调用逐条校验后落到暂存世界并记账 → `deliver` → 一条 turn_committed 原子提交
```

- **平台承担判据与账本**：学生点的动作改什么、揭示什么、花多少时间，全由包里声明确定性地算；
  判读只读账本（`facts_observed` = 线索已揭示或动作已用过）。
- **模型承担世界**：数值怎么变、谁进来、什么被看见，由模型用工具演绎（`runtime/tools.py`）。
  工具只有一组，逐条校验：注册表（能写哪些键、什么能揭示、图要等哪条线索）之外一律拒。
- **一次调用被拒只拒那一次**（把原因交回模型，它自己改）；只有**循环跑完仍未交付**才不提交。
- 学生的自由文本不再被"解析"成声明动作：说话就是说话，世界由模型演绎。要给动作记账就用按钮
  （组件里的 `affordances` 就是那些锚点）。
- **工具名里没有点号**：`^[a-zA-Z0-9_-]+$` 是供应商硬约束，所以 `world.set` 在线上叫 `world_set`。
  账本、提示词、教师回放用同一个名字。

## 只在文档里能知道的事

1. **内容只有一份，没有修订系统**：`st_packs.content` 是当前内容，`st_packs.version` 是每次保存递增的整数。
   没有"修订号 / 形状版本 / 转换 / 旧修订不能开新局"这套东西——内容在**写入时**校验，运行时读到的必然合法。
2. **可复现性靠会话自带**：开新局时把当时的内容快照进 `st_sessions.pack_content`（+ `pack_version`）。
   回放与判读读那份快照，因此**后来改病例不影响旧局**；也因此不需要归档（`st_session_archives` 已删）。
3. **学生可见性只由 `published` 表达**（`state` 已删）：学生列表只列已上架病例，未上架不能开新局；
   下架不删数据，老会话照常可读可继续。
4. **内容在库里，不在镜像里**；仓库端是**一个病例一个文件夹**：`modules/scenario_training/cases/<key>/`
   - `case.toml`：机制与 meta（id、state_keys/state_bounds、affordances、cues、facts、rubric、devices、assets、failure）
   - `case.md`：散文四节 —— `## 处境` / `## 人物`（`### <actor_id>` 逐人一段）/ `## 真相` / `## 教师备注`
   - `img/`：图片字节（`asset.file` 指向它；导出不重编码）
   它是**播种/交换**来源，改了必须重装（`install_scenario_pack`），否则库里还是旧内容。
5. **导出/导入无损**：`pack → 文件夹 → pack` 模型逐字段相等，`文件夹 → pack → 文件夹` 文本逐字节相同
   （字段全覆盖、图片字节不动）。`version` / `published` / `published_at` 属**运行期事实**，不参与往返。
   管理端三个入口：`GET /admin/cases/standard.zip`（代码里硬编码的标准模板）、
   `POST /admin/packs/import`（zip / 文件夹多文件 / 单个 `case.toml`，宽容导入并回报提示）、
   `GET /admin/packs/{key}/export.zip`。
6. **情境时间是累计值**：只有声明为耗时的动作与模型的 `time_advance` 推进它；说话、观察、澄清、求提示都不推进。
7. **模型能改的世界键 = 包登记的 `state_keys`**，数值键另有作者声明的 `state_bounds`（越界即拒）。
   布尔/文本键只做类型校验。**记不下来的东西**（判据、权重、真相）模型看不见也改不了。
8. **读数只由设备面板展示**（"读数归设备面板"）：没挂在 `presentation.devices` 通道上的数值只存在于
   引擎内部——学生看不到，模型也只能靠 `world_state` 读到。因此老包里挂在 HUD/白板上的读数都改成了设备通道。
9. **图片**：只支持作者预置图片（`st_assets`，按 `pack_key + asset_id`）。**绘画/生成已放弃**（相关表与端点已删）。
   `assets[].reveal_with`（可选，any-of）声明"要等哪条线索被揭示才允许发"：提前发 → **只拒那一次**并记账，
   不整条回合判死。
10. **呈现面全部由平台推导**：线索板（现场看到的/已确认的/已处置）、面板开关、经历维度三件套
   （处置动作数/必采事实覆盖/情境时间）都读账本，作者不再声明 HUD/白板/面板（那些声明与它们的渲染链已删）。
11. **`view.hud` 是历史字段**：线协议保留它（前端仍在读），但平台不再产生任何槽位——读数在设备面板。

## 运行与观测

```bash
# 装/核对内容（--check 只读：比对库内 content 与仓库病例**文件夹**，不一致时退出码 1）
docker exec nursing-vp-sim-backend-1 python -m scripts.install_scenario_pack [key ...] [--check]

# 导出（DB → 文件夹，供离线编辑或备份；默认写回 modules/scenario_training/cases/）
cd backend && uv run python -m scripts.scenario_pack_export [key ...] [--out-dir DIR]

# 开关（缺失即关闭 => /api/scenario/** 404）
SCENARIO_TRAINING_ENABLED=true
```

- 生产切换与回滚：`ops/scenario-training.md`
- 诊断字段契约：`ops/diagnostics.md` 的 `scenario` 块（`models.calls` = 本回合模型往返次数；
  `turn_committed` 载荷里的 `tool_rejections` = 被工具层拒掉的调用计数）
- 教师回放：每个回合的**结算差量 + 每一次工具调用（含拒绝原因）+ 交付 + 备忘**都在
  `ScenarioAdminTurnReplay` 里（`tools` / `tool_rejections` / `notes`）。

## 已知边界

- 判读未经教师判例校准，**不作课程成绩**。
- 未测量读数必须显示为未知（不得用包内初值冒充已测）。
- 不做逐字流式：SSE 只推真实阶段（`receiving` / `resolving` / `delivering` / `committing`）与提交后的 `committed`。
- 模型往返次数是**上界估计**（每次工具调用按一轮计 + 一次交付）：客户端内部循环不暴露轮数，
  口径写死在 `dm/agent.py` 的 `AgentOutcome.model_calls`，别在别处再算一遍。
- 模型可以推进时间（`time_advance`，1–10）：耗时动作的 `time_cost` 与它叠加，都是"情境时间单位"。
