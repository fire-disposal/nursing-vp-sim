import { Send } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { submitFeedback } from "../api/api-client";
import { useToast } from "./Toast";
import Modal from "./ui/Modal";

interface Mood {
  value: number;
  emoji: string;
  label: string;
}

const moods: Mood[] = [
  { value: 1, emoji: "\uD83D\uDE1E", label: "很差" },
  { value: 2, emoji: "\uD83D\uDE10", label: "较差" },
  { value: 3, emoji: "\uD83D\uDE42", label: "一般" },
  { value: 4, emoji: "\uD83D\uDE0A", label: "满意" },
  { value: 5, emoji: "\uD83D\uDE0D", label: "很满意" },
];

interface Tag {
  value: string;
  label: string;
}

const tags: Tag[] = [
  { value: "feature", label: "功能建议" },
  { value: "bug", label: "BUG反馈" },
  { value: "experience", label: "体验评价" },
  { value: "content", label: "内容质量" },
  { value: "ui", label: "界面设计" },
  { value: "other", label: "其他" },
];

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
}

export default function FeedbackModal({ open, onClose, onSubmitted }: FeedbackModalProps) {
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
      <div className="flex flex-col gap-6">
        <div>
          <div className="text-sm text-muted-foreground mb-3 font-medium">整体评价</div>
          <div className="flex justify-center gap-3">
            {moods.map((m) => (
              <button
                key={m.value}
                onClick={() => setRating(m.value)}
                className={cn(
                  "flex flex-col items-center gap-1 py-2 px-3 rounded-md border-2 cursor-pointer transition-all duration-150",
                  rating === m.value ? "border-primary bg-accent scale-110" : "border-transparent bg-transparent",
                )}
              >
                <span className={cn("leading-none transition-all", rating === m.value ? "text-[44px]" : "text-[36px]")}>{m.emoji}</span>
                <span className={cn("text-xs", rating === m.value ? "text-primary font-semibold" : "text-muted-foreground/60 font-normal")}>{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-sm text-muted-foreground mb-3 font-medium">反馈类型</div>
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <button
                key={t.value}
                onClick={() => setTag(tag === t.value ? "" : t.value)}
                className={cn(
                  "py-1 px-3 rounded-full border text-sm cursor-pointer transition-all duration-150",
                  tag === t.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-sm text-muted-foreground mb-3 font-medium">
            详细描述 <span className="text-muted-foreground/60 font-normal">(选填)</span>
          </div>
          <textarea
            placeholder="请详细描述你的想法..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            className="w-full p-3 rounded-md border border-border text-sm resize-y outline-none box-border transition-colors duration-150 bg-card focus:border-primary"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={handleClose}
          disabled={submitting}
          className="px-6 py-2 rounded-md border border-border bg-card text-muted-foreground text-sm font-medium cursor-pointer transition-colors duration-150"
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          disabled={!rating || submitting}
          className={cn(
            "px-6 py-2 rounded-md border-none cursor-pointer text-sm font-medium text-white flex items-center gap-1 transition-colors duration-150",
            rating && !submitting ? "bg-primary" : "bg-gray-300 opacity-60 cursor-not-allowed",
          )}
        >
          <Send size={14} />
          提交
        </button>
      </div>
    </Modal>
  );
}
