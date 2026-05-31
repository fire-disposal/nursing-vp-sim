import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getFeedbacks } from "../../api";
import Pagination from "../../components/Pagination";
import Badge from "../ui/Badge";
import LoadingState from "../ui/LoadingState";
import { useToast } from "../Toast";

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

export default function FeedbackTab() {
  const [feedbacks, setFeedbacks] = useState([]);
  const [tag, setTag] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const LIMIT = 20;
  const toast = useToast();

  const loadData = useCallback(() => {
    setLoading(true);
    const params = { offset, limit: LIMIT };
    if (tag) params.tag = tag;
    getFeedbacks(params)
      .then(({ data }) => {
        setFeedbacks(data.items);
        setTotal(data.total);
      })
      .catch(() => toast.error("加载反馈数据失败"))
      .finally(() => setLoading(false));
  }, [tag, offset, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setOffset(0);
  }, [tag]);

  return (
    <div className="card">
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
