import { Send } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { SlotProps } from "@/engine/types";

export function ChatInput({ ctx }: SlotProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || ctx.loading) return;
    ctx.sendMessage(trimmed);
    setText("");
    inputRef.current?.focus();
  }, [text, ctx]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="flex items-end gap-2 px-3 py-2 border-t bg-background flex-1">
      <div className="flex-1">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息与患者对话..."
          disabled={ctx.loading}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
        />
      </div>
      <button
        type="button"
        onClick={handleSend}
        disabled={ctx.loading || !text.trim()}
        className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
      >
        <Send size={16} />
      </button>
    </div>
  );
}
