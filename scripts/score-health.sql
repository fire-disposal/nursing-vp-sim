-- ============================================================================
-- score-health.sql — 评分健康只读快照
--
-- 固化 docs/16 §六/八的评分健康要求：评分故障率、零分兜底标记、
-- raw_total == Σ条目分。
--
-- 只读：整份脚本包在 BEGIN READ ONLY 里，任何写操作直接报错。
-- 用法：
--   pnpm run health:score                                    # 默认近 7 天
--   psql "$DATABASE_URL" -v window_days=30 -f scripts/score-health.sql
--
-- 口径：
--   * 故障 = scoring_status='failed'（含"评分超时"）或 total_score=0（LLM 0 分兜底）
--   * 成绩分 = COALESCE(reviewed_total, total_score)（教师复核优先，见 models/training.py）
--   * raw_total 为 NULL = Phase 1 之前的旧口径历史分，不可逆，不参与算术审计
-- ============================================================================

BEGIN READ ONLY;

\if :{?window_days}
\else
  \set window_days 7
\endif

\echo 'score-health — 窗口(天):' :window_days

\echo ''
\echo '── 1) 评分故障率（failed + 0 分兜底）/ completed                        [目标 < 3%]'
WITH scope AS (
  SELECT r.id, r.scoring_status, s.total_score
  FROM training_records r
  LEFT JOIN scores s ON s.record_id = r.id
  WHERE r.status = 'completed'
    AND NOT r.is_test
    AND r.start_time >= now() - interval '1 day' * :window_days
)
SELECT count(*)                                                          AS completed,
       count(*) FILTER (WHERE scoring_status = 'failed')                  AS failed,
       count(*) FILTER (WHERE total_score = 0)                            AS zero_score,
       count(*) FILTER (WHERE scoring_status = 'failed' OR total_score = 0) AS broken,
       round(
         100.0 * count(*) FILTER (WHERE scoring_status = 'failed' OR total_score = 0)
         / NULLIF(count(*), 0), 2)                                        AS failure_pct,
       count(*) FILTER (WHERE scoring_status IN ('pending', 'processing')) AS not_settled
FROM scope;

\echo ''
\echo '── 2) 0 分兜底的 fallback 标记覆盖率                                    [目标 100%]'
SELECT count(*)                                                       AS zero_score,
       count(*) FILTER (WHERE s.fallback IS NOT NULL)                  AS marked,
       round(100.0 * count(*) FILTER (WHERE s.fallback IS NOT NULL)
             / NULLIF(count(*), 0), 2)                                 AS marked_pct,
       count(*) FILTER (WHERE s.raw_total IS NULL)                     AS legacy_no_raw
FROM scores s
JOIN training_records r ON r.id = s.record_id
WHERE s.total_score = 0
  AND r.status = 'completed'
  AND NOT r.is_test
  AND r.start_time >= now() - interval '1 day' * :window_days;

\echo ''
\echo '── 3) fallback 类型分布（非 NULL 即"降级产生"，必须 UI 可见且不进排行榜）'
SELECT COALESCE(s.fallback ->> 'kind', '(kind 缺失)') AS kind,
       count(*)                                       AS n,
       min(s.created_at)::date                        AS first_seen,
       max(s.created_at)::date                        AS last_seen
FROM scores s
JOIN training_records r ON r.id = s.record_id
WHERE s.fallback IS NOT NULL
  AND NOT r.is_test
  AND r.start_time >= now() - interval '1 day' * :window_days
GROUP BY 1
ORDER BY n DESC, kind;

\echo ''
\echo '── 4) 按病例/难度分布（难度-得分应单调：difficulty 越大 avg 越高）'
SELECT c.difficulty,
       c.id                                                            AS case_id,
       c.name,
       count(s.id)                                                     AS scored,
       round(avg(COALESCE(s.reviewed_total, s.total_score))::numeric, 1) AS avg_display,
       max(COALESCE(s.reviewed_total, s.total_score))                  AS max_display,
       round(avg(s.raw_total)::numeric, 1)                             AS avg_raw,
       count(*) FILTER (WHERE s.fallback IS NOT NULL)                  AS with_fallback
FROM training_records r
JOIN cases c ON c.id = r.case_id
LEFT JOIN scores s ON s.record_id = r.id
WHERE r.status = 'completed'
  AND NOT r.is_test
  AND r.start_time >= now() - interval '1 day' * :window_days
GROUP BY c.difficulty, c.id, c.name
ORDER BY c.difficulty, c.id;

\echo ''
\echo '── 5) 失败原因（scoring_status=''failed'' 的 scoring_error 原样分组）'
SELECT COALESCE(left(scoring_error, 60), '(空)') AS reason,
       count(*)                                  AS n,
       max(start_time)::date                     AS last_seen
