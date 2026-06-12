import { Loader2, Send } from "lucide-react";
import { useCallback, useRef, useState } from "react";

interface ChatInputProps {
	onSend: (text: string) => void;
	disabled?: boolean;
	loading?: boolean;
}

export function ChatInput({ onSend, disabled, loading }: ChatInputProps) {
	const [text, setText] = useState("");
	const inputRef = useRef<HTMLTextAreaElement>(null);

	const handleSend = useCallback(() => {
		const trimmed = text.trim();
		if (!trimmed || disabled || loading) return;
		onSend(trimmed);
		setText("");
		inputRef.current?.focus();
	}, [text, onSend, disabled, loading]);

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
		<div className="flex items-end gap-2 px-3 py-2 border-t border-border bg-background shrink-0">
			<textarea
				ref={inputRef}
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder="输入消息与患者对话..."
				disabled={disabled}
				rows={1}
				className="flex-1 resize-none rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 placeholder:text-muted-foreground"
			/>
			<button
				type="button"
				onClick={handleSend}
				disabled={disabled || loading || !text.trim()}
				className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0 disabled:opacity-50 hover:bg-primary/90 transition-colors"
			>
				{loading ? (
					<Loader2 size={16} className="animate-spin" />
				) : (
					<Send size={16} />
				)}
			</button>
		</div>
	);
}
