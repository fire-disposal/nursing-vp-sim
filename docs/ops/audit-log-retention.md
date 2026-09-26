# 审计日志保留与归档（12 个月 + 按月）

> 决策与依据：`docs/review/refactor-plan-2026-09-26.md` §4（保留 12 个月 + 按月归档）；
> 表结构见 `backend/models/audit.py`。

## 不变式

- `audit_logs` 是**只追加**表：应用层只暴露 `record()` / `record_detached()`，
  DB 层由迁移 `data/f3d4e5f6a7b8` 装 `BEFORE UPDATE OR DELETE` 触发器，改/删直接报错。
- 因此"归档"的语义是**先导出、再按整月删除**，且**只删已成功导出的月份**（未导出不删）。

## 每月归档（建议月初执行，手工或定时）

```bash
# 0) 前置：确认本月无需再查（导出含表头，UTF-8 BOM，Excel 可直接打开）
MONTH=2026-08            # 要归档的月份（保留 12 个月 → 归档 13 个月前的月份）
PSQL="psql -U postgres -h 127.0.0.1 -d nursing"

# 1) 导出该月（CSV，含全部列）
$PSQL -c "\copy (SELECT * FROM audit_logs WHERE created_at >= '${MONTH}-01' AND created_at < '${MONTH}-01'::date + interval '1 month' ORDER BY id) TO '/var/backups/audit_logs_${MONTH}.csv' WITH (FORMAT csv, HEADER true)"

# 2) 归档文件落到长期存储（按项目备份策略；与数据库备份同一套）
ls -l /var/backups/audit_logs_${MONTH}.csv

# 3) 校验导出行数与表内行数一致后，才删除该月（触发器会拦住误删：需先临时禁用）
$PSQL -tAc "SELECT count(*) FROM audit_logs WHERE created_at >= '${MONTH}-01' AND created_at < '${MONTH}-01'::date + interval '1 month'"

# 4) 删除（仅当上一步两侧数字一致）：临时禁用触发器是**受控例外**，必须在同一事务内完成
$PSQL -c "BEGIN; ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_logs_append_only; DELETE FROM audit_logs WHERE created_at >= '${MONTH}-01' AND created_at < '${MONTH}-01'::date + interval '1 month'; ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_logs_append_only; COMMIT;"

# 5) 复核触发器已恢复启用
$PSQL -tAc "SELECT tgenabled FROM pg_trigger WHERE tgname='trg_audit_logs_append_only'"   # 期望：O
```

## 注意

- **不要在未导出前删除**：第 4 步的禁用触发器是"审计不可改写"这一不变式的受控例外，
  必须与导出校验同批执行、且立即恢复启用（第 5 步复核）。
- 归档文件与数据库备份同等级保管（审计价值在于长期可查）。
- 若日后量级上来，可把 `audit_logs` 改为**按月分区**（PG 原生），归档即 detach 分区；
  当前规模无需分区，先用上述"导出→删月"流程。
- 登录失败留痕（`auth.login_failed`）会随失败次数增长，归档时一并处理；账号级锁定策略见
  `docs/review/refactor-plan-2026-09-26.md` A6 待办。
