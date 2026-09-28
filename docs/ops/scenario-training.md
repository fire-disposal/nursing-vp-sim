# 情境训练：上线、观察与接收测试

> 面向运维与接收测试的组织者。功能规格见 [`docs/20`](../20-situational-training-design.md)。
> 结论先行：**只增不改**（新表 `st_*`、新路由 `/api/scenario/**`、两个新界面路由），带**秒级 kill switch**；
> 与老系统资源隔离、不写老表、不影响 `usability-u0` 批次。单实例部署，SSE 依赖 nginx 不缓冲（已确认现网 `proxy_buffering off`）。

## 一、谁能进

| 角色 | 入口 | 权限键 | 说明 |
|---|---|---|---|
| 学生 | 侧栏/底部 Tab「情境」，或直接 `/scenario` | `scenario_training` | 由 `core/roles.py` 授予；`seed.py` 每次启动按它全量重同步，**加/撤权限改 `roles.py` 即可，无需数据迁移** |
| 教师 / 管理员 | 管理侧栏「情境管理」（入口条目门 `case_manage`），或直接 `/scenario-admin` | 内容 `case_manage` · 数据 `stats_view` | 导航条目只对内容管理者显示；**路由级不判权限**（两个键都可能有其一），页面内按块判并渲染 403 |

存量库补权：`seed` 只在**空库**写权限，因此 `core/roles.py` 的改动对已部署环境靠 data 迁移
`c8d9e0f1a2b3_grant_scenario_training_permission`（部署流程会执行 `alembic upgrade head`）。

## 二、首次上线：安装病例包（只做一次）

事件表是空的就没内容可练。包 JSON 与资源已随镜像入库（`modules/scenario_training/packs/*.json`、`assets/<pack_key>/*`），
首次上线后**在 backend 容器里执行一次**（幂等：同一内容复用同一修订；重复执行安全）：

```bash
ssh yecaoyun 'docker exec nursing-vp-sim-backend-1 python -m scripts.install_scenario_pack'
# 也可只装一个：... python -m scripts.install_scenario_pack sputum-ineffective
```

也可以在「情境管理 → 情境包」里用 UI 上传同样的 JSON（两条路径等价，都会追加修订）。
**建议顺序：安装包 → 核对病例内容 → 再打开开关**，避免学生先看到空列表。

## 三、开关（kill switch）

```bash
# 生产 .env（服务器：/opt/nursing-vp-sim/.env）
SCENARIO_TRAINING_ENABLED=true          # 缺省/缺失 = 关闭
```

- 关闭时：整个 `/api/scenario/**` **404**，学生页显示「情境训练当前未开启」——不是白屏、不泄漏功能存在。
- 生效方式：改 `.env` 后**必须带版本号**重建 backend（秒级，不需要发版）：

```bash
ssh yecaoyun 'cd /opt/nursing-vp-sim && IMAGE_VERSION=<当前版本> docker compose -f docker-compose.yml --env-file .env up -d backend'
# 当前版本看这里：curl -s https://iomt.205716.xyz/api/health
```

  ⚠️ **不要**直接 `docker compose up -d backend`：`IMAGE_VERSION` 只由流水线显式传入（`deploy.yml` 里就是
  `IMAGE_VERSION=$VER docker compose -f docker-compose.yml --env-file .env …`），漏掉它会得到
  `invalid reference format`（镜像 tag 为空）。这是**手工操作的常见坑**，不是流水线问题。
- 开关关闭时学生入口照旧可见（导航不感知开关），点进去给「情境训练当前未开启…请联系管理员」。
- 生成图**不落盘**（`st_generated_assets` 存字节，`SCENARIO_IMAGE_CACHE_DIR` 已删），故无卷依赖。

## 四、观察

