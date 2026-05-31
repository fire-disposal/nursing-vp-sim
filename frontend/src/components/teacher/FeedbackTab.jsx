import { BarChart3, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getFeedbackStats, getFeedbacks } from "../../api";
import Pagination from "../Pagination";
import { useToast } from "../Toast";
import Badge from "../ui/Badge";
import LoadingState from "../ui/LoadingState";

const TAG_OPTIONS = [
  { label: "全部", value: "" },
  { label: "功能建议", value: "feature" },
  { label: "BUG反馈", value: "bug" },
  { label: "体验评价", value: "experience" },
  { label: "内容质量", value: "content" },
  { label: "界面设计", value: "ui" },
  { label: "其他", value: "other" },
];

const TAG_BADGE_VARIANT = {
  feature: "info",
  bug: "danger",
  experience: "success",
  content: "warning",
  ui: "info",
  other: "neutral",
};

const TAG_LABEL = {
  feature: "功能建议",
  bug: "BUG反馈",
  experience: "体验评价",
  content: "内容质量",
  ui: "界面设计",
  other: "其他",
};

const EMOTION_MAP = {
  1: "😞",
  2: "😐",
  3: "🙂",
  4: "😊",
  5: "😍",
};

function FeedbackChart({ dateFrom, dateTo }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    getFeedbackStats(params)
      .then(({ data: stats }) => {
        if (!cancelled)
          setData(
            stats.map((d) => ({
              name: d.date.slice(5),
              rating_1: d.rating_1,
              rating_2: d.rating_2,
              rating_3: d.rating_3,
              rating_4: d.rating_4,
              rating_5: d.rating_5,
            })),
          );
      })
      .catch(() => setData([]))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo]);

  if (loading)
    return <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-tertiary)" }}>加载图表...</div>;
  if (data.length === 0) return null;

  const colors = { rating_1: "#ef4444", rating_2: "#f97316", rating_3: "#eab308", rating_4: "#22c55e", rating_5: "#3b82f6" };

  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ fontSize: "0.95rem", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
        <BarChart3 size={16} />
        反馈分布趋势
      </h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-tertiary)" />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--text-tertiary)" />
          <Tooltip />
          <Legend
            formatter={(value) => {
              const map = { rating_1: "😞", rating_2: "😐", rating_3: "🙂", rating_4: "😊", rating_5: "😍" };
              return map[value] || value;
            }}
          />
          <Bar dataKey="rating_1" stackId="a" fill={colors.rating_1} name="rating_1" />
          <Bar dataKey="rating_2" stackId="a" fill={colors.rating_2} name="rating_2" />
          <Bar dataKey="rating_3" stackId="a" fill={colors.rating_3} name="rating_3" />
          <Bar dataKey="rating_4" stackId="a" fill={colors.rating_4} name="rating_4" />
          <Bar dataKey="rating_5" stackId="a" fill={colors.rating_5} name="rating_5" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function FeedbackTab() {
  const [feedbacks, setFeedbacks] = useState([]);
  const [tag, setTag] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const LIMIT = 20;
  const toast = useToast();

  const loadData = useCallback(() => {
    setLoading(true);
    const params = { offset, limit: LIMIT };
    if (tag) params.tag = tag;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    getFeedbacks(params)
      .then(({ data }) => {
        setFeedbacks(data.items);
        setTotal(data.total);
      })
      .catch(() => toast.error("加载反馈数据失败"))
      .finally(() => setLoading(false));
  }, [tag, dateFrom, dateTo, offset]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setOffset(0);
  }, [tag]);

  useEffect(() => {
    setOffset(0);
  }, [dateFrom, dateTo]);

  return (
    <div className="card">
      <div className="filter-bar" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.78rem", color: "var(--text-secondary)", marginBottom: 4 }}>开始日期</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setOffset(0);
            }}
            style={{ padding: "6px 10px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)", fontSize: "0.85rem" }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.78rem", color: "var(--text-secondary)", marginBottom: 4 }}>结束日期</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setOffset(0);
            }}
            style={{ padding: "6px 10px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)", fontSize: "0.85rem" }}
          />
        </div>
        {(dateFrom || dateTo) && (
          <button
            className="btn btn-sm"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              setOffset(0);
            }}
            style={{
              padding: "6px 12px",
              background: "var(--bg-surface-subtle)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              cursor: "pointer",
              fontSize: "0.85rem",
              color: "var(--text-secondary)",
            }}
          >
            清除日期
          </button>
        )}
      </div>

      <div className="filter-bar">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {TAG_OPTIONS.map((opt) => (
            <button key={opt.value} className={`difficulty-chip${tag === opt.value ? " active" : ""}`} onClick={() => setTag(opt.value)}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 16, fontSize: "0.85rem", color: "var(--text-secondary)" }}>共 {total} 条反馈</div>

      <FeedbackChart dateFrom={dateFrom} dateTo={dateTo} />

      {loading ? (
        <LoadingState />
      ) : feedbacks.length === 0 ? (
        <div className="empty-state">
          <div className="icon">
            <MessageSquare size={42} />
          </div>
          <div>暂无反馈</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {feedbacks.map((fb) => (
            <div
              key={fb.id}
              style={{
                padding: 16,
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-lg)",
                background: "var(--bg-surface)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: "1.25rem" }}>{EMOTION_MAP[fb.rating] || ""}</span>
                  <span style={{ fontWeight: "var(--font-weight-semibold)" }}>{fb.user_name}</span>
                </div>
                <Badge variant={TAG_BADGE_VARIANT[fb.tag] || "neutral"}>{TAG_LABEL[fb.tag] || fb.tag}</Badge>
              </div>
              {fb.content && <div style={{ fontSize: "0.88rem", color: "var(--text-primary)", marginBottom: 8, lineHeight: 1.5 }}>{fb.content}</div>}
              <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>{new Date(fb.created_at).toLocaleString("zh-CN")}</div>
            </div>
          ))}
        </div>
      )}
      <Pagination total={total} offset={offset} limit={LIMIT} onChange={setOffset} />
    </div>
  );
}
