import { IconChevronDown, IconChevronUp, IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import type { QuizFormData, QuizQuestion } from "./caseFormTypes";
import { emptyQuizOption, emptyQuizQuestion } from "./caseFormTypes";
import { ActionIcon, Button, Group, Paper, Select, Stack, Text, TextInput, Textarea } from "@mantine/core";

interface Props {
	value: QuizFormData;
	onChange: (v: QuizFormData) => void;
	disabled?: boolean;
}

export function QuizEditor({ value, onChange, disabled }: Props) {
	const questions = Array.isArray(value.questions) ? value.questions : [];
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	const toggle = (id: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id); else next.add(id);
			return next;
		});
	};

	const setTitle = (t: string) => onChange({ ...value, title: t, questions });

	const updateQuestion = (idx: number, fn: (q: QuizQuestion) => QuizQuestion) => {
		const next = questions.map((q, i) => (i === idx ? fn(q) : q));
		onChange({ ...value, questions: next });
	};

	const addQuestion = () => {
		onChange({ ...value, questions: [...questions, emptyQuizQuestion()] });
	};

	const removeQuestion = (idx: number) => {
		onChange({ ...value, questions: questions.filter((_, i) => i !== idx) });
	};

	const addOption = (qIdx: number) => {
		updateQuestion(qIdx, (q) => ({ ...q, options: [...q.options, emptyQuizOption()] }));
	};

	const removeOption = (qIdx: number, oIdx: number) => {
		updateQuestion(qIdx, (q) => ({ ...q, options: q.options.filter((_, i) => i !== oIdx) }));
	};

	return (
		<Paper withBorder p="md" radius="md">
			<Text size="sm" fw={600} mb="xs">引导题目</Text>
			<Text size="xs" c="dimmed" mb="md">训练中穿插的选择题，帮助学生聚焦关键知识点。不参与评分</Text>
			<div style={{ marginBottom: 12 }}>
				<Text size="xs" fw={600} c="dimmed" mb={4}>标题</Text>
				<TextInput value={value.title} onChange={(e) => setTitle(e.currentTarget.value)} placeholder="如：课前自测" disabled={disabled} />
			</div>

			{questions.length > 0 && (
				<Stack gap={8} mb="md">
					{questions.map((q, qi) => {
						const isOpen = expanded.has(q.id);
						return (
							<Paper key={q.id} withBorder radius="md">
								<Button
									variant="ghost"
									fullWidth
									justify="space-between"
									onClick={() => toggle(q.id)}
									rightSection={isOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
								>
									<Group gap={8} wrap="nowrap">
										<Text size="xs" fw={500} truncate style={{ maxWidth: 320 }}>
											Q{qi + 1}{q.stem ? ` — ${q.stem.slice(0, 40)}${q.stem.length > 40 ? "…" : ""}` : " (待编辑)"}
										</Text>
										<Text size="xs" c="dimmed">{q.options.length} 选项 · 答案 {q.answer || "?"}</Text>
									</Group>
								</Button>
								{isOpen && (
									<Stack gap={8} p="sm">
										<Textarea value={q.stem} onChange={(e) => updateQuestion(qi, (q) => ({ ...q, stem: e.currentTarget.value }))} placeholder="题目标题" autosize minRows={2} disabled={disabled} />
										<Stack gap={4}>
											{q.options.map((opt, oi) => (
												<Group key={oi} gap={8}>
													<TextInput value={opt.key} onChange={(e) => updateQuestion(qi, (q) => ({ ...q, options: q.options.map((o, j) => (j === oi ? { ...o, key: e.currentTarget.value } : o)) }))} disabled={disabled} placeholder="A" w={64} />
													<TextInput value={opt.text} onChange={(e) => updateQuestion(qi, (q) => ({ ...q, options: q.options.map((o, j) => (j === oi ? { ...o, text: e.currentTarget.value } : o)) }))} disabled={disabled} placeholder="选项文本" style={{ flex: 1 }} />
													<ActionIcon variant="subtle" color="gray" onClick={() => removeOption(qi, oi)} disabled={disabled} aria-label="删除选项"><IconTrash size={12} /></ActionIcon>
												</Group>
											))}
											{!disabled && <Button variant="link" size="xs" onClick={() => addOption(qi)} leftSection={<IconPlus size={10} />}>添加选项</Button>}
										</Stack>
										<Group gap="sm" align="flex-end">
											<div style={{ flex: 1 }}>
												<Text size="xs" c="dimmed" mb={4}>正确答案</Text>
												<Select
													data={q.options.map((o) => ({ value: o.key, label: o.key + (o.text ? ` — ${o.text}` : "") }))}
													value={q.answer}
													onChange={(v) => updateQuestion(qi, (q) => ({ ...q, answer: v ?? "" }))}
													placeholder="--"
													disabled={disabled}
													size="xs"
												/>
											</div>
											<ActionIcon variant="subtle" color="gray" onClick={() => removeQuestion(qi)} disabled={disabled} aria-label="删除题目"><IconTrash size={14} /></ActionIcon>
										</Group>
										<Textarea value={q.explanation} onChange={(e) => updateQuestion(qi, (q) => ({ ...q, explanation: e.currentTarget.value }))} placeholder="答案解析（选填）" autosize minRows={2} disabled={disabled} />
									</Stack>
								)}
							</Paper>
						);
					})}
				</Stack>
			)}
			{!disabled && (
				<Button variant="link" size="xs" onClick={addQuestion} leftSection={<IconPlus size={12} />}>添加题目</Button>
			)}
		</Paper>
	);
}
