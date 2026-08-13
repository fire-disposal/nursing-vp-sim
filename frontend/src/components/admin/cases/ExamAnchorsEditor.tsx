import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { ActionIcon, Group, Paper, Stack, Text, TextInput } from "@mantine/core";

interface Props {
	value: Record<string, string>;
	onChange: (v: Record<string, string>) => void;
	disabled?: boolean;
}

export function ExamAnchorsEditor({ value, onChange, disabled }: Props) {
	const entries = Object.entries(value);
	const [newKey, setNewKey] = useState("");
	const [newVal, setNewVal] = useState("");

	const add = () => {
		const k = newKey.trim();
		if (!k) return;
		onChange({ ...value, [k]: newVal.trim() });
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
			<Text size="sm" fw={600} mb="xs">查体锚点</Text>
			<Text size="xs" c="dimmed" mb="md">定义各检查项的正常范围值。支持范围格式如 "36.8-37.2"</Text>
			{entries.length > 0 && (
				<Stack gap={8} mb="md">
					{entries.map(([k, v]) => (
						<Group key={k} gap={8}>
							<TextInput value={k} disabled placeholder="key" style={{ flex: 1 }} />
							<TextInput value={v} onChange={(e) => setVal(k, e.currentTarget.value)} disabled={disabled} placeholder="value" style={{ flex: 2 }} />
							<ActionIcon variant="subtle" color="gray" onClick={() => remove(k)} disabled={disabled} aria-label="删除查体锚点"><IconTrash size={14} /></ActionIcon>
						</Group>
					))}
				</Stack>
			)}
			{!disabled && (
				<Group gap={8}>
					<TextInput value={newKey} onChange={(e) => setNewKey(e.currentTarget.value)} placeholder="新 key" style={{ flex: 1 }} />
					<TextInput value={newVal} onChange={(e) => setNewVal(e.currentTarget.value)} placeholder="value" style={{ flex: 2 }} />
					<ActionIcon variant="light" color="blue" onClick={add} aria-label="添加查体锚点"><IconPlus size={14} /></ActionIcon>
				</Group>
			)}
		</Paper>
	);
}
