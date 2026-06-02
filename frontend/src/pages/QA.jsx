import { Bot, Lightbulb, Menu, Plus, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { askInQASession, createQASession, deleteQASession, getQASessionMessages, getQASessions } from "../api";
import Layout from "../components/Layout";
import { getNurseAvatar } from "../utils/avatar";

const SUGGESTIONS = ["病史采集技巧", "护理评估方法", "护理诊断与医疗诊断区别", "无菌技术要点", "生命体征测量规范"];

export default function QA() {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const loadSessions = useCallback(async () => {
    try {
      const res = await getQASessions();
      setSessions(res.data || []);
    } catch (e) {
      console.error("加载会话列表失败", e);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const switchSession = useCallback(async (sessionId) => {
    try {
      const res = await getQASessionMessages(sessionId);
      setActiveSessionId(sessionId);
      setMessages(res.data || []);
    } catch (e) {
      console.error("加载会话消息失败", e);
    }
  }, []);

  const sendMessage = useCallback(
    async (text) => {
      const q = (text || input).trim();
      if (!q || loading) return;
      setInput("");
      const optimisticId = -Date.now();

      if (!activeSessionId) {
        setLoading(true);
        setMessages([{ id: optimisticId, role: "user", content: q }]);
        try {
          const res = await createQASession(q);
          const { session_id, answer: ans } = res.data;
          setActiveSessionId(session_id);
          setMessages([
            { id: optimisticId, role: "user", content: q },
            { id: optimisticId + 1, role: "assistant", content: ans },
          ]);
          await loadSessions();
        } catch {
          setMessages([
            { id: optimisticId, role: "user", content: q },
            { id: -1, role: "assistant", content: "抱歉，AI导师暂时无法回复，请稍后重试。" },
          ]);
        } finally {
          setLoading(false);
        }
        return;
      }

      setMessages((prev) => [...prev, { id: optimisticId, role: "user", content: q }]);
      setLoading(true);
      try {
        const res = await askInQASession(activeSessionId, q);
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== optimisticId),
          { id: optimisticId, role: "user", content: q },
          { id: optimisticId + 1, role: "assistant", content: res.data.answer },
        ]);
        await loadSessions();
      } catch (e) {
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== optimisticId),
          { id: optimisticId, role: "user", content: q },
          { id: -1, role: "assistant", content: "抱歉，AI导师暂时无法回复：" + (e.response?.data?.detail || e.message) },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [input, loading, activeSessionId, loadSessions],
  );

  const handleDeleteSession = useCallback(
    async (e, sessionId) => {
      e.stopPropagation();
      if (!confirm("确定要删除此会话？")) return;
      try {
        await deleteQASession(sessionId);
        if (activeSessionId === sessionId) {
          setActiveSessionId(null);
          setMessages([]);
        }
        await loadSessions();
      } catch (e) {
        console.error("删除会话失败", e);
      }
    },
    [activeSessionId, loadSessions],
  );

  const handleKeyDown = (e) => {
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
      <div className="qa-layout">
        {showSidebar && <div className="sidebar-overlay" onClick={() => setShowSidebar(false)} style={{ zIndex: 199 }} />}
        <aside className={`qa-sidebar${showSidebar ? " show" : ""}`}>
          <button className="qa-new-btn" onClick={handleNewChat}>
            <Plus size={16} />
            <span>新对话</span>
          </button>
          <div className="qa-session-list">
            {sessions.map((s) => (
              <div key={s.id} className={`qa-session-item ${activeSessionId === s.id ? "active" : ""}`} onClick={() => switchSession(s.id)}>
                <span className="qa-session-title">{s.title}</span>
                <span className="qa-session-time">{new Date(s.updated_at).toLocaleDateString()}</span>
                <button className="qa-session-delete" onClick={(e) => handleDeleteSession(e, s.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {sessions.length === 0 && <div className="qa-session-empty">暂无历史对话</div>}
          </div>
        </aside>

        <main className="qa-main">
          <button className="qa-sidebar-toggle" onClick={() => setShowSidebar(true)} title="会话列表">
            <Menu size={18} />
          </button>
          {messages.length > 0 && (
            <div className="qa-messages">
              {messages.map((m, i) => {
                const isUser = m.role === "user";
                return (
                  <div key={i} className={`qa-msg-row ${isUser ? "question" : "answer"}`}>
                    {!isUser && (
                      <div className="qa-avatar qa-avatar-bot">
                        <Bot size={18} />
                      </div>
                    )}
                    <div className="qa-bubble">
                      <div className="qa-bubble-content">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                      </div>
                    </div>
                    {isUser && <img className="qa-avatar qa-avatar-user" src={nurseAvatar} alt="护士" />}
                  </div>
                );
              })}
              {loading && (
                <div className="qa-msg-row answer">
                  <div className="qa-avatar qa-avatar-bot">
                    <Bot size={18} />
                  </div>
                  <div className="qa-bubble">
                    <div className="qa-typing">
                      <span className="qa-typing-dot" />
                      <span className="qa-typing-dot" />
                      <span className="qa-typing-dot" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          {messages.length === 0 && (
            <div className="qa-empty-state">
              <Lightbulb size={48} className="qa-empty-icon" />
              <h2>护理问答</h2>
              <p>向AI护理导师提问，获取专业的护理学知识解答</p>
              <div className="qa-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="qa-suggestion-btn" onClick={() => sendMessage(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="qa-input-row">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入您的问题..."
              disabled={loading}
            />
            <button className="qa-send-btn" onClick={() => sendMessage()} disabled={loading || !input.trim()}>
              <Send size={16} />
            </button>
          </div>
        </main>
      </div>
    </Layout>
  );
}
