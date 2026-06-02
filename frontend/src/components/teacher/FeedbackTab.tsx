import { BarChart3, ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getFeedbackStats, getFeedbacks } from "@/api/api-client";
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

function FeedbackChart() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);

  const weekLabel = weekOffset === 0 ? "本周" : weekOffset === -1 ? "上周" : `${-weekOffset}周前`;

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + weekOffset * 7);
    monday.setHours(0, 0, 0, 0);

    const pad = (n) => String(n).padStart(2, "0");
    const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    const dateKeys = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      dateKeys.push(fmtDate(d));
    }

    const params = { date_from: dateKeys[0] };
    getFeedbackStats(params)
      .then(({ data: stats }) => {
        if (cancelled) return;
        const map = {};
        stats.forEach((d) => {
          map[d.date] = d;
        });
        const filled = dateKeys.map((dk, i) => {
          const s = map[dk];
          return {
            name: days[i],
            rating_1: s?.rating_1 || 0,
            rating_2: s?.rating_2 || 0,
            rating_3: s?.rating_3 || 0,
            rating_4: s?.rating_4 || 0,
            rating_5: s?.rating_5 || 0,
          };
        });
        setData(filled);
      })
      .catch(() => setData([]))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [weekOffset]);

  if (loading)
    return <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-tertiary)" }}>加载图表...</div>;
  if (data.length === 0) return null;

  const colorMap = { rating_1: "#ef4444", rating_2: "#f97316", rating_3: "#eab308", rating_4: "#22c55e", rating_5: "#3b82f6" };
  const labelMap = { rating_1: "😞 很差", rating_2: "😐 较差", rating_3: "🙂 一般", rating_4: "😊 满意", rating_5: "😍 很满意" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h3 style={{ fontSize: "0.9rem", margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
          <BarChart3 size={14} />
          {weekLabel}反馈分布
        </h3>
        <div style={{ display: "flex", gap: 2 }}>
          <button
            onClick={() => setWeekOffset((v) => v - 1)}
            style={{
              padding: "3px 6px",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-surface)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
          >
            <ChevronLeft size={12} />
          </button>
          <button
            onClick={() => setWeekOffset((v) => v + 1)}
            disabled={weekOffset >= 0}
            style={{
              padding: "3px 6px",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-surface)",
              cursor: weekOffset >= 0 ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              opacity: weekOffset >= 0 ? 0.4 : 1,
            }}
          >
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="var(--text-tertiary)" />
          <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="var(--text-tertiary)" width={24} />
          <Tooltip formatter={(value, name) => [value, labelMap[name] || name]} />
          <Legend formatter={(value) => labelMap[value] || value} wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="rating_1" stackId="a" fill={colorMap.rating_1} name="rating_1" />
          <Bar dataKey="rating_2" stackId="a" fill={colorMap.rating_2} name="rating_2" />
          <Bar dataKey="rating_3" stackId="a" fill={colorMap.rating_3} name="rating_3" />
          <Bar dataKey="rating_4" stackId="a" fill={colorMap.rating_4} name="rating_4" />
          <Bar dataKey="rating_5" stackId="a" fill={colorMap.rating_5} name="rating_5" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const PIE_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6"];
const PIE_LABELS = ["😞 很差", "😐 较差", "🙂 一般", "😊 满意", "😍 很满意"];

function RatingPieChart({ tag, dateFrom, dateTo }) {
  const [data, setData] = useState<any[]>([]);

  useEffect(() => {
    const params = {};
    if (tag) params.tag = tag;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    getFeedbackStats(params)
      .then(({ data: stats }) => {
        const totals = { rating_1: 0, rating_2: 0, rating_3: 0, rating_4: 0, rating_5: 0 };
        stats.forEach((d) => {
          totals.rating_1 += d.rating_1 || 0;
          totals.rating_2 += d.rating_2 || 0;
          totals.rating_3 += d.rating_3 || 0;
          totals.rating_4 += d.rating_4 || 0;
          totals.rating_5 += d.rating_5 || 0;
        });
        setData(
          [
            { name: "rating_1", value: totals.rating_1, idx: 0 },
            { name: "rating_2", value: totals.rating_2, idx: 1 },
            { name: "rating_3", value: totals.rating_3, idx: 2 },
            { name: "rating_4", value: totals.rating_4, idx: 3 },
            { name: "rating_5", value: totals.rating_5, idx: 4 },
          ].filter((d) => d.value > 0),
        );
      })
      .catch(() => setData([]));
  }, [tag, dateFrom, dateTo]);

  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;

  return (
    <div style={{ flex: "1 1 300px", minWidth: 280 }}>
      <h3 style={{ fontSize: "0.9rem", margin: "0 0 8px 0", display: "flex", alignItems: "center", gap: 6 }}>
        <MessageSquare size={14} />
        评价分布
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={70}
            innerRadius={35}
            label={({ name, percent }) => `${PIE_LABELS[Number(name.slice(-1)) - 1].slice(2)} ${(percent * 100).toFixed(0)}%`}
            labelLine={false}
          >
            {data.map((d) => (
              <Cell key={d.name} fill={PIE_COLORS[d.idx]} />
            ))}
          </Pie>
          <Tooltip formatter={(value, name) => [value, PIE_LABELS[Number(name.slice(-1)) - 1]]} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function FeedbackTab() {
  const [feedbacks, setFeedbacks] = useState<any[]>([]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, dateFrom, dateTo, offset]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOffset(0);
  }, [tag]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOffset(0);
  }, [dateFrom, dateTo]);

  return (
    <div className="card">
      <div style={{ display: "flex", gap: 24, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 300px", minWidth: 0 }}>
          <FeedbackChart />
        </div>
        <RatingPieChart tag={tag} dateFrom={dateFrom} dateTo={dateTo} />
      </div>

      <div className="filter-bar" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
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
          <span style={{ color: "var(--text-tertiary)", fontSize: "0.85rem", alignSelf: "flex-end", paddingBottom: 7 }}>—</span>
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
                alignSelf: "flex-end",
              }}
            >
              清除
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {TAG_OPTIONS.map((opt) => (
            <button key={opt.value} className={`difficulty-chip${tag === opt.value ? " active" : ""}`} onClick={() => setTag(opt.value)}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 16, fontSize: "0.85rem", color: "var(--text-secondary)" }}>共 {total} 条反馈</div>

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
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {feedbacks.map((fb) => (
            <div
              key={fb.id}
              style={{
                padding: "10px 14px",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-surface)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: "1rem" }}>{EMOTION_MAP[fb.rating] || ""}</span>
                  <span style={{ fontWeight: "var(--font-weight-semibold)", fontSize: "0.85rem" }}>{fb.user_name}</span>
                </div>
                <Badge variant={TAG_BADGE_VARIANT[fb.tag] || "neutral"}>{TAG_LABEL[fb.tag] || fb.tag}</Badge>
              </div>
              {fb.content && <div style={{ fontSize: "0.82rem", color: "var(--text-primary)", marginBottom: 4, lineHeight: 1.4 }}>{fb.content}</div>}
              <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>{new Date(fb.created_at).toLocaleString("zh-CN")}</div>
            </div>
          ))}
        </div>
      )}
      <Pagination total={total} offset={offset} limit={LIMIT} onChange={setOffset} />
    </div>
  );
}
