import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { ActionIcon, Group, Paper, Stack, Text, TextInput, Textarea } from "@mantine/core";

interface Props {
	value: Record<string, string>;
	onChange: (v: Record<string, string>) => void;
	disabled?: boolean;
}

export function BackgroundEditor({ value, onChange, disabled }: Props) {
	const entries = Object.entries(value);
	const [newKey, setNewKey] = useState("");
	const [newVal, setNewVal] = useState("");

	const add = () => {
		const k = newKey.trim();
		if (!k) return;
		onChange({ ...value, [k]: newVal });
		setNewKey("");
		setNewVal("");
	};

	const remove = (key: string) => {
		const next = { ...value };
		delete next[key];
		onChange(next);
	};

	const setVal = (key: string, val: string) => {
		onChange({ ...value, [key]: val });
	};

	return (
		<Paper withBorder p="md" radius="md">
			<Text size="sm" fw={600} mb="xs">隐藏背景</Text>
			<Text size="xs" c="dimmed" mb="md">LLM 内部上下文，患者不会主动透露的数据。如吸烟史、职业暴露等</Text>
			{entries.length > 0 && (
				<Stack gap={8} mb="md">
					{entries.map(([k, v]) => (
						<Group key={k} gap={8} align="flex-start">
							<TextInput value={k} disabled placeholder="key" style={{ flex: 1 }} />
							<Textarea value={v} onChange={(e) => setVal(k, e.currentTarget.value)} disabled={disabled} placeholder="value" autosize minRows={2} style={{ flex: 3 }} />
							<ActionIcon variant="subtle" color="gray" onClick={() => remove(k)} disabled={disabled} aria-label="删除背景项"><IconTrash size={14} /></ActionIcon>
						</Group>
					))}
				</Stack>
			)}
			{!disabled && (
				<Group gap={8}>
					<TextInput value={newKey} onChange={(e) => setNewKey(e.currentTarget.value)} placeholder="key" style={{ flex: 1 }} />
					<TextInput value={newVal} onChange={(e) => setNewVal(e.currentTarget.value)} placeholder="value" style={{ flex: 3 }} />
					<ActionIcon variant="light" color="teal" onClick={add} aria-label="添加背景项"><IconPlus size={14} /></ActionIcon>
				</Group>
			)}
		</Paper>
	);
}
