#!/usr/bin/env bash
# jobs 认领语义探针 —— 在**真实 Postgres** 上验证 infra/jobs.py 的 SQL。
#
# 为什么需要它：认领语义依赖 PostgreSQL 的 ``FOR UPDATE SKIP LOCKED``、``make_interval``
# 与部分唯一索引，单元测试（无库）覆盖不到；任何改动认领 SQL 的提交都应先跑这个探针。
#
# 作用域：一次性 schema ``jobs_probe``，结束即 DROP（不碰应用表、不写应用 schema）。
# 断言：部分唯一索引去重、SKIP LOCKED 无重复认领、租约过期重领/终态、失败退避、未到期不认领。
#
# 用法（本机 docker 名为 nursing-db；改为你的连接方式即可）：
#   bash scripts/jobs_claim_probe.sh            # 在 docker 宿主机上执行
#   ssh <host> 'bash -s' < scripts/jobs_claim_probe.sh
#
# 退出码 0 = 全部通过。
set -uo pipefail

# 注意：docker exec **不加 -i** —— 脚本本身从 stdin 传入，-i 会把剩余脚本吃掉。
PSQL="docker exec nursing-db psql -U nursing -d nursing_vp -X -q -t -A"
SCHEMA=jobs_probe
FAIL=0

PSQLI="docker exec -i nursing-db psql -U nursing -d nursing_vp -X -q -t -A"

run() { $PSQL "$@"; }

