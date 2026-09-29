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
