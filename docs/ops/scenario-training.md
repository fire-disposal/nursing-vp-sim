# 情境训练（`scenario_training`）运维：机制、切换 runbook 与边界

> 状态：新机制（docs/23 唯一回合管线）已实现并在此文档记录运维面。本文只写**可执行**的东西。
> 旧的锚点任务机、DM 多步循环、独立角色实体、DM 写白板/状态、保底假回合均已删除。

## 1. 入口、权限与开关（开关语义不变）

- 开关：`SCENARIO_TRAINING_ENABLED=true`；**关闭时整个 `/api/scenario/**` 返回 404**（不是 403）。
- 权限：学生侧 `scenario_training`；内容 `case_manage`；数据 `stats_view`。会话只能被本人读写；
  管理侧可读全部（含每回合的解析/结算/交付来源与拒绝原因）。
- 试跑：`POST /api/scenario/sessions {"revision_id": <n>, "trial": true}`（需 `case_manage`），
  会话显式标记且默认不进统计与诊断计数。
- 依赖：一次自由表达 = 两次模型调用（`st_intent` 解析 + `st_dm` 演出）；结构化动作只调演出一次。
  供应商故障 → 结构化 `error`，**世界不推进、不提交半个回合**。

## 2. 机制要点（与运维有关的四条）

1. **回合 = 情境时间单位累计值**（`turn`）：只按包声明的 `Affordance.time_cost` 增加。
   说话/观察/测量通常是 0（不消耗时间）；耗时处置与刻意等待（如「等化验回报」）由作者声明正数。
   学生视图的每个 `affordances[].time_cost` 就是包声明的值（0 = 瞬时）：前端**只据此显示「耗时」标记，
   不显示单位数**——时间会改变反应与后果，学生必须看得出哪些动作要花时间。
   `seq` 是**已提交请求**的序号（顺序与 `expected_seq` 基线），与时间单位不是一个概念。
2. **提交边界**：一个业务回合只追加**一条**事件（`turn_committed`）；`clarification_exchange` /
   `hint_requested` 不推进时间；`session_opened` / `session_closed` 各自独立。
   幂等（`st_session_requests` 唯一约束）与并发基线（`expected_seq`）都在数据库提交边界上。
3. **模型不写世界**：演出阶段没有写权限；状态改动只来自包声明（动作效果与反应）。
4. **旧会话只读**：有归档（`st_session_archives`）或 `meta.read_only` 的会话，写操作返回
   409 `session_archived`；学生侧读它走归档投影，`read_only=true`，旧报告原样放在 `legacy_report`。

## 3. 生产切换 runbook（发版后必须按顺序执行）

> 生产库里包的修订仍是**旧形状**，而新代码会拒绝用它开新局（422 `schema_unsupported`）。
> 因此发版后必须补齐「包迁移 → 归档封存」两步。命令都在 `backend/` 下用 `uv run` 执行。

```bash
cd backend
# 0) 先确认在库：命令会打印目标库名；--expect-db 不符即拒绝运行（不许指向非目标库）
export DATABASE_URL="postgresql://<user>:<password>@<host>:5432/<db>"   # 生产连接串由部署环境提供

# 1) 发版（tag → deploy.yml）：部署流程自动执行 `alembic upgrade head`
#    预期：迁移 b3f7a1c9d2e4 应用（两张新表 + st_events.kind 词表换成语义超集；
#    历史 dm_step/dm_turn/student_action 等行不会让 ADD CONSTRAINT 失败）

# 2) 包内容：**内容存在库里，不在镜像里**——发版只换二进制，不会更新 st_pack_revisions。
#    所以「本次发布是否带上新的 packs/*.json」决定这一步做不做：
#    2a) 先只读核对库里装的是哪一版（一致=退出码 0，需重装=退出码 1）
uv run python -m scripts.install_scenario_pack --check
#    预期（一致）：每包一行「库内 rev#<id> (no=<n>) sha=<12位> | 仓库 sha=<12位> → 一致」
#    注意：`scenario_pack_migrate --dry-run` 比的是「文件 vs 转换后的文件」，**看不到库里装的是哪一版**，
#          核对必须用上面的 --check。
#    2b) 本次发布含 packs/*.json 变更（或 2a 报「需重装」）→ 重装，随后再 --check 应全为「一致」
uv run python -m scripts.scenario_pack_migrate --dry-run
#    预期：逐包打印「当前 v1/v2 → v3」、teaching_focus / time_cost / dm_writable / targets 摘要与校验结果
#          （v3 文件已是当前形状时显示「无改动」——这只说明文件不需要转换，不代表库里是这一版）
uv run python -m scripts.scenario_pack_migrate --apply
#    预期：每包一条「revision #N created」（旧修订保留，只追加）
uv run python -m scripts.install_scenario_pack --check
#    预期：五包全部「一致」（退出码 0）。这是"库里的内容 == 本次发布的 packs/*.json"的唯一凭据。

# 3) 归档旧会话并封存活动旧局（先看数量，再执行）
uv run python -m scripts.scenario_archive --dry-run
#    预期：会话总数 / 已归档 / 待归档（其中仍 active 的 N）
uv run python -m scripts.scenario_archive --apply
#    预期：归档 N 份；封存活动旧局 M 个（reason=mechanism_cutover）；随后自动 verify 打印问题数=0
uv run python -m scripts.scenario_archive --verify
#    预期：抽查问题 0 处

# 4) 冒烟（不含任何密钥；用现有管理员账号走登录）
curl -s https://<host>/api/health
curl -s "https://<host>/api/diagnose?token=$DIAGNOSE_TOKEN" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["scenario"])'
#    预期：scenario 块含 requests_24h / time_cost_24h / model_calls_24h / avg_*_per_request_24h /
#          clarifications_24h / hints_24h / read_only_sessions / generated_images_24h / rate_limited_24h
# 然后开一局：POST /api/scenario/sessions（带学生账号）→ 200；发一个回合 → 200 且 turn 按 time_cost 前进
# 并且**核对 revision_id**：视图里的 pack.revision_id 必须等于 2b 刚装的那一版
curl -s -X POST https://<host>/api/scenario/sessions -H "Authorization: Bearer $STUDENT_TOKEN" \
     -H 'Content-Type: application/json' -d '{"pack_key":"sputum-ineffective"}' |
  python3 -c 'import json,sys;v=json.load(sys.stdin)["view"];print(v["pack"]["key"], "revision_id=", v["pack"]["revision_id"])'
#    预期：revision_id == 上面 `install_scenario_pack --check` 里该包「库内 rev#<id>」
```

