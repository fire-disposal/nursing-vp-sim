import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { DialogPair } from "./caseFormTypes";
import { emptyDialogPair } from "./caseFormTypes";
import { ActionIcon, Button, Group, Paper, Stack, Text, Textarea } from "@mantine/core";

interface Props {
	value: DialogPair[];
	onChange: (v: DialogPair[]) => void;
	disabled?: boolean;
}

export function DialoguesEditor({ value, onChange, disabled }: Props) {
	const add = () => onChange([...value, emptyDialogPair()]);

	const remove = (idx: number) => {
		const next = value.filter((_, i) => i !== idx);
		onChange(next);
	};

	const update = (idx: number, field: keyof DialogPair, val: string) => {
		const next = value.map((d, i) => (i === idx ? { ...d, [field]: val } : d));
		onChange(next);
	};

	return (
		<Paper withBorder p="md" radius="md">
			<Text size="sm" fw={600} mb="xs">示例对话</Text>
			<Text size="xs" c="dimmed" mb="md">供 LLM 参考的 QA 对，帮助模型理解患者回答风格</Text>
			{value.length > 0 && (
				<Stack gap="sm" mb="md">
					{value.map((d, i) => (
						<Paper key={i} withBorder p="sm" radius="md">
							<Group gap="sm" align="flex-start">
								<Stack gap={8} style={{ flex: 1 }}>
									<div>
										<Text size="xs" c="dimmed" mb={4}>护士问</Text>
										<Textarea value={d.question} onChange={(e) => update(i, "question", e.currentTarget.value)} autosize minRows={2} disabled={disabled} />
									</div>
									<div>
										<Text size="xs" c="dimmed" mb={4}>患者答</Text>
										<Textarea value={d.answer} onChange={(e) => update(i, "answer", e.currentTarget.value)} autosize minRows={2} disabled={disabled} />
									</div>
								</Stack>
								<ActionIcon variant="subtle" color="gray" onClick={() => remove(i)} disabled={disabled} aria-label="删除对话"><IconTrash size={14} /></ActionIcon>
							</Group>
						</Paper>
					))}
				</Stack>
			)}
			{!disabled && (
				<Button variant="link" size="xs" onClick={add} leftSection={<IconPlus size={12} />}>添加对话</Button>
			)}
		</Paper>
	);
}
