import {
	ActionIcon,
	Button,
	Group,
	Paper,
	Modal,
	Select,
	Stack,
	Text,
	TextInput,
	Textarea,
} from "@mantine/core";
import {
	IconArrowLeft,
	IconDeviceFloppy,
	IconGripVertical,
	IconPlus,
	IconX,
} from "@tabler/icons-react";
import type { TemplateForm } from "@/components/admin/questionnaires/types";
import {
	emptyQuestion,
	QUESTION_TYPE_OPTIONS,
} from "@/components/admin/questionnaires/types";
import { Checkbox } from "@/components/ui/checkbox";

import { FormMessageBanner } from "@/components/ui/form-message-banner";
import { Switch } from "@/components/ui/switch";
import LoadingState from "@/components/ui/loading-state";

interface QuestionnaireEditorProps {
	open: boolean;
	editingId: number | null;
	form: TemplateForm;
	editMsg: string;
	isLoadingDetail: boolean;
	isSaving: boolean;
	onClose: () => void;
	onSave: (e: React.FormEvent) => void;
	setForm: React.Dispatch<React.SetStateAction<TemplateForm>>;
}

export default function QuestionnaireEditor({
	open,
	editingId,
	form,
	editMsg,
	isLoadingDetail,
	isSaving,
	onClose,
	onSave,
	setForm,
}: QuestionnaireEditorProps) {
	const addQuestion = () => {
		setForm((prev) => ({
			...prev,
			questions: [...prev.questions, emptyQuestion(prev.questions.length + 1)],
		}));
	};

	const removeQuestion = (index: number) => {
		setForm((prev) => ({
			...prev,
			questions: prev.questions
				.filter((_, i) => i !== index)
				.map((q, i) => ({ ...q, sort_order: i + 1 })),
		}));
	};

	const updateQuestion = (
		index: number,
		updates: Partial<(typeof form.questions)[number]>,
	) => {
		setForm((prev) => ({
			...prev,
			questions: prev.questions.map((q, i) =>
				i === index ? { ...q, ...updates } : q,
			),
		}));
	};

	const moveQuestion = (index: number, direction: "up" | "down") => {
		setForm((prev) => {
			const questions = [...prev.questions];
			const targetIndex = direction === "up" ? index - 1 : index + 1;
			if (targetIndex < 0 || targetIndex >= questions.length) return prev;
			const tmp = questions[index];
			questions[index] = questions[targetIndex];
			questions[targetIndex] = tmp;
			return {
				...prev,
				questions: questions.map((q, i) => ({ ...q, sort_order: i + 1 })),
			};
		});
	};

	return (
		<Modal
			opened={open}
			onClose={onClose}
			title={editingId ? "编辑问卷模板" : "新建问卷模板"}
			size={700}
			centered
			withinPortal
		>
			<FormMessageBanner type="error" message={editMsg} />
			{isLoadingDetail && editingId ? (
				<LoadingState message="加载模板数据..." />
			) : (
				<form onSubmit={onSave}>
					<Stack gap="md">
						<TextInput
							label="标题 *"
							value={form.title}
							onChange={(e) =>
								setForm((f) => ({ ...f, title: e.currentTarget.value }))
							}
							required
							placeholder="问卷标题"
						/>

						<Group align="flex-start" gap="md">
							<Select
								label="类型"
								data={[
									{ value: "pre", label: "前测 (pre)" },
									{ value: "post", label: "后测 (post)" },
								]}
								value={form.type}
								onChange={(v) =>
									setForm((f) => ({ ...f, type: v ?? "pre" }))
								}
								style={{ flex: 1 }}
							/>
							<Stack gap={4} style={{ flex: 1 }}>
								<Text size="xs" fw={600} c="dimmed">状态</Text>
								<Group gap={8}>
									<Switch
										checked={form.is_active}
										onCheckedChange={(checked) =>
											setForm((f) => ({ ...f, is_active: checked }))
										}
										aria-label="状态"
									/>
									<Text size="sm" c="dimmed">
										{form.is_active ? "启用" : "禁用"}
									</Text>
								</Group>
							</Stack>
						</Group>

						<Textarea
							label="描述"
							minRows={2}
							value={form.description}
							onChange={(e) =>
								setForm((f) => ({
									...f,
									description: e.currentTarget.value,
								}))
							}
							placeholder="问卷说明（可选）"
						/>

						<Paper withBorder p="md" radius="md">
							<Group justify="space-between" mb="sm">
								<Text size="sm" fw={600}>
									题目列表 ({form.questions.length})
								</Text>
								<Button
									type="button"
									size="sm"
									variant="outline"
									onClick={addQuestion}
								>
									<IconPlus size={14} /> 添加题目
								</Button>
							</Group>

							{form.questions.length === 0 ? (
								<Text ta="center" py="lg" size="sm" c="dimmed">
									暂无题目，点击上方按钮添加
								</Text>
							) : (
								<Stack gap="sm">
									{form.questions.map((q, i) => (
										<Paper
											key={i}
											withBorder
											p="sm"
											radius="md"
											bg="var(--mantine-color-gray-0)"
										>
											<Group justify="space-between" mb="xs">
												<Text size="xs" fw={600} c="dimmed">
													第 {i + 1} 题
												</Text>
												<Group gap={4}>
													<ActionIcon
														variant="subtle"
														size="sm"
														color="gray"
														onClick={() => moveQuestion(i, "up")}
														disabled={i === 0}
														title="上移"
													>
														<IconGripVertical size={14} />
													</ActionIcon>
													<ActionIcon
														variant="subtle"
														size="sm"
														color="gray"
														onClick={() => moveQuestion(i, "down")}
														disabled={i === form.questions.length - 1}
														title="下移"
													>
														<IconArrowLeft
															size={14}
															style={{ transform: "rotate(180deg)" }}
														/>
													</ActionIcon>
													<ActionIcon
														variant="subtle"
														size="sm"
														color="red"
														onClick={() => removeQuestion(i)}
														title="删除"
													>
														<IconX size={14} />
													</ActionIcon>
												</Group>
											</Group>

											<Group align="flex-start" gap="md" mb="xs" wrap="nowrap">
												<Textarea
													minRows={2}
													value={q.content}
													onChange={(e) =>
														updateQuestion(i, {
															content: e.currentTarget.value,
														})
													}
													placeholder="题目内容"
													style={{ flex: 1 }}
												/>
												<Select
													data={QUESTION_TYPE_OPTIONS}
													value={q.question_type}
													onChange={(v) => {
														const newType = v ?? "likert_5";
														updateQuestion(i, {
															question_type: newType,
															options:
																newType === "multiple_choice"
																	? q.options
																	: [],
														});
													}}
													style={{ width: 160 }}
												/>
											</Group>

											<Group gap="md">
												<Checkbox
													checked={q.required}
													onCheckedChange={(checked) =>
														updateQuestion(i, { required: checked })
													}
													label="必答"
												/>
											</Group>

											{q.question_type === "multiple_choice" && (
												<Stack gap={4} mt="sm">
													<Text size="xs" c="dimmed">选项（一行一个）</Text>
													<Textarea
														minRows={3}
														value={q.options.join("\n")}
														onChange={(e) =>
															updateQuestion(i, {
																options: e.currentTarget.value
																	.split("\n")
																	.filter((s) => s.trim()),
															})
														}
														placeholder={"选项A\n选项B\n选项C"}
													/>
												</Stack>
											)}
										</Paper>
									))}
								</Stack>
							)}
						</Paper>

						<Group justify="flex-end" gap="md">
							<Button type="button" variant="outline" onClick={onClose}>
								取消
							</Button>
							<Button onClick={onSave} disabled={isSaving}>
								{isSaving ? (
									<>保存中...</>
								) : (
									<>
										<IconDeviceFloppy size={14} /> {editingId ? "保存修改" : "创建问卷"}
									</>
								)}
							</Button>
						</Group>
					</Stack>
				</form>
			)}
		</Modal>
	);
}