**怎么查生产现在装的是哪一版**（任一即可）：

| 途径 | 取法 |
|---|---|
| CLI（只读，最直接） | `uv run python -m scripts.install_scenario_pack --check` → 每包「库内 rev#<id> (no=<n>) sha=<12位>」；有需重装的包时退出码 1 |
| 管理端点 | `GET /api/scenario/admin/packs`（权限 `case_manage`）→ 每包 `revision_id` / `revision_no` / `revisions[]` |
| 学生端点 | `GET /api/scenario/packs`（权限 `scenario_training`）→ 每包 `revision_id` / `revision_no` |
| 单局视图 | `GET /api/scenario/sessions/{id}` → `view.pack.revision_id`（学生在跑的那一版） |

修订是**不可变**的：重装只会追加新修订，旧局仍指向它开局时那一版；因此「装了新版」与「旧局变成新版」是两件事。

**回退**（按优先级，不要反向执行迁移）：

1. **先关入口**：把 `SCENARIO_TRAINING_ENABLED=false` 并带 `IMAGE_VERSION=<上一个可用版本>` 重建 backend →
   整个命名空间 404，学生与教师界面不再进入；数据不动。
2. 仍要回滚版本：`bash deploy/rollback.sh --env prod --yes <版本>`（或 `rollback.yml` 手工触发）。
3. **旧二进制不能再指向新格式继续写**：新表/新事件词表已存在，旧代码读得到旧行、却不认识
   `turn_committed` 等新行；所以回退期间情境入口应保持关闭，修好新运行时再放开。
4. 迁移的 `downgrade` 只回退 `st_events.kind` 词表并删除两张新表；**若库里已有新种事件，降级会被 PG
   显式拒绝**（这是刻意的：删数据不该由迁移替人决定）。需要降级就先停入口、评估这两处数据是否还要。

## 4. 诊断字段（`/api/diagnose` 的 `scenario` 块）

| 字段 | 口径 |
|---|---|
| `opened_24h` / `active` / `completed` | 会话数；后两个是**即时**状态（见块的 `state_window`） |
| `requests_24h` / `time_cost_24h` / `model_calls_24h` | 都只取 `turn_committed`（已提交业务回合）；`time_cost_24h` 是推进的**情境时间单位总和**（不是请求数、不是分钟） |
| `avg_time_cost_per_request_24h` / `avg_model_calls_per_request_24h` | 分子分母**同群体同窗口**（都只数 `turn_committed`）；请求数为 0 时为 `null` |
| `clarifications_24h` / `hints_24h` | 澄清与求提示次数（都不推进时间，故与 `requests_24h` 分列） |
| `llm_failures_24h` | 情境两阶段（`st_intent`/`st_dm`）在 `llm_call_logs` 里窗口内非成功的调用数 |
| `read_only_sessions` | 被封存的旧局或已有归档的会话数 |
| `generated_images_24h` / `rate_limited_24h` | 生成物行数；限流命中（`audit_logs` 里 `scenario.rate_limited`） |

已删除的旧字段（**不要在新看板里出现**）：`dm_steps_24h`、`dm_avg_steps_24h`、`fallbacks_24h`
（新机制没有多步循环，也没有保底假回合）。

## 5. 已知边界

- 设备面**没测过就没有读数**：通道 `measured=false` 时一律 `status="unknown"`、`value=null`、
  `display="—"`、无趋势/更新回合（初始值只供引擎内部判定，不得当读数展示）；`measured=true` 才有值。
  已测量但包没声明 `normal`/`critical` 区间的通道，状态同样是 `unknown`（平台不替包做"正常"的断言）。
- 图片**生成**不再由回合触发（`SceneDelivery` 形状固定，没有生成字段）；已入库的生成物仍可在管理侧
  查看/删除，`assets`（作者预置图片）照常展示。
- 演出阶段不做逐字流式：SSE 只推真实阶段（`phase`）、**未提交**的 `delivery` 草稿与提交后的 `committed`；
  `delivery` 一律不得当事实渲染，`error` 之前的 `delivery` 同样不得渲染。
- 结构校验能挡住未授权引用、未声明说话人、未获准短语与空交付，但**不能证明自然语言绝不撒谎**：
  关键数值仍由引擎组件呈现，真正降风险靠缩小演出输入与真实对抗回合。
- 试跑会话默认不进统计与诊断计数。
- 旧会话（归档）不重算判读、不补生成报告；`legacy_report` 是当时的原报告。
