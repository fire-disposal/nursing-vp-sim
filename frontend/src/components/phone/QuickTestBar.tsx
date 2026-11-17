import { Button, Group, Tooltip } from "@mantine/core";
import { IconAlertTriangle, IconHeartHandshake, IconMessageDots } from "@tabler/icons-react";

/**
 * QuickTestBar —— 三个**演示用例**按钮（不是对话剧本）。
 *
 * 它们和自由输入走完全相同的一条路径（同一个 `handleUserText` / `runTurn`），
 * 只是帮演示者把"问候 / 长回复打断 / 问情绪"这三个特性一键show 出来。
 * 「长回复」会让后端返回一段长台词（`test_mode=long_response`），
 * 好让学生在她说到一半时开口，验证停播与消息截断。
 */
export interface QuickTestBarProps {
	onRun: (kind: "greeting" | "interrupt" | "emotion") => void;
	disabled?: boolean;
	/** 窄屏：三条等宽并排，不换行。 */
	compact?: boolean;
}

const CASES: Array<{
	kind: "greeting" | "interrupt" | "emotion";
	label: string;
	hint: string;
	icon: typeof IconMessageDots;
}> = [
	{ kind: "greeting", label: "问候", hint: "发一句问候，观察她的初始反应", icon: IconMessageDots },
	{ kind: "interrupt", label: "长回复", hint: "让她说长台词，说到一半可开口打断", icon: IconAlertTriangle },
	{ kind: "emotion", label: "问情绪", hint: "问一句情绪，观察四维数值变化", icon: IconHeartHandshake },
];

export default function QuickTestBar({ onRun, disabled = false, compact = false }: QuickTestBarProps) {
	return (
		<Group gap="xs" wrap={compact ? "nowrap" : "wrap"} w={compact ? "100%" : undefined} data-testid="quick-tests">
			{CASES.map(({ kind, label, hint, icon: Icon }) => (
				<Tooltip key={kind} label={hint} withArrow>
					<Button
						size={compact ? "compact-xs" : "compact-sm"}
						variant="light"
						leftSection={<Icon size={14} />}
						onClick={() => onRun(kind)}
						disabled={disabled}
						data-testid={`quick-test-${kind}`}
						aria-label={hint}
						style={compact ? { flex: 1, minWidth: 0, paddingInline: 6 } : undefined}
					>
						{label}
					</Button>
				</Tooltip>
			))}
		</Group>
	);
}
