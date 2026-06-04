import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Lightbulb, Menu, Plus, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { askInQASession, createQASession, deleteQASession, getQASessionMessages, getQASessions } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import Layout from "@/components/Layout";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { getNurseAvatar } from "@/utils/avatar";
import { cn } from "@/lib/utils";

type QASessionItem = components["schemas"]["QASessionItem"];
type QAMessageItem = components["schemas"]["QAMessageItem"];

const SUGGESTIONS = ["病史采集技巧", "护理评估方法", "护理诊断与医疗诊断区别", "无菌技术要点", "生命体征测量规范"];

interface OptimisticMessage {
  id: number;
  role: string;
  content: string;
}

const BUBBLE_CONTENT_CLASSES = [
  "whitespace-pre-wrap break-words",
  "[&_p]:mb-2 [&_p:last-child]:mb-0",
  "[&_code]:bg-black/[0.06] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:font-mono",
  "[&_pre]:bg-black/[0.06] [&_pre]:p-2.5 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:my-2",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-sm",
  "[&_ul]:my-1 [&_ul]:pl-6 [&_ol]:my-1 [&_ol]:pl-6",
  "[&_li]:mb-0.5",
  "[&_table]:border-collapse [&_table]:my-2 [&_table]:w-full",
  "[&_th]:bg-black/[0.04] [&_th]:font-semibold [&_th]:border [&_th]:border-black/10 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-sm",
  "[&_td]:border [&_td]:border-black/10 [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:text-left [&_td]:text-sm",
  "[&_blockquote]:border-l-[3px] [&_blockquote]:border-black/15 [&_blockquote]:my-2 [&_blockquote]:px-3 [&_blockquote]:py-1 [&_blockquote]:opacity-85",
].join(" ");

const BUBBLE_CONTENT_USER = [
  "[&_code]:bg-white/15 [&_code]:text-white",
  "[&_pre]:bg-white/10",
  "[&_blockquote]:border-l-white/30",
  "[&_th]:border-white/20 [&_th]:bg-white/[0.08]",
  "[&_td]:border-white/20",
].join(" ");

