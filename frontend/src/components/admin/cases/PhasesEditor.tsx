import { IconChevronDown, IconChevronUp, IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import type { PhaseFormData } from "./caseFormTypes";
import { emptyPhase } from "./caseFormTypes";
import { Button, Checkbox, Group, NumberInput, Paper, Select, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";

interface Props {
	value: PhaseFormData[];
	onChange: (v: PhaseFormData[]) => void;
	disabled?: boolean;
}

export function PhasesEditor({ value, onChange, disabled }: Props) {
	const [expanded, setExpanded] = useState<Set<number>>(new Set());

	const toggle = (idx: number) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(idx)) next.delete(idx); else next.add(idx);
			return next;
		});
	};

	const add = () => {
		onChange([...value, emptyPhase(value.length)]);
	};

	const remove = (idx: number) => {
		onChange(value.filter((_, i) => i !== idx));
	};

	const update = (idx: number, fn: (p: PhaseFormData) => PhaseFormData) => {
		onChange(value.map((p, i) => (i === idx ? fn(p) : p)));
	};

	return (
		<Paper withBorder p="md" radius="md">
			<Text size="sm" fw={600} mb="xs">训练阶段</Text>
			<Text size="xs" c="dimmed" mb="md">定义多阶段训练流程。每阶段可配置过渡条件和操作集</Text>
			{value.length > 0 && (
				<Stack gap={8} mb="md">
					{value.map((p, i) => {
						const isOpen = expanded.has(i);
						return (
							<Paper key={p.id} withBorder radius="md">
								<Button
									variant="ghost"
									fullWidth
									justify="space-between"
									onClick={() => toggle(i)}
									rightSection={isOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
								>
									<Text size="xs" fw={500}>{p.name || `Phase ${i + 1}`}</Text>
								</Button>
								{isOpen && (
									<Stack gap={8} p="sm">
										<Group gap={8}>
											<TextInput value={p.id} onChange={(e) => update(i, (p) => ({ ...p, id: e.currentTarget.value }))} disabled={disabled} placeholder="ID" style={{ flex: 1 }} />
											<TextInput value={p.name} onChange={(e) => update(i, (p) => ({ ...p, name: e.currentTarget.value }))} disabled={disabled} placeholder="名称" style={{ flex: 2 }} />
											<NumberInput value={p.order} onChange={(v) => update(i, (p) => ({ ...p, order: Number(v) }))} disabled={disabled} w={80} />
										</Group>
										<div>
											<Text size="xs" c="dimmed" mb={4}>Prompt 配置</Text>
											<Select
												data={[{ value: "patient_chat", label: "patient_chat" }]}
												value={p.prompt_profile}
												onChange={(v) => update(i, (p) => ({ ...p, prompt_profile: v ?? "patient_chat" }))}
												disabled={disabled}
												size="xs"
											/>
										</div>
										<Stack gap={8} pt="xs" style={{ borderTop: "1px solid var(--mantine-color-gray-3)" }}>
											<Text size="xs" c="dimmed">过渡条件</Text>
											<SimpleGrid cols={2} spacing={8}>
												<Checkbox checked={p.transition.auto} onChange={(e) => update(i, (p) => ({ ...p, transition: { ...p.transition, auto: e.currentTarget.checked } }))} disabled={disabled} label="自动过渡" />
												<div>
													<Text size="xs" c="dimmed" mb={4}>最小消息数</Text>
													<NumberInput value={p.transition.min_messages} onChange={(v) => update(i, (p) => ({ ...p, transition: { ...p.transition, min_messages: Number(v) } }))} disabled={disabled} size="xs" />
												</div>
												<div>
													<Text size="xs" c="dimmed" mb={4}>最小操作数</Text>
													<NumberInput value={p.transition.min_operations} onChange={(v) => update(i, (p) => ({ ...p, transition: { ...p.transition, min_operations: Number(v) } }))} disabled={disabled} size="xs" />
												</div>
												<div>
													<Text size="xs" c="dimmed" mb={4}>消息后自动</Text>
													<NumberInput value={p.transition.auto_after_messages} onChange={(v) => update(i, (p) => ({ ...p, transition: { ...p.transition, auto_after_messages: Number(v) } }))} disabled={disabled} size="xs" />
												</div>
											</SimpleGrid>
										</Stack>
										<Button variant="link" color="red" size="xs" onClick={() => remove(i)} disabled={disabled} leftSection={<IconTrash size={12} />}>删除阶段</Button>
									</Stack>
								)}
							</Paper>
						);
					})}
				</Stack>
			)}
			{!disabled && (
				<Button variant="link" size="xs" onClick={add} leftSection={<IconPlus size={12} />}>添加阶段</Button>
			)}
		</Paper>
	);
}
