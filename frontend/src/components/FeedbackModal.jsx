import { MessageSquare, Send } from "lucide-react";
import { useState } from "react";
import { submitFeedback } from "../api";
import { useToast } from "./Toast";
import Modal from "./ui/Modal";

const moods = [
  { value: 1, emoji: "😞", label: "很差" },
  { value: 2, emoji: "😞", label: "较差" },
  { value: 3, emoji: "🙂", label: "一般" },
  { value: 4, emoji: "😊", label: "满意" },
  { value: 5, emoji: "😍", label: "很满意" },
];

const tags = [
  { value: "feature", label: "功能建议" },
  { value: "bug", label: "BUG反馈" },
  { value: "experience", label: "体验评价" },
  { value: "content", label: "内容质量" },
  { value: "ui", label: "界面设计" },
  { value: "other", label: "其他" },
];

const btnBase = {
  padding: "var(--space-2) var(--space-5)",
  borderRadius: "var(--radius-md)",
  border: "none",
  cursor: "pointer",
  fontSize: "var(--font-size-base)",
  fontWeight: "var(--font-weight-medium)",
  transition: "background var(--transition-fast)",
};

export default function FeedbackModal({ open, onClose, onSubmitted }) {
  const [rating, setRating] = useState(0);
  const [tag, setTag] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const handleSubmit = async () => {
    if (!rating) return;
    setSubmitting(true);
    try {
      await submitFeedback({ rating, tag, content });
      toast.success("感谢你的反馈！");
      setRating(0);
      setTag("");
      setContent("");
      onClose();
      if (onSubmitted) onSubmitted();
    } catch {
      toast.error("提交失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    setRating(0);
    setTag("");
    setContent("");
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="意见反馈" maxWidth={480}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        <div>
          <div
            style={{ fontSize: "var(--font-size-sm)", color: "var(--text-secondary)", marginBottom: "var(--space-3)", fontWeight: "var(--font-weight-medium)" }}
          >
            整体评价
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: "var(--space-3)" }}>
            {moods.map((m) => (
              <button
                key={m.value}
                onClick={() => setRating(m.value)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  padding: "var(--space-2) var(--space-3)",
                  borderRadius: "var(--radius-md)",
                  border: rating === m.value ? "2px solid var(--color-primary)" : "2px solid transparent",
                  background: rating === m.value ? "var(--color-primary-soft)" : "transparent",
                  cursor: "pointer",
                  transition: "all var(--transition-fast)",
                  transform: rating === m.value ? "scale(1.08)" : "scale(1)",
                }}
              >
                <span style={{ fontSize: rating === m.value ? 44 : 36, lineHeight: 1 }}>{m.emoji}</span>
                <span
                  style={{
                    fontSize: "var(--font-size-xs)",
                    color: rating === m.value ? "var(--color-primary)" : "var(--text-tertiary)",
                    fontWeight: rating === m.value ? "var(--font-weight-semibold)" : "var(--font-weight-normal)",
                  }}
                >
                  {m.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div
            style={{ fontSize: "var(--font-size-sm)", color: "var(--text-secondary)", marginBottom: "var(--space-3)", fontWeight: "var(--font-weight-medium)" }}
          >
            反馈类型
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
            {tags.map((t) => (
              <button
                key={t.value}
                onClick={() => setTag(tag === t.value ? "" : t.value)}
                style={{
                  padding: "var(--space-1) var(--space-3)",
                  borderRadius: "var(--radius-full)",
                  border: tag === t.value ? "1px solid var(--color-primary)" : "1px solid var(--border-color)",
                  background: tag === t.value ? "var(--color-primary)" : "var(--bg-surface)",
                  color: tag === t.value ? "var(--text-inverse)" : "var(--text-secondary)",
                  fontSize: "var(--font-size-sm)",
                  cursor: "pointer",
                  transition: "all var(--transition-fast)",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div
            style={{ fontSize: "var(--font-size-sm)", color: "var(--text-secondary)", marginBottom: "var(--space-3)", fontWeight: "var(--font-weight-medium)" }}
          >
            详细描述 <span style={{ color: "var(--text-tertiary)", fontWeight: "var(--font-weight-normal)" }}>(选填)</span>
          </div>
          <textarea
            placeholder="请详细描述你的想法..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            style={{
              width: "100%",
              padding: "var(--space-3)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-color)",
              fontSize: "var(--font-size-base)",
              fontFamily: "inherit",
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
              transition: "border-color var(--transition-fast)",
              background: "var(--bg-surface)",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "var(--color-primary)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "var(--border-color)";
            }}
          />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
        <button
          onClick={handleClose}
          disabled={submitting}
          style={{
            ...btnBase,
            background: "var(--bg-surface)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border-color)",
          }}
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          disabled={!rating || submitting}
          style={{
            ...btnBase,
            background: rating && !submitting ? "var(--color-primary)" : "var(--gray-300)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-1)",
            opacity: rating && !submitting ? 1 : 0.6,
          }}
        >
          <Send size={14} />
          提交
        </button>
      </div>
    </Modal>
  );
}
