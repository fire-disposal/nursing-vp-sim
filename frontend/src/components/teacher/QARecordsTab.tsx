import { useQuery } from "@tanstack/react-query";
import { Eye, MessageCircle } from "lucide-react";
import { useState } from "react";
import { getQAHistoryAll, getQASessionMessagesAdmin } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import Modal from "@/components/ui/Modal";
import Pagination from "@/components/ui/Pagination";

type Schemas = components["schemas"];
type QASessionAdminItem = Schemas["QASessionAdminItem"];
type QAMessageItem = Schemas["QAMessageItem"];

function truncate(text: string, maxLen: number): string {
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

export default function QARecordsTab() {
  const [offset, setOffset] = useState(0);
  const [previewSessionId, setPreviewSessionId] = useState<number | null>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const LIMIT = 20;

  const { error } = useToast();

  const { data: recordsData, isLoading } = useQuery({
    queryKey: ["qaHistory", offset],
    queryFn: () => getQAHistoryAll({ offset, limit: LIMIT }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  const { data: previewMessages, isLoading: loadingPreview } = useQuery({
    queryKey: ["qaSessionMessages", previewSessionId],
    queryFn: () => getQASessionMessagesAdmin(previewSessionId!).then((r) => r.data ?? []),
    enabled: previewSessionId !== null,
  });

  const messages = previewMessages ?? [];

  const records = recordsData?.items ?? [];
  const total = recordsData?.total ?? 0;

  const handlePreview = (sessionId: number, title: string) => {
    setPreviewTitle(title);
    setPreviewSessionId(sessionId);
    setShowPreview(true);
  };

  if (isLoading && offset === 0) {
    return (
      <div className="empty-state" style={{ padding: "48px 0" }}>
        <MessageCircle size={48} />
        <p style={{ marginTop: 12, color: "var(--gray-500)" }}>加载中...</p>
      </div>
    );
  }

  if (records.length === 0 && offset === 0) {
    return (
      <div className="empty-state" style={{ padding: "48px 0" }}>
        <MessageCircle size={48} />
        <p style={{ marginTop: 12, color: "var(--gray-500)" }}>暂无问答记录</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ marginBottom: 12, color: "var(--gray-500)", fontSize: "0.88rem" }}>共 {total} 条问答会话</div>
      <table className="data-table">
        <thead>
          <tr>
            <th>学生</th>
            <th>学号</th>
            <th>会话标题</th>
            <th>消息数</th>
            <th>最后活跃</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id}>
              <td style={{ fontWeight: 600 }}>{r.student_name || r.student_code}</td>
              <td>{r.student_code || "-"}</td>
              <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{truncate(r.title, 40)}</td>
              <td>{r.message_count}</td>
              <td style={{ whiteSpace: "nowrap", fontSize: "0.82rem", color: "#6b7280" }}>{new Date(r.updated_at).toLocaleString("zh-CN")}</td>
              <td>
                <button className="btn btn-sm btn-ghost" onClick={() => handlePreview(r.id, r.title)}>
                  <Eye size={14} /> 查看
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination offset={offset} limit={LIMIT} total={total} onChange={setOffset} />

      <Modal open={showPreview} onClose={() => setShowPreview(false)} title={`对话预览：${previewTitle}`}>
        <div style={{ maxHeight: "60vh", overflowY: "auto", padding: "8px 0" }}>
          {loadingPreview ? (
            <p style={{ textAlign: "center", color: "#9ca3af" }}>加载中...</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {messages.map((m, i) => (
                <div
                  key={m.id || i}
                  style={{
                    alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "70%",
                    padding: "10px 14px",
                    borderRadius: 12,
                    background: m.role === "user" ? "#2563eb" : "#f4f5f7",
                    color: m.role === "user" ? "#fff" : "#1f2937",
                    fontSize: "0.88rem",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {m.content}
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
