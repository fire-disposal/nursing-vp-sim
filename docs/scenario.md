# 情境训练（scenario_training）

机制在代码里，本文不复述：`backend/modules/scenario_training/**`、`frontend/src/scenario/**`。

## 只在文档里能知道的事

1. **内容在库里，不在镜像里**。病例存 `st_pack_revisions`；**发版不会换内容**。改了 `packs/*.json`
   必须重装（见下），否则学生点进去会拿到旧形状修订被拒。
2. **情境时间是累计值**：只有声明为耗时的动作推进（`time_cost`）；说话、观察、澄清、求提示都不推进。
3. **演出者（DM）当前不得写临床状态**，只能写作者声明的可写键（社会/情绪）。这是"判读可复算、
   回放不调模型"的前提。
   **待定**：用户倾向放宽 DM 写权限（含临床），聚焦单场景先试。未决之前不改。
4. **旧机制已删除**：读工具循环、锚点任务机、独立角色实体、图片生成、旧事件种类与旧报告形状。
   历史会话由归档投影只读回看。

## 运行与观测

```bash
# 装/核对内容（--check 只读，库内 sha 与仓库不一致时应重装）
docker exec nursing-vp-sim-backend-1 python -m scripts.install_scenario_pack [--check]

# 开关（缺失即关闭 => /api/scenario/** 404）
SCENARIO_TRAINING_ENABLED=true
```

- 切换、回滚、历史归档：`ops/scenario-training.md`
- 诊断字段契约：`ops/diagnostics.md` 的 `scenario` 块

## 已知边界

- 判读未经教师判例校准，**不作课程成绩**。
- 未测量读数必须显示为未知（不得用包内初值冒充已测）。
- 生成图片已退役；演出阶段不再请求生成。
