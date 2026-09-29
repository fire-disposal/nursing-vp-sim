# 情境训练（`scenario_training`）运维：模型、切换 runbook 与边界

> 只写**可执行**的东西。机制与设计理由见 `docs/scenario.md`。

## 1. 入口、权限与开关

- 开关：`SCENARIO_TRAINING_ENABLED=true`；**关闭时整个 `/api/scenario/**` 返回 404**（不是 403）。
- 权限：学生侧 `scenario_training`；内容 `case_manage`；数据 `stats_view`。会话只能被本人读写。
- **学生可见性 = `published`**：学生列表只列已上架病例；未上架不能开新局（422，带可读 `problems`）。
  上架/下架：`POST /api/scenario/admin/packs/{key}/publish|unpublish`（也可在管理端列表行内操作）。
- 试跑：`POST /api/scenario/sessions {"pack_key": "...", "trial": true}`（需 `case_manage`），
  用**当前内容**开局并标记 trial，默认不进统计。
- 依赖：一次自由表达 = 两次模型调用（`st_intent` 解析 + `st_dm` 演出）；结构化动作只调演出一次。
  供应商故障 → 结构化 `error`，**世界不推进、不提交半个回合**；内部异常不可重试（`internal_error`）。

## 2. 内容模型（运维必须知道的三件事）

1. **内容在库里，不在镜像里**：`st_packs.content` 是当前内容，`version` 每次保存递增。
   发版只换二进制，**不会**更新病例内容 → 本次发布若带 `packs/*.json` 变更，必须重装（见 runbook 第 2 步）。
2. **没有修订系统**：没有修订表、没有形状版本、没有转换、没有"旧修订不能开新局"。
   会话在开局时把内容**快照**进自己的行（`st_sessions.pack_content` + `pack_version`），
   所以**改病例不影响旧局**，回放与判读读那份快照。
3. **迁移 `a4c7e2f9b1d8`** 把内容并进 `st_packs`、给会话补快照，然后**删除** `st_pack_revisions`、
   `st_session_archives` 与 `st_packs.state`。它的 `downgrade` **不恢复内容**（只重建空表与列）。

## 3. 生产切换 runbook（发版后按顺序执行）

```bash
# 0) 发版：pnpm run tag（tag 推送即触发 deploy.yml；部署流程自动跑 alembic upgrade head）
#    预期：迁移 a4c7e2f9b1d8 应用（内容并入 st_packs、会话补快照、修订/归档表删除）

# 1) 核对库里内容与仓库文件是否一致（只读；不一致时退出码 1）
ssh yecaoyun 'docker exec nursing-vp-sim-backend-1 python -m scripts.install_scenario_pack --check'
#    预期：五包逐行「库内 v<N> sha=<12> | 仓库 sha=<12> → 一致」

# 2) 本次发布带了 packs/*.json 变更（或第 1 步报不一致）→ 重装（幂等：同内容不涨版本）
ssh yecaoyun 'docker exec nursing-vp-sim-backend-1 python -m scripts.install_scenario_pack'
#    再跑一次 --check，期望五包全「一致」

# 3) 确认五个病例都已上架（学生必须看得到）
ssh yecaoyun "docker exec nursing-db sh -c 'psql -U \$POSTGRES_USER -d \$POSTGRES_DB -tAc \
  \"select key, published, version from st_packs order by key\"'"
#    预期：五行 published=t —— 若为 f，用管理端「上架」或
#    POST /api/scenario/admin/packs/{key}/publish（需 case_manage）

# 4) 冒烟：健康 + 诊断块 + 学生能否开新局
curl -s https://iomt.205716.xyz/api/health
curl -s "https://iomt.205716.xyz/api/diagnose?token=$DIAGNOSE_TOKEN" | python3 -c 'import json,sys;print(json.load(sys.stdin)["scenario"])'
#    学生侧五例逐个开一局（或管理侧 trial:true 各开一次），断言 200 且 view.pack.version 非空
```

**怎么查生产现在装的是哪一版**：`install_scenario_pack --check`（对比 content 与仓库文件）
或 `GET /api/scenario/admin/packs`（每包 `version` / `published` / `published_at`）。

**回退**（按优先级，不要反向执行迁移）：

1. **先关入口**：`SCENARIO_TRAINING_ENABLED=false` + 带 `IMAGE_VERSION=<上一个可用版本>` 重建 backend →
   整个命名空间 404，数据不动。
2. 仍要回滚版本：`bash deploy/rollback.sh --env prod --yes <版本>`（或 `rollback.yml`）。
3. **旧二进制不能再指向新格式**：`a4c7e2f9b1d8` 之后 `st_packs.content` 是唯一内容源、修订表已删，
   所以回退版本必须同时把这个迁移降级（`alembic downgrade -1`，**不恢复内容**）或保持入口关闭；
   推荐保持入口关闭并修好新运行时。

## 4. 诊断字段（`/api/diagnose` 的 `scenario` 块）

| 字段 | 口径 |
|---|---|
| `opened_24h` / `active` / `completed` | 会话数；后两个是**即时**状态（见块的 `state_window`） |
| `requests_24h` / `time_cost_24h` / `model_calls_24h` | 都只取 `turn_committed`（已提交业务回合）；`time_cost_24h` 是推进的**情境时间单位总和** |
| `avg_time_cost_per_request_24h` / `avg_model_calls_per_request_24h` | 分子分母同群体同窗口；0 请求时为 `null` |
| `clarifications_24h` / `hints_24h` | 澄清与求提示次数（都不推进时间） |
| `llm_failures_24h` | 情境 agent 运行时（`st_dm`）窗口内非成功的调用数 |
| `rate_limited_24h` | 限流命中（`audit_logs` 里 `scenario.rate_limited`） |

已删除、不要再出现在看板里的字段：`dm_steps_24h`、`dm_avg_steps_24h`、`fallbacks_24h`、
`generated_images_24h`（绘画已放弃）、`read_only_sessions`（归档已删）。

## 5. 已知边界

- 设备面**没测过就没有读数**：通道 `measured=false` 时一律 `status="unknown"`、`value=null`、`display="—"`；
  已测量但包没声明区间的通道同样是 `unknown`（平台不替包做"正常"的断言）。
- **图片只有作者预置的**（`st_assets`），没有 AI 生成；病例里只声明"有哪些图"。
- 演出阶段不做逐字流式：SSE 只推真实阶段（`phase`）与提交后的 `committed`。
- 结构校验能挡住未授权引用、未声明说话人、未获准短语与空交付，但**不能证明自然语言绝不撒谎**：
  关键数值仍由引擎组件呈现，真正降风险靠缩小演出输入与真实对抗回合。
- 判读未经教师判例校准，**不作课程成绩**。
