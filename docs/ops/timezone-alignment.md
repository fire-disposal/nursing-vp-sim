# 时区对齐（全部按 Asia/Shanghai）与历史污染修正

> 背景：2026-09-26 "测试全面转向 PG"时挖出的真实缺陷（`docs/review/refactor-plan-2026-09-26.md` §2.12）。
> 结论：**PG 侧修正是可行且正确的做法**，迁移文件 `backend/migrations/versions/ddl/f4e5f6a7b8c9_align_timestamps_to_timestamptz.py`。

## 一、根因（已定位）

1. 库里有 **25 个列**是 `timestamp without time zone`（naïve），而模型层声明不统一：
   一部分写了 `DateTime(timezone=True)`，另一部分只写 `Mapped[datetime] = mapped_column(default=_now_utc)`
   → SQLAlchemy 映射成 **naïve**。库与模型长期漂移 = 根因。
2. 写入路径一律给 **aware** 值（`_now_utc()` / `datetime.now(UTC)`）或用 `func.now()`；
   PG 把 aware 值写进 naïve 列时按**会话时区**折算，而会话时区在生产与本地都是 `Asia/Shanghai`。
3. 读回时值是 naïve，服务层 `ensure_utc()` 按 **UTC** 解释 → **整条读路径偏 8 小时**
   （例：3 天前写入 → 读成 2.7 天；isoformat 也偏 8 小时）。

**关键推论**：存量值 = **上海墙钟** ⇒ 用 `AT TIME ZONE 'Asia/Shanghai'` 换算得到的才是真正的时刻。
（这也解释了为什么"当成 UTC 读"会得到**未来**时间。）

## 二、线上定位污染（只读，先在副本/从库跑）

```sql
-- 1) 哪些列还是 naïve（预期修复后为空）
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE data_type = 'timestamp without time zone'
ORDER BY table_name, column_name;

-- 2) 典型列的"是未来时间吗"判别：把存量值分别按上海/UTC 解释，与 now() 比
--    若 as_utc 明显在未来（约 +8h）而 as_shanghai 落在过去 → 存量确为上海墙钟（本迁移的换算方向正确）
SELECT 'feedbacks.created_at' AS col,
       max(created_at)                                   AS stored_naive,
       max(created_at) AT TIME ZONE 'Asia/Shanghai'      AS as_shanghai,
       max(created_at) AT TIME ZONE 'UTC'                AS as_utc,
       now()                                             AS now_instant
FROM feedbacks;

-- 3) 逐表批量（把 17 张表都跑一遍，确认没有任何一张表的 max 值"当成上海"也在未来）
--    若某表 as_shanghai > now()，说明该表存在其它写入路径，先停下核对再动迁移。
```

**判据**：对每张表都应有 `as_shanghai <= now_instant`，且 `as_utc` 比 `as_shanghai` 晚 8 小时。

## 三、修正（迁移即修正）

```bash
# 迁移会把这 25 个列改成 timestamptz，并用 USING <col> AT TIME ZONE 'Asia/Shanghai' 逐列换算
pnpm run tag            # 走既有发布路径；deploy.yml 内执行 alembic upgrade head
```

**注意事项**：
- `ALTER TABLE … ALTER COLUMN … TYPE` 会**重写表**并持 `ACCESS EXCLUSIVE` 锁。
  大表（`messages` / `training_actions` / `llm_call_logs` / `qa_records`）建议低峰执行；
  如需限时，可在迁移前手设 `SET lock_timeout = '3s'`（本仓库未内建，见 §五待办）。
- 迁移是**可回滚的**：`downgrade` 用 `AT TIME ZONE 'Asia/Shanghai'` 逆换算回墙钟。
- 迁移**不改数据语义的"时刻"**：修正前后同一行的真实时刻一致，只是不再被误读 8 小时。

## 四、修后验证

```sql
-- 1) 不该再有 naïve 列
SELECT count(*) FROM information_schema.columns WHERE data_type = 'timestamp without time zone';

-- 2) 新写入往返：应用侧写 aware-UTC，读回应为同一瞬间（后端已有判据
--    tests/core/test_timestamp_roundtrip.py：会话时区 + 无 naïve 列 + 往返一致）
-- 3) 面板抽查：/admin/ops 的"最老一条 / 未回复天数"应与真实时间一致（不再是 2.7 天那种偏差）
```

直连 psql 抽查（只读）：

```sql
SELECT id, created_at, created_at AT TIME ZONE 'Asia/Shanghai' AS as_shanghai FROM feedbacks ORDER BY id DESC LIMIT 5;
```

## 五、剩余待办

1. **应用侧会话时区显式固定**：目前依赖 compose 的 `TZ/Asia/Shanghai`；建议在 engine 上
   `connect_args={"options": "-c timezone=Asia/Shanghai"}`，让行为不依赖宿主机时区（本次未做，避免与部署配置双写）。
2. 前端显示统一按上海：所有 `toLocaleString("zh-CN")` 改为带 `timeZone: "Asia/Shanghai"`，
   否则用户在其它时区会看到本地时间（本次已处理主要展示点，见 §六）。
3. 迁移的锁风险：大表加 `SET lock_timeout` + 分批（当前规模不必）。
4. 若日后新增列，**模型必须显式写 `DateTime(timezone=True)`**；`tests/core/test_timestamp_roundtrip.py`
   会在回归时立刻发现遗漏。