- **`/api/diagnose`（token 鉴权，字段契约见 [diagnostics.md](diagnostics.md)）**：`scenario` 分区给出
  `opened_24h`（近 24h 开局）、`turns_24h`、`llm_failures_24h`、`fallbacks_24h`（无 LLM 保底回合，设计内兜底）、
  `generated_images_24h`、`rate_limited_24h`（限流命中，取数自审计 `scenario.rate_limited`），
  以及即时的 `active` / `completed`（口径标在 `state_window: now`）。同一份数据在管理端「运维仪表盘」的
  `情境训练 (scenario)` 卡片上可视。
- **管理端**：`情境管理` 的统计/会话回放/生成物（按病例分页）——回放能看到每个回合的动作、DM 输出与平台问题清单。
- **反馈**：学生端反馈走既有反馈面板；反馈 Bot（`/api/feedback/bot`）可按 tag 与版本拉取。

## 五、回滚

1. **首选（秒级）**：把 `SCENARIO_TRAINING_ENABLED` 置 `false` 并重建 backend —— 学生立刻看不到入口可用内容，数据保留。
2. **回退版本**：`rollback.yml`（workflow_dispatch）或 `bash deploy/rollback.sh --env prod --yes <版本>`。
3. 三枚迁移**只增表**，回退版本不要求删表；如需彻底清理，`st_*` 六张表可整体删除（**不会**影响老系统任何表）。

## 六、数据与容量

- 新增六张表：`st_packs` / `st_pack_revisions` / `st_assets` / `st_sessions` / `st_events` / `st_generated_assets`。
- **事件流与生成图会持续增长**（每回合一条动作 + 一条 DM 回合；DM 要图时入库一张 WebP，长边 ≤1600、已剥元数据）。
- 接收测试期先观察增长；需要保留策略时按项目单独加（不预置清理作业，避免误删取证数据）。

## 七、接收测试清单

学生侧（每个试金情境走一遍）：
1. 从侧栏「情境」进入 → 应看到病例列表（看不到入口 = 权限未授予；页面提示未开启 = 开关未开）。
2. 开局后先看到**旁白与在场者**，而不是空房间；设备面应在需要时才出现。
3. 做一次动作后：说出的台词、被揭示的线索、白板的条目应随之增长；**没做的检查不该出现在屏幕上**。
4. 结束本局（窄屏在页头右端的 `⋯` 里选「结束」，桌面是页头右端那个按钮）：得分率、逐项证据、事件时间线齐全；学生界面**不出现权重**、不出现后台诊断串。
5. 反馈渠道：把体验问题（含截图）发到反馈面板，注明「情境训练」。

教师/管理员侧：
1. `情境管理 → 情境包`：确认五个病例内容与 `state`；**正式接收测试前应由内容负责人把审阅过的病例置 `reviewed`**。
2. `资源`：为声明了图片的病例上传图片（上传即归一为 WebP，剥元数据）。
3. `生成物`：选病例 → 分页浏览 DM 生成图、按会话过滤、删除（二次确认）。
4. `会话`：翻页查看学生会话、进回放核对回合与判读；`统计` 看分数分布与覆盖度。

## 八、已知边界（接收测试期间不要误判为缺陷）

- 每个病例的判读规则（rubric）由内容侧自写，**未经教师判例校准**，因此：得分率可用于反馈与迭代，**不作为课程成绩**，也不启用任何能力等第。
- 五个病例的 `state` 目前仍是 `experimental`（内容是审阅状态，与开关无关）——正式接收测试前应由内容负责人审阅后置 `reviewed`。
- 学生侧限流（`SCENARIO_ACTION_LIMIT_PER_5MIN`=30 次/5 分钟、`SCENARIO_OPEN_LIMIT_PER_DAY`=20 次/24 小时）
  打到上限时给「操作过于频繁…」/「今天开启的情境次数已达上限…」；这是**正常防御**，不是故障。
- DM 是单次结构化输出：极端情况下会出现保底生成（界面给中性说明，不暴露内部问题串）。
- 生成物删除后旧引用即 404（回放里给「该图已被清理」兜底）。
