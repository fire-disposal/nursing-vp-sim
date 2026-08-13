// MessageSquareQuote（lucide）在 tabler 无等价图标，语义上取 IconQuote（引号）。
import { IconChevronDown, IconChevronUp, IconQuote } from "@tabler/icons-react";
import { useMemo } from "react";
import { ActionIcon, Box } from "@mantine/core";
import type { PatientData } from "@/engine/types";
import { useUiPrefsStore } from "@/stores/uiPrefsStore";
import { EXTRA_CHAT_PROMPTS, getQuickPrompts } from "./quick-prompts";


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
	const collapsed = useUiPrefsStore((s) => s.quickPromptsCollapsed);
	const setCollapsed = useUiPrefsStore((s) => s.setQuickPromptsCollapsed);

	const prompts = useMemo(
		() => [...getQuickPrompts(patient), ...EXTRA_CHAT_PROMPTS],
		[patient],
	);

	const toggle = () => {
		setCollapsed(!collapsed);
	};

	if (collapsed) {
		return (
			<Box
				style={{
					display: "flex",
					padding: "4px 12px",
					borderTop: "1px solid var(--mantine-color-default-border)",
					background: "var(--mantine-color-body)",
					flexShrink: 0,
				}}
			>
				<Box
					component="button"
					type="button"
					onClick={toggle}
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: 4,
						fontSize: 11,
						color: "var(--mantine-color-dimmed)",
						background: "transparent",
						border: "none",
						cursor: "pointer",
					}}
				>
					<IconQuote size={12} />
					常用问句
					<IconChevronDown size={12} />
				</Box>
			</Box>
		);
	}

	return (
		<Box
			style={{
				display: "flex",
				alignItems: "center",
				gap: 6,
				padding: "6px 12px",
				borderTop: "1px solid var(--mantine-color-default-border)",
				background: "var(--mantine-color-body)",
				flexShrink: 0,
				overflowX: "auto",
			}}
		>
			<IconQuote size={13} style={{ color: "var(--mantine-color-dimmed)", flexShrink: 0 }} />
			{prompts.map((prompt) => (
				<Box
					key={prompt}
					component="button"
					type="button"
					disabled={disabled}
					onClick={() => onSelect(prompt)}
					style={{
						flexShrink: 0,
						borderRadius: 999,
						border: "1px solid var(--mantine-color-default-border)",
						background: "var(--mantine-color-body)",
						padding: "4px 12px",
						fontSize: 12,
						color: "var(--mantine-color-dimmed)",
						cursor: disabled ? "not-allowed" : "pointer",
						opacity: disabled ? 0.4 : 1,
					}}
				>
					{prompt}
				</Box>
			))}
			<ActionIcon
				variant="subtle"
				color="gray"
				size="sm"
				radius="xl"
				onClick={toggle}
				title="收起常用问句"
				style={{ marginLeft: "auto", flexShrink: 0 }}
			>
				<IconChevronUp size={14} />
			</ActionIcon>
		</Box>
	);
}
