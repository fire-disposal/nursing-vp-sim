-- ============================================================================
-- cost-health.sql — LLM 成本/失败只读快照
--
-- 固化 refactor-infra.md §2/§4 的快反配套查询：每日成本趋势、单会话 TOP 成本、
-- 失败与超时占比；发布前后各跑一次，作为"成本闸门"是否失效的最低证据。
--
-- 只读：整份脚本包在 BEGIN READ ONLY 里，任何写操作直接报错。
-- 脱敏：不查 request_text / response_text / api_key，只查计数与金额。
-- 用法：
--   pnpm run health:cost                                     # 默认近 7 天
--   psql "$DATABASE_URL" -v window_days=30 -f scripts/cost-health.sql
--
-- 口径：金额取 llm_call_logs.estimated_cost（币种见 cost_currency），
--       日界线按 Asia/Shanghai（与 tag/发布日一致）。
-- ============================================================================

BEGIN READ ONLY;

\if :{?window_days}
\else
  \set window_days 7
\endif

\echo 'cost-health — 窗口(天):' :window_days

\echo ''
\echo '── 1) 每日成本趋势（按天 + 币种）'
SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date        AS day,
       COALESCE(cost_currency, '(未标注)')                    AS currency,
       count(*)                                               AS calls,
       count(*) FILTER (WHERE status <> 'success')            AS failed,
       sum(total_tokens)                                      AS tokens,
       round(sum(estimated_cost)::numeric, 2)                 AS cost
FROM llm_call_logs
WHERE created_at >= now() - interval '1 day' * :window_days
GROUP BY 1, 2
ORDER BY day DESC, currency;

\echo ''
\echo '── 2) 单会话 TOP 成本（最多 20 条，含调用数/耗时，用于定位失控会话）'
SELECT l.record_id,
       l.user_id,
       l.case_id,
       count(*)                                       AS calls,
       count(*) FILTER (WHERE l.status <> 'success')  AS failed,
       sum(l.total_tokens)                            AS tokens,
       round(sum(l.estimated_cost)::numeric, 2)       AS cost,
       min(l.created_at)::date                        AS first_call,
       max(l.created_at)::date                        AS last_call
FROM llm_call_logs l
WHERE l.created_at >= now() - interval '1 day' * :window_days
  AND l.record_id IS NOT NULL
GROUP BY l.record_id, l.user_id, l.case_id
ORDER BY cost DESC NULLS LAST
LIMIT 20;

\echo ''
\echo '── 3) 按 purpose 分解（成本占比 + 平均延迟；purpose 定义见 backend/infra/llm/profile.py）'
SELECT purpose,
       count(*)                                                          AS calls,
       count(*) FILTER (WHERE status <> 'success')                       AS failed,
       sum(total_tokens)                                                 AS tokens,
       round(sum(estimated_cost)::numeric, 2)                            AS cost,
       round(100.0 * sum(estimated_cost)::numeric
             / NULLIF(sum(sum(estimated_cost)::numeric) OVER (), 0), 1)  AS cost_pct,
       round(avg(latency_ms))                                            AS avg_latency_ms
FROM llm_call_logs
WHERE created_at >= now() - interval '1 day' * :window_days
GROUP BY purpose
ORDER BY cost DESC NULLS LAST, purpose;

\echo ''
\echo '── 4) 失败/超时明细（error_type 分组；status <> ''success''）'
SELECT purpose,
       COALESCE(error_type, '(无 error_type)') AS error_type,
       count(*)                                AS n,
       round(avg(latency_ms))                  AS avg_latency_ms,
       max(created_at)::date                   AS last_seen
FROM llm_call_logs
WHERE created_at >= now() - interval '1 day' * :window_days
  AND status <> 'success'
GROUP BY 1, 2
ORDER BY n DESC, purpose
LIMIT 30;

\echo ''
\echo '── 5) 评分链路单位成本（scoring + scoring_feedback 成本 / 计入评分的场次）'
WITH scoring AS (
  SELECT *
  FROM llm_call_logs
  WHERE created_at >= now() - interval '1 day' * :window_days
    AND purpose IN ('scoring', 'scoring_feedback')
)
SELECT count(*)                                                     AS calls,
       count(DISTINCT record_id)                                    AS records,
       round(sum(estimated_cost)::numeric, 2)                       AS cost,
       round((sum(estimated_cost) / NULLIF(count(DISTINCT record_id), 0))::numeric, 3) AS cost_per_record,
       count(*) FILTER (WHERE status <> 'success')                  AS failed
FROM scoring;

\echo ''
\echo '── 6) 当日用量 vs 月度上限（api_secrets；pct >= 100 表示已超月度预算）'
SELECT id,
       label,
       status,
       COALESCE(degraded_reason, '-')                                                            AS degraded_reason,
       call_count_today,
       total_tokens_today,
       round(total_cost_today::numeric, 2)                                                       AS cost_today,
       round(monthly_cost_used::numeric, 2)                                                      AS cost_month,
       monthly_cost_limit,
       round(100.0 * monthly_cost_used / NULLIF(monthly_cost_limit, 0), 1)                       AS limit_pct
FROM api_secrets
ORDER BY monthly_cost_used DESC;

COMMIT;
