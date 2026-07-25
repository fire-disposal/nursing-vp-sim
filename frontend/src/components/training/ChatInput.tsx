import { Loader2, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";

function useVisualViewportOffset() {
	const [offset, setOffset] = useState(0);

	useEffect(() => {
		const vv = window.visualViewport;
		if (!vv) return;

		const onResize = () => {
			const bottom = window.innerHeight - (vv.height + vv.offsetTop);
			setOffset(Math.max(0, bottom));
		};
		vv.addEventListener("resize", onResize);
		vv.addEventListener("scroll", onResize);
		return () => {
			vv.removeEventListener("resize", onResize);
			vv.removeEventListener("scroll", onResize);
		};
	}, []);

	return offset;
}

interface ChatInputProps {
	onSend: (text: string) => void;
	disabled?: boolean;
	loading?: boolean;
	trainingEnded?: boolean;
}

export function ChatInput({ onSend, disabled, loading, trainingEnded }: ChatInputProps) {
	const [text, setText] = useState("");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const vvOffset = useVisualViewportOffset();


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
			className="border-t border-border bg-muted/30 shrink-0 transition-transform duration-150"
			style={{
				paddingBottom: `max(env(safe-area-inset-bottom), 0.5rem)`,
				transform: vvOffset > 0 ? `translateY(-${vvOffset}px)` : undefined,
			}}
		>
			<div className="relative mx-auto flex w-full max-w-3xl items-end gap-2.5 px-3 sm:px-4 py-2.5">
			<textarea
				ref={inputRef}
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={handleKeyDown}
				maxLength={2000}
				placeholder={trainingEnded ? "训练已结束，评分结果已生成" : loading ? "患者正在回复中…" : "输入消息与患者对话..."}
				rows={1}
				onInput={handleInput}
				inputMode="text"
				enterKeyHint="send"
				autoCapitalize="off"
				autoCorrect="off"
				className="flex-1 resize-none rounded-xl border border-border/60 bg-background px-3.5 py-2.5 text-sm md:text-base outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-shadow placeholder:text-muted-foreground"
			/>
			<button
				type="button"
				onClick={handleSend}
				disabled={disabled || loading || !text.trim()}
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
			</div>
		</div>
	);
}
