import { MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { getQAHistoryAll } from "../../api";
import Pagination from "../../components/Pagination";
import { useToast } from "../Toast";

function truncate(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

export default function QARecordsTab() {
  const [records, setRecords] = useState([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const LIMIT = 20;
  const toast = useToast();

  useEffect(() => {
    getQAHistoryAll({ offset, limit: LIMIT })
      .then(({ data }) => {
        setRecords(data.items);
        setTotal(data.total);
      })
      .catch(() => toast.error("加载问答记录失败"));
  }, [offset, toast]);

  const toggleExpand = (id) => setExpanded(expanded === id ? null : id);

  return (
    <div className="card">
      <div style={{ marginBottom: 16, fontSize: "0.85rem", color: "var(--text-secondary)" }}>共 {total} 条问答记录</div>
      {records.length === 0 ? (
        <div className="empty-state">
          <div className="icon">
            <MessageCircle size={42} />
          </div>
          <div>暂无问答记录</div>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>学生</th>
              <th>学号</th>
              <th>问题</th>
              <th>回答</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const isOpen = expanded === r.id;
              return (
                <tr key={r.id} onClick={() => toggleExpand(r.id)} style={{ cursor: "pointer" }}>
                  <td style={{ fontWeight: 500 }}>{r.display_name || r.username}</td>
                  <td style={{ color: "var(--text-secondary)" }}>{r.display_name ? r.username : "-"}</td>
                  <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isOpen ? "normal" : "nowrap" }}>
                    {isOpen ? r.question : truncate(r.question, 40)}
                  </td>
                  <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isOpen ? "normal" : "nowrap" }}>
                    {isOpen ? r.answer : truncate(r.answer, 50)}
                  </td>
                  <td style={{ fontSize: "0.78rem", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                    {new Date(r.created_at).toLocaleString("zh-CN")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Pagination total={total} offset={offset} limit={LIMIT} onChange={setOffset} />
    </div>
  );
}
