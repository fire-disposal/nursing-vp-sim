import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, Trash2 } from "lucide-react";
import { getQAHistory, deleteQARecord } from "../api";
import Layout from "../components/Layout";
import PageHeader from "../components/ui/PageHeader";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ui/ConfirmDialog";
import Pagination from "../components/Pagination";

function truncate(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

export default function QAHistory({ user, onLogout }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const LIMIT = 20;
  const toast = useToast();
  const { confirm } = useConfirm();

  const fetchRecords = () => {
    setLoading(true);
    getQAHistory({ offset, limit: LIMIT })
      .then(({ data }) => {
        setRecords(data.items);
        setTotal(data.total);
      })
      .catch(() => toast.error("加载问答记录失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchRecords(); }, [offset]);

  const handleDelete = async (r) => {
    const ok = await confirm({
      title: "删除记录",
      message: "确定删除这条问答记录吗？此操作不可撤销。",
      confirmLabel: "确定删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteQARecord(r.id);
      toast.success("已删除");
      if (expanded === r.id) setExpanded(null);
      fetchRecords();
    } catch (err) {
      toast.error(err.response?.data?.detail || "删除失败");
    }
  };

  const toggleExpand = (id) => setExpanded(expanded === id ? null : id);

  return (
    <Layout user={user} onLogout={onLogout}>
      <PageHeader
        title="问答历史"
        subtitle="查看你以往的护理知识问答记录"
        icon={MessageCircle}
        backTo="/qa"
      />

      <div className="card">
        {loading ? (
          <div className="empty-state">
            <div className="loading-spinner" />
            <div>加载中...</div>
          </div>
        ) : records.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon-soft"><MessageCircle size={42} /></div>
            <div style={{ marginBottom: 16 }}>暂无问答记录</div>
            <Link to="/qa" className="btn btn-primary">去提问</Link>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 12, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              共 {total} 条记录
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {records.map((r) => {
                const isOpen = expanded === r.id;
                return (
                  <div
                    key={r.id}
                    style={{
                      border: "1px solid var(--gray-200)",
                      borderRadius: "var(--radius-lg)",
                      padding: "16px",
                      cursor: "pointer",
                      background: isOpen ? "var(--gray-50)" : "#fff",
                    }}
                    onClick={() => toggleExpand(r.id)}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: 6, color: "var(--primary)" }}>
                          Q: {isOpen ? r.question : truncate(r.question, 60)}
                        </div>
                        <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                          A: {isOpen ? r.answer : truncate(r.answer, 80)}
                        </div>
                      </div>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={(e) => { e.stopPropagation(); handleDelete(r); }}
                        title="删除"
                        style={{ flexShrink: 0 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", marginTop: 10 }}>
                      {new Date(r.created_at).toLocaleString("zh-CN")}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 16 }}>
              <Pagination total={total} offset={offset} limit={LIMIT} onChange={setOffset} />
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
