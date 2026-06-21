import { Loader2, Send } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

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
		setTimeout(() => {
			const el = inputRef.current;
			if (el) el.style.height = "auto";
		}, 0);
		inputRef.current?.focus();
	}, [text, onSend, disabled, loading]);

	const handleInput = useCallback(() => {
		const el = inputRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
	}, []);

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
		<div
			className="flex items-end gap-2.5 px-3 sm:px-4 py-2.5 border-t border-border bg-muted/30 shrink-0"
			style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
		>
			<textarea
				ref={inputRef}
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder={loading ? "患者正在回复中，可提前输入下一句…" : "输入消息与患者对话..."}
				rows={1}
				onInput={handleInput}
				className="flex-1 resize-none rounded-xl border border-border/60 bg-background px-3.5 py-2.5 text-sm md:text-base outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-shadow placeholder:text-muted-foreground"
			/>
			<button
				type="button"
				onClick={handleSend}
				disabled={disabled || loading || !text.trim()}
				className={cn(
					"flex shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors disabled:opacity-40",
					"size-9 md:size-10",
					!disabled && !loading && "hover:bg-primary/90 active:scale-95",
				)}
			>
				{loading ? (
					<Loader2 size={16} className="animate-spin md:size-[18px]" />
				) : (
					<Send size={16} className="md:size-[18px]" />
				)}
			</button>
		</div>
	);
}