echo "== 准备 scratch schema（不碰应用表） =="
$PSQLI <<SQL
DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;
CREATE SCHEMA ${SCHEMA};
SET search_path TO ${SCHEMA};
CREATE TABLE jobs (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  record_id INT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  priority INT NOT NULL DEFAULT 0,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 2,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT NULL,
  lease_expires_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_jobs_claim ON jobs (kind, status, available_at, priority, id);
CREATE UNIQUE INDEX uq_jobs_active_scoring ON jobs (record_id)
  WHERE kind = 'scoring' AND status IN ('pending', 'running');
SQL

claim_sql() {
  cat <<'SQL'
UPDATE jobs
   SET status = 'running',
       lease_owner = :'owner',
       lease_expires_at = now() + make_interval(secs => 300),
       attempts = attempts + 1,
       updated_at = now()
 WHERE id = (
     SELECT id FROM jobs
      WHERE status = 'pending' AND available_at <= now()
      ORDER BY priority DESC, id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
 )
RETURNING id
SQL
}

echo
echo "== T1 部分唯一索引：同一记录不得同时有两条活动评分任务 =="
$PSQL -c "SET search_path TO ${SCHEMA}; INSERT INTO jobs(kind, record_id) VALUES ('scoring', 9001);" >/dev/null
DUP=$($PSQL -c "SET search_path TO ${SCHEMA}; INSERT INTO jobs(kind, record_id) VALUES ('scoring', 9001) ON CONFLICT DO NOTHING RETURNING id;" | wc -l)
if [ "$DUP" -eq 0 ]; then echo "  PASS 第二条被拒（ON CONFLICT DO NOTHING 返回 0 行）"; else echo "  FAIL 第二条竟然插入了"; FAIL=1; fi
$PSQL -c "SET search_path TO ${SCHEMA}; DELETE FROM jobs;" >/dev/null

echo
echo "== T2 并发认领：SKIP LOCKED 下只有一个执行者能拿到该行 =="
$PSQL -c "SET search_path TO ${SCHEMA}; INSERT INTO jobs(kind, record_id, available_at) VALUES ('scoring', 9002, now());" >/dev/null
( $PSQLI <<SQL
SET search_path TO ${SCHEMA};
BEGIN;
$(claim_sql | sed "s/:'owner'/'probe-A'/");
SELECT pg_sleep(3);
COMMIT;
SQL
) > /tmp/probe_a.out 2>&1 &
PROBE_A_PID=$!
sleep 1
B_ROWS=$($PSQL -c "SET search_path TO ${SCHEMA}; $(claim_sql | sed "s/:'owner'/'probe-B'/");" | wc -l)
wait $PROBE_A_PID
A_ROWS=$(grep -c '^[0-9]' /tmp/probe_a.out)
if [ "$A_ROWS" -eq 1 ] && [ "$B_ROWS" -eq 0 ]; then
  echo "  PASS A 认领 1 行、并发的 B 认领 0 行（无重复认领）"
else
  echo "  FAIL A=$A_ROWS B=$B_ROWS（期望 A=1 B=0）"; FAIL=1
fi

echo
echo "== T3 租约过期：未耗尽尝试 → 退回 pending；耗尽 → 终态 failed =="
$PSQL -c "SET search_path TO ${SCHEMA}; DELETE FROM jobs; INSERT INTO jobs(kind, record_id, status, lease_owner, lease_expires_at) VALUES ('scoring', 9003, 'running', 'probe-dead', now() - interval '10 minutes');" >/dev/null
RECLAIM=$($PSQL -c "SET search_path TO ${SCHEMA};
UPDATE jobs SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
       last_error = coalesce(last_error, 'lease expired (executor gone)'),
       lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
 WHERE status = 'running' AND lease_expires_at < now() RETURNING status;")
if [ "$RECLAIM" = "pending" ]; then echo "  PASS 未耗尽尝试 → pending（可被重领）"; else echo "  FAIL 得到 $RECLAIM"; FAIL=1; fi
$PSQL -c "SET search_path TO ${SCHEMA}; UPDATE jobs SET status='running', attempts=max_attempts, lease_expires_at = now() - interval '1 minute';" >/dev/null
RECLAIM2=$($PSQL -c "SET search_path TO ${SCHEMA};
UPDATE jobs SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
       lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
 WHERE status = 'running' AND lease_expires_at < now() RETURNING status;")
if [ "$RECLAIM2" = "failed" ]; then echo "  PASS 耗尽尝试 → failed（不再重领）"; else echo "  FAIL 得到 $RECLAIM2"; FAIL=1; fi

echo
echo "== T4 失败退避：未耗尽 → pending 且 available_at 在未来；耗尽 → failed =="
$PSQL -c "SET search_path TO ${SCHEMA}; DELETE FROM jobs; INSERT INTO jobs(kind, record_id, status, attempts) VALUES ('scoring', 9004, 'running', 1);" >/dev/null
BACKOFF=$($PSQL -c "SET search_path TO ${SCHEMA};
UPDATE jobs SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
       available_at = CASE WHEN attempts >= max_attempts THEN available_at ELSE now() + make_interval(secs => 60) END,
       last_error = 'probe', lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
 WHERE id = (SELECT id FROM jobs LIMIT 1)
 RETURNING status || '|' || (available_at > now())::text;")
if [ "$BACKOFF" = "pending|true" ]; then echo "  PASS 首次失败 → pending 且延后到退避时刻"; else echo "  FAIL 得到 $BACKOFF"; FAIL=1; fi
$PSQL -c "SET search_path TO ${SCHEMA}; UPDATE jobs SET status='running', attempts=max_attempts;" >/dev/null
TERMINAL=$($PSQL -c "SET search_path TO ${SCHEMA};
UPDATE jobs SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
       lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
 WHERE id = (SELECT id FROM jobs LIMIT 1) RETURNING status;")
if [ "$TERMINAL" = "failed" ]; then echo "  PASS 耗尽尝试 → failed（终态）"; else echo "  FAIL 得到 $TERMINAL"; FAIL=1; fi

echo
echo "== T5 available_at 未到 → 不认领 =="
$PSQL -c "SET search_path TO ${SCHEMA}; DELETE FROM jobs; INSERT INTO jobs(kind, record_id, status, available_at) VALUES ('scoring', 9005, 'pending', now() + interval '10 minutes');" >/dev/null
NOTYET=$($PSQL -c "SET search_path TO ${SCHEMA}; $(claim_sql | sed "s/:'owner'/'probe-C'/");" | wc -l)
if [ "$NOTYET" -eq 0 ]; then echo "  PASS 退避期内的任务未被认领"; else echo "  FAIL 竟然认领了"; FAIL=1; fi

echo
echo "== 清理 scratch schema =="
run -c "DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;"
LEFT=$($PSQL -c "SELECT count(*) FROM information_schema.schemata WHERE schema_name = '${SCHEMA}';")
if [ "$LEFT" = "0" ]; then echo "  PASS 已删除，无残留"; else echo "  FAIL 残留 schema"; FAIL=1; fi

echo
if [ "$FAIL" -eq 0 ]; then echo "PROBE RESULT: ALL PASS"; else echo "PROBE RESULT: FAILURES PRESENT"; fi
exit $FAIL