FROM training_records
WHERE status = 'completed'
  AND scoring_status = 'failed'
  AND NOT is_test
  AND start_time >= now() - interval '1 day' * :window_days
GROUP BY 1
ORDER BY n DESC, reason
LIMIT 20;

\echo ''
\echo '── 6) 算术审计：raw_total 是否等于 Σ条目分，展示分是否等于线性映射      [目标 100%]'
WITH item_sum AS (
  SELECT s.id,
         s.record_id,
         s.raw_total,
         s.total_score,
         s.mapping_version,
         (r.rubric_snapshot ->> 'raw_max')::numeric AS raw_max,
         (SELECT COALESCE(sum((it ->> 'score')::numeric), 0)
          FROM jsonb_each(s.detail_scores) AS dim(k, v)
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(dim.v -> 'items', '[]'::jsonb)) AS it
         ) AS sum_items,
         (SELECT count(*)
          FROM jsonb_each(s.detail_scores) AS dim(k, v)
          WHERE dim.v -> 'items' IS NULL
         ) AS dims_without_items
  FROM scores s
  JOIN training_records r ON r.id = s.record_id
  WHERE r.status = 'completed'
    AND NOT r.is_test
    AND r.start_time >= now() - interval '1 day' * :window_days
)
SELECT count(*)                                                                    AS scored,
       count(*) FILTER (WHERE raw_total IS NULL)                                   AS legacy_no_raw,
       count(*) FILTER (WHERE raw_total IS NOT NULL
                          AND abs(raw_total - sum_items) > 0.05)                   AS raw_mismatch,
       count(*) FILTER (WHERE dims_without_items > 0)                              AS dim_without_items,
       count(*) FILTER (WHERE mapping_version = 1
                          AND raw_max > 0 AND raw_total > 0
                          AND abs(total_score
                                  - round(raw_total * 100 / raw_max)) > 1)         AS display_mismatch
FROM item_sum;

\echo ''
\echo '── 6b) 算术不一致明细（最多 20 条；raw 与 Σ条目分不一致，或展示分偏离映射）'
WITH item_sum AS (
  SELECT s.id,
         s.record_id,
         s.raw_total,
         s.total_score,
         s.mapping_version,
         (r.rubric_snapshot ->> 'raw_max')::numeric AS raw_max,
         (SELECT COALESCE(sum((it ->> 'score')::numeric), 0)
          FROM jsonb_each(s.detail_scores) AS dim(k, v)
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(dim.v -> 'items', '[]'::jsonb)) AS it
         ) AS sum_items
  FROM scores s
  JOIN training_records r ON r.id = s.record_id
  WHERE r.status = 'completed'
    AND NOT r.is_test
    AND r.start_time >= now() - interval '1 day' * :window_days
)
SELECT id AS score_id,
       record_id,
       raw_total,
       sum_items,
       round((raw_total - sum_items)::numeric, 1)                               AS raw_delta,
       total_score,
       mapping_version,
       raw_max,
       CASE
         WHEN raw_total IS NULL THEN '旧口径无 raw_total'
         WHEN abs(raw_total - sum_items) > 0.05 THEN 'raw != Σ条目分'
         WHEN mapping_version = 1 AND raw_max > 0 AND raw_total > 0
              AND abs(total_score - round(raw_total * 100 / raw_max)) > 1 THEN '展示分偏离线性映射'
       END AS problem
FROM item_sum
WHERE raw_total IS NULL
   OR abs(raw_total - sum_items) > 0.05
   OR (mapping_version = 1 AND raw_max > 0 AND raw_total > 0
       AND abs(total_score - round(raw_total * 100 / raw_max)) > 1)
ORDER BY raw_total - sum_items DESC NULLS LAST, id
LIMIT 20;

\echo ''
\echo '── 7) 教师复核使用率（基线 = 0 行；复核写回后成绩口径 = reviewed_total）'
SELECT (SELECT count(*) FROM score_reviews)                                      AS reviews,
       count(*) FILTER (WHERE s.reviewed_total IS NOT NULL)                      AS scores_reviewed,
       count(*)                                                                  AS scores_in_window,
       round(100.0 * count(*) FILTER (WHERE s.reviewed_total IS NOT NULL)
             / NULLIF(count(*), 0), 2)                                           AS reviewed_pct
FROM scores s
JOIN training_records r ON r.id = s.record_id
WHERE r.status = 'completed'
  AND NOT r.is_test
  AND r.start_time >= now() - interval '1 day' * :window_days;

COMMIT;
