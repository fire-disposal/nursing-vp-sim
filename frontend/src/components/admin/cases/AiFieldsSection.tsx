import { IconPlus, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { ActionIcon, Badge, Group, Paper, Stack, Text, TextInput } from "@mantine/core";

interface Props {
	hiddenInfo: string[];
	requiredInquiries: string[];
	onHiddenInfoChange: (v: string[]) => void;
	onRequiredInquiriesChange: (v: string[]) => void;
	disabled?: boolean;
}

function TagEditor({ value, onChange, placeholder, disabled }: { value: string[]; onChange: (v: string[]) => void; placeholder: string; disabled?: boolean }) {
	const [input, setInput] = useState("");

	const add = () => {
		const t = input.trim();
		if (!t) return;
		onChange([...value, t]);
		setInput("");
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") { e.preventDefault(); add(); }
	};

	const remove = (idx: number) => {
		onChange(value.filter((_, i) => i !== idx));
	};

	return (
		<Stack gap={8}>
			{value.length > 0 && (
				<Group gap={4} wrap="wrap">
					{value.map((t, i) => (
						<Badge
							key={i}
							variant="secondary"
							rightSection={
								!disabled ? (
									<ActionIcon size="xs" variant="transparent" color="gray" onClick={() => remove(i)} aria-label="移除条目">
										<IconX size={10} />
									</ActionIcon>
								) : undefined
							}
						>
							{t}
						</Badge>
					))}
				</Group>
			)}
			{!disabled && (
				<Group gap={8}>
					<TextInput
						value={input}
						onChange={(e) => setInput(e.currentTarget.value)}
						onKeyDown={onKeyDown}
						placeholder={placeholder}
						style={{ flex: 1 }}
					/>
					<ActionIcon variant="light" color="blue" onClick={add} aria-label="添加条目"><IconPlus size={14} /></ActionIcon>
				</Group>
			)}
		</Stack>
	);
}

export function AiFieldsSection({ hiddenInfo, requiredInquiries, onHiddenInfoChange, onRequiredInquiriesChange, disabled }: Props) {
	return (
		<Paper withBorder p="md" radius="md">
			<Text size="sm" fw={600} mb="xs">AI 辅助字段</Text>
			<Text size="xs" c="dimmed" mb="md">这些字段可由 AI 生成，也可手动编辑</Text>
			<Stack gap="md">
				<div>
					<Text size="xs" fw={600} c="dimmed" mb={4}>隐藏信息</Text>
					<Text size="xs" c="dimmed" opacity={0.6} mb={4}>患者不会主动透露的信息（吸烟史、职业等）</Text>
					<TagEditor value={hiddenInfo} onChange={onHiddenInfoChange} placeholder="输入后回车添加" disabled={disabled} />
				</div>
				<div>
					<Text size="xs" fw={600} c="dimmed" mb={4}>必询要点</Text>
					<Text size="xs" c="dimmed" opacity={0.6} mb={4}>学生必须覆盖的问诊条目</Text>
					<TagEditor value={requiredInquiries} onChange={onRequiredInquiriesChange} placeholder="输入后回车添加" disabled={disabled} />
				</div>
			</Stack>
		</Paper>
	);
}
