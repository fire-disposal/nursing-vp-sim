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
      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
        <MessageCircle size={48} />
        <p className="mt-3 text-gray-500">加载中...</p>
      </div>
    );
  }

  if (records.length === 0 && offset === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
        <MessageCircle size={48} />
        <p className="mt-3 text-gray-500">暂无问答记录</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="mb-3 text-gray-500 text-sm">共 {total} 条问答会话</div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200">学生</th>
            <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200">学号</th>
            <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200">会话标题</th>
            <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200">消息数</th>
            <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200">最后活跃</th>
            <th className="text-left px-4 py-2.5 bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider border-b border-gray-200">操作</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 border-b border-gray-200 font-semibold">{r.student_name || r.student_code}</td>
              <td className="px-4 py-3 border-b border-gray-200">{r.student_code || "-"}</td>
              <td className="px-4 py-3 border-b border-gray-200 max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">{truncate(r.title, 40)}</td>
              <td className="px-4 py-3 border-b border-gray-200">{r.message_count}</td>
              <td className="px-4 py-3 border-b border-gray-200 whitespace-nowrap text-sm text-gray-500">{new Date(r.updated_at).toLocaleString("zh-CN")}</td>
              <td className="px-4 py-3 border-b border-gray-200">
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg border border-transparent hover:bg-gray-100 hover:text-gray-900 transition-colors"
                  onClick={() => handlePreview(r.id, r.title)}
                >
                  <Eye size={14} /> 查看
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination offset={offset} limit={LIMIT} total={total} onChange={setOffset} />

      <Modal open={showPreview} onClose={() => setShowPreview(false)} title={`对话预览：${previewTitle}`}>
        <div className="max-h-[60vh] overflow-y-auto py-2">
          {loadingPreview ? (
            <p className="text-center text-gray-400">加载中...</p>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((m, i) => (
                <div
                  key={m.id || i}
                  className={`max-w-[70%] px-[14px] py-2.5 rounded-xl text-sm whitespace-pre-wrap break-words ${
                    m.role === "user" ? "self-end bg-[#2563eb] text-white" : "self-start bg-[#f4f5f7] text-gray-800"
                  }`}
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
