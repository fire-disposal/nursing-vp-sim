import { Loader2, Mic, Send } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";


interface ChatInputProps {
	onSend: (text: string) => void;
	disabled?: boolean;
	loading?: boolean;
	trainingEnded?: boolean;
}

export function ChatInput({ onSend, disabled, loading, trainingEnded }: ChatInputProps) {
	const [text, setText] = useState("");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const showCount = text.length >= 1600;
	const placeholder = trainingEnded
		? "训练已结束，评分结果已生成"
		: loading
			? "患者正在回复中…"
			: "输入消息与患者对话...";


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
			className="border-t border-border bg-muted/30 shrink-0"
			style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
		>
			<div className="relative mx-auto flex w-full max-w-3xl items-end gap-2.5 px-3 sm:px-4 py-2.5">
			<button
				type="button"
				onClick={() => {}}
				aria-label="语音输入"
				title="语音输入"
				className="flex shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors size-11 active:scale-95"
			>
				<Mic size={18} />
			</button>
			<textarea
				ref={inputRef}
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={handleKeyDown}
				maxLength={2000}
				placeholder={placeholder}
				rows={1}
				onInput={handleInput}
				inputMode="text"
				enterKeyHint="send"
				autoCapitalize="off"
				autoCorrect="off"
				className="flex-1 resize-none rounded-xl border border-border/60 bg-background px-3.5 py-2.5 text-sm md:text-base outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-shadow placeholder:text-muted-foreground [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
				aria-label="输入消息与患者对话"
			/>
			<button
				type="button"
				onClick={handleSend}
				disabled={disabled || loading || !text.trim()}
				aria-label={loading ? "患者正在回复，暂不能发送" : "发送消息"}
				title={loading ? "患者正在回复，暂不能发送" : "发送消息"}
				className={cn(
					"flex shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors disabled:opacity-40",
					"size-11",
					!disabled && !loading && "hover:bg-primary/90 active:scale-95",
				)}
			>
				{loading ? (
					<Loader2 size={18} className="animate-spin" />
				) : (
					<Send size={18} />
				)}
			</button>
			{showCount && (
				<span className="absolute bottom-0 right-16 translate-y-full pt-1 text-[10px] text-muted-foreground tabular-nums">
					{text.length}/2000
				</span>
			)}
			</div>
		</div>
	);
}