export default function QA() {
  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<QAMessageItem[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { confirm } = useConfirm();
  const toast = useToast();

  const { data: sessions = [] } = useQuery({
    queryKey: ["qaSessions"],
    queryFn: () => getQASessions().then((r) => r.data || []),
    staleTime: 30_000,
  });

  const loadSessions = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["qaSessions"] });
  }, [queryClient]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const switchSession = useCallback(
    async (sessionId: number) => {
      try {
        const res = await getQASessionMessages(sessionId);
        setActiveSessionId(sessionId);
        setMessages(res.data || []);
      } catch {
        toast.error("加载会话消息失败");
      }
    },
    [toast],
  );

  const sendMessage = useCallback(
    async (text?: string) => {
      const q = (text || input).trim();
      if (!q || loading) return;
      setInput("");
      const optimisticId = -Date.now();

      if (!activeSessionId) {
        setLoading(true);
        setMessages([{ id: optimisticId, role: "user", content: q } as QAMessageItem]);
        try {
          const res = await createQASession(q);
          const { session_id, answer: ans } = res.data;
          setActiveSessionId(session_id);
          setMessages([
            { id: optimisticId, role: "user", content: q } as QAMessageItem,
            { id: optimisticId + 1, role: "assistant", content: ans } as QAMessageItem,
          ]);
          await loadSessions();
        } catch (err: unknown) {
          const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
          setMessages([
            { id: optimisticId, role: "user", content: q } as QAMessageItem,
            {
              id: -1,
              role: "assistant",
              content: "抱歉，AI导师暂时无法回复：" + (axiosErr.response?.data?.detail || axiosErr.message || "网络错误"),
            } as QAMessageItem,
          ]);
        } finally {
          setLoading(false);
        }
        return;
      }

      setMessages((prev) => [...prev, { id: optimisticId, role: "user", content: q } as QAMessageItem]);
      setLoading(true);
      try {
        const res = await askInQASession(activeSessionId, q);
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== optimisticId),
          { id: optimisticId, role: "user", content: q } as QAMessageItem,
          { id: optimisticId + 1, role: "assistant", content: res.data.answer } as QAMessageItem,
        ]);
        await loadSessions();
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== optimisticId),
          { id: optimisticId, role: "user", content: q } as QAMessageItem,
          {
            id: -1,
            role: "assistant",
            content: "抱歉，AI导师暂时无法回复：" + (axiosErr.response?.data?.detail || axiosErr.message || "未知错误"),
          } as QAMessageItem,
        ]);
      } finally {
        setLoading(false);
      }
    },
    [input, loading, activeSessionId, loadSessions],
  );

  const handleDeleteSession = useCallback(
    async (e: React.MouseEvent, sessionId: number) => {
      e.stopPropagation();
      const ok = await confirm({ title: "删除会话", message: "确定要删除此会话？", danger: true });
      if (!ok) return;
      try {
        await deleteQASession(sessionId);
        if (activeSessionId === sessionId) {
          setActiveSessionId(null);
          setMessages([]);
        }
        await loadSessions();
      } catch {
        toast.error("删除会话失败");
      }
    },
    [activeSessionId, loadSessions, confirm, toast],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleNewChat = () => {
    setActiveSessionId(null);
    setMessages([]);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const nurseAvatar = getNurseAvatar();

  return (
    <Layout>
      <div className="flex h-[calc(100vh-64px)] overflow-hidden">
        {showSidebar && <div className="fixed inset-0 z-[199] bg-black/40 md:hidden" onClick={() => setShowSidebar(false)} />}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-[200] flex w-[260px] min-w-[260px] flex-col bg-[#fafbfc] shadow-[2px_0_20px_rgba(0,0,0,0.15)] transition-transform duration-250",
            showSidebar ? "translate-x-0" : "-translate-x-full",
            "md:static md:translate-x-0 md:border-r md:border-border md:shadow-none",
          )}
        >
          <button
            className="flex shrink-0 items-center gap-2 m-3.5 px-4 py-2.5 border border-border rounded-lg bg-white cursor-pointer text-sm text-gray-700 transition-all hover:bg-gray-100 hover:border-blue-600 hover:text-blue-600"
            onClick={handleNewChat}
          >
            <Plus size={16} />
            <span>新对话</span>
          </button>
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {sessions.map((s) => (
              <div
                key={s.id}
                className={cn(
                  "grid grid-cols-[1fr_auto] grid-rows-[auto_auto] gap-y-0.5 gap-x-2 px-3 py-2.5 mb-0.5 rounded-lg cursor-pointer transition-colors relative group",
                  activeSessionId === s.id ? "bg-[#e8edf5]" : "hover:bg-[#e8edf5]",
                )}
                onClick={() => switchSession(s.id)}
              >
                <span className="text-sm text-gray-800 truncate">{s.title}</span>
                <span className="text-xs text-gray-400">{new Date(s.updated_at).toLocaleDateString()}</span>
                <button
                  className="row-span-2 col-start-2 self-center opacity-0 group-hover:opacity-100 bg-transparent border-none text-gray-400 cursor-pointer p-1 rounded transition-all hover:text-red-500 hover:bg-red-100"
                  onClick={(e) => handleDeleteSession(e, s.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {sessions.length === 0 && <div className="py-6 px-4 text-center text-gray-400 text-sm">暂无历史对话</div>}
          </div>
        </aside>

        <main className="flex-1 flex flex-col min-w-0 bg-white relative">
          <button
            className="flex md:hidden absolute top-2 left-2 z-10 size-[34px] border border-gray-200 rounded-lg bg-white cursor-pointer items-center justify-center text-gray-500"
            onClick={() => setShowSidebar(true)}
            title="会话列表"
          >
            <Menu size={18} />
          </button>
          {messages.length > 0 && (
            <div className="flex flex-col gap-4 pt-6 px-6 flex-1 overflow-y-auto">
              {messages.map((m, i) => {
                const isUser = m.role === "user";
                return (
                  <div key={i} className={cn("flex items-end gap-2", isUser ? "justify-end" : "justify-start")}>
                    {!isUser && (
                      <div className="size-8 rounded-full shrink-0 flex items-center justify-center bg-[#e8edf5] text-blue-600">
                        <Bot size={18} />
                      </div>
                    )}
                    <div
                      className={cn(
                        "max-w-[70%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed",
                        isUser ? "bg-blue-600 text-white rounded-br-md" : "bg-[#f4f5f7] text-gray-800 rounded-bl-md",
                      )}
                    >
                      <div className={cn(BUBBLE_CONTENT_CLASSES, !isUser || BUBBLE_CONTENT_USER)}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                      </div>
                    </div>
                    {isUser && <img className="size-8 rounded-full shrink-0 object-cover bg-gray-100" src={nurseAvatar} alt="护士" />}
                  </div>
                );
              })}
              {loading && (
                <div className="flex items-end gap-2 justify-start">
                  <div className="size-8 rounded-full shrink-0 flex items-center justify-center bg-[#e8edf5] text-blue-600">
                    <Bot size={18} />
                  </div>
                  <div className="max-w-[70%] px-4 py-2.5 rounded-2xl rounded-bl-md text-sm leading-relaxed bg-[#f4f5f7] text-gray-800">
                    <div className="flex gap-1 py-1">
                      <span className="size-2 rounded-full bg-gray-400 animate-[qa-bounce_1.4s_ease-in-out_infinite_both] [animation-delay:-0.32s]" />
                      <span className="size-2 rounded-full bg-gray-400 animate-[qa-bounce_1.4s_ease-in-out_infinite_both] [animation-delay:-0.16s]" />
                      <span className="size-2 rounded-full bg-gray-400 animate-[qa-bounce_1.4s_ease-in-out_infinite_both]" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          {messages.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 pb-6 text-center">
              <Lightbulb size={48} className="text-blue-300 mb-2" />
              <h2 className="text-2xl font-semibold text-gray-800">护理问答</h2>
              <p className="text-gray-500 text-base max-w-[360px]">向AI护理导师提问，获取专业的护理学知识解答</p>
              <div className="flex flex-wrap gap-2 justify-center mt-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    className="px-4 py-2 border border-gray-300 rounded-[20px] bg-white text-sm text-gray-700 cursor-pointer transition-all hover:border-blue-600 hover:text-blue-600 hover:bg-blue-50"
                    onClick={() => sendMessage(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2.5 items-center border-t border-gray-200 px-6 py-4">
            <input
              ref={inputRef}
              className="w-full border border-gray-200 rounded-lg bg-gray-50 text-gray-900 text-sm px-3 py-2 focus:outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入您的问题..."
              disabled={loading}
            />
            <button
              className="inline-flex items-center justify-center size-10 rounded-lg bg-blue-600 text-white cursor-pointer transition-colors shrink-0 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
            >
              <Send size={16} />
            </button>
          </div>
        </main>
      </div>
    </Layout>
  );
}
