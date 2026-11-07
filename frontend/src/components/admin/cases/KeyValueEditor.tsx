import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { ActionIcon, Group, Paper, Stack, Text, Textarea, TextInput } from "@mantine/core";

interface Props {
	/** 区块标题（如「隐藏背景」「查体锚点」） */
	title: string;
	/** 标题下的一行说明 */
	description: string;
	/** 动作的无障碍名称（生成「添加X」「删除X」） */
	actionLabel: string;
	value: Record<string, string>;
	onChange: (v: Record<string, string>) => void;
	disabled?: boolean;
	/** 值是否多行（隐藏背景是长文本，查体锚点是单行范围） */
	multiline?: boolean;
}

/**
 * 字符串字典编辑器：病例「隐藏背景」与「查体锚点」共用这一份实现
 * （此前是两个 58 行、逐行几乎相同的组件）。
 */
export function KeyValueEditor({ title, description, actionLabel, value, onChange, disabled, multiline }: Props) {
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
		<Paper withBorder p="md">
			<Text size="sm" fw={600} mb="xs">{title}</Text>
			<Text size="xs" c="dimmed" mb="md">{description}</Text>
			{entries.length > 0 && (
				<Stack gap={8} mb="md">
					{entries.map(([k, v]) => (
						<Group key={k} gap={8} align="flex-start">
							<TextInput value={k} disabled placeholder="key" style={{ flex: 1 }} />
							{multiline ? (
								<Textarea
									value={v}
									onChange={(e) => setVal(k, e.currentTarget.value)}
									disabled={disabled}
									placeholder="value"
									autosize
									minRows={2}
									style={{ flex: 2 }}
								/>
							) : (
								<TextInput
									value={v}
									onChange={(e) => setVal(k, e.currentTarget.value)}
									disabled={disabled}
									placeholder="value"
									style={{ flex: 2 }}
								/>
							)}
							<ActionIcon variant="subtle" color="gray" onClick={() => remove(k)} disabled={disabled} aria-label={`删除${actionLabel}`}>
								<IconTrash size={14} />
							</ActionIcon>
						</Group>
					))}
				</Stack>
			)}
			{!disabled && (
				<Group gap={8}>
					<TextInput value={newKey} onChange={(e) => setNewKey(e.currentTarget.value)} placeholder="key" style={{ flex: 1 }} />
					<TextInput value={newVal} onChange={(e) => setNewVal(e.currentTarget.value)} placeholder="value" style={{ flex: 2 }} />
					<ActionIcon variant="light" color="blue" onClick={add} aria-label={`添加${actionLabel}`}>
						<IconPlus size={14} />
					</ActionIcon>
				</Group>
			)}
		</Paper>
	);
}
