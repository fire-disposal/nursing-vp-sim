import { ChevronDown, ChevronUp, MessageSquareQuote } from "lucide-react";
import { useMemo, useState } from "react";
import type { PatientData } from "@/engine/types";
import { EXTRA_CHAT_PROMPTS, getQuickPrompts } from "./quick-prompts";

const COLLAPSE_KEY = "training:quickPromptsCollapsed";

interface QuickPromptBarProps {
	patient: PatientData;
	disabled?: boolean;
	onSelect: (text: string) => void;
}

/**
 * 对话中的快捷问句条（仅练习模式展示，由 ChatArea 门控）。
 * 点击即发送；可折叠，折叠状态 localStorage 持久化。
 */
export function QuickPromptBar({ patient, disabled, onSelect }: QuickPromptBarProps) {
	const [collapsed, setCollapsed] = useState(
		() => localStorage.getItem(COLLAPSE_KEY) === "1",
	);

	const prompts = useMemo(
		() => [...getQuickPrompts(patient), ...EXTRA_CHAT_PROMPTS],
		[patient],
	);

	const toggle = () => {
		setCollapsed((prev) => {
			localStorage.setItem(COLLAPSE_KEY, prev ? "0" : "1");
			return !prev;
		});
	};

	if (collapsed) {
		return (
			<div className="flex px-3 py-1 border-t border-border bg-card shrink-0">
				<button
					type="button"
					onClick={toggle}
					className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
				>
					<MessageSquareQuote size={12} />
					常用问句
					<ChevronDown size={12} />
				</button>
			</div>
		);
	}

	return (
		<div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-border bg-card shrink-0 overflow-x-auto">
			<MessageSquareQuote size={13} className="text-muted-foreground shrink-0" />
			{prompts.map((prompt) => (
				<button
					key={prompt}
					type="button"
					disabled={disabled}
					onClick={() => onSelect(prompt)}
					className="shrink-0 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-foreground disabled:opacity-40"
				>
					{prompt}
				</button>
			))}
			<button
				type="button"
				onClick={toggle}
				title="收起常用问句"
				className="ml-auto shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground transition-colors"
			>
				<ChevronUp size={14} />
			</button>
		</div>
	);
}
