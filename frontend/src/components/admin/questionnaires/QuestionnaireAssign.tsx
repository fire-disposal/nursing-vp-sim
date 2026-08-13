import { Box, Group, Modal, Paper, ScrollArea, Select, Stack, Text } from "@mantine/core";
import type {
	AssignForm as AssignFormType,
	CaseBrief,
} from "@/components/admin/questionnaires/types";
import {
	TRIGGER_EVENT_OPTIONS,
} from "@/components/admin/questionnaires/types";
import Button from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

import { Switch } from "@/components/ui/switch";

interface QuestionnaireAssignProps {
	open: boolean;
	templateTitle: string;
	allCases: CaseBrief[];
	assignForm: AssignFormType;
	isSaving: boolean;
	onClose: () => void;
	onSubmit: (e: React.FormEvent) => void;
	onAssignFormChange: React.Dispatch<React.SetStateAction<AssignFormType>>;
}

export default function QuestionnaireAssign({
	open,
	templateTitle,
	allCases,
	assignForm,
	isSaving,
	onClose,
	onSubmit,
	onAssignFormChange,
}: QuestionnaireAssignProps) {
	const toggleCaseId = (caseId: number) => {
		onAssignFormChange((prev) => ({
			...prev,
			case_ids: prev.case_ids.includes(caseId)
				? prev.case_ids.filter((id) => id !== caseId)
				: [...prev.case_ids, caseId],
		}));
	};

	const selectAllCases = () => {
		onAssignFormChange((prev) => ({
			...prev,
			case_ids: allCases.map((c) => c.id),
		}));
	};

	const deselectAllCases = () => {
		onAssignFormChange((prev) => ({
			...prev,
			case_ids: [],
		}));
	};

	return (
		<Modal
			opened={open}
			onClose={onClose}
			title={`分配病例: ${templateTitle}`}
			size={600}
			centered
			withinPortal
		>
			<form onSubmit={onSubmit}>
				<Stack gap="md">
					<div>
						<Group justify="space-between" mb="xs">
							<Text size="xs" fw={600} c="dimmed">选择病例</Text>
							<Group gap={8}>
								<Button
									type="button"
									variant="link"
									size="xs"
									onClick={selectAllCases}
								>
									全选
								</Button>
								<Button
									type="button"
									variant="link"
									size="xs"
									onClick={deselectAllCases}
								>
									取消全选
								</Button>
							</Group>
						</Group>
						<Paper withBorder p="sm" radius="md">
							<ScrollArea h={300}>
								<Stack gap="xs">
									{allCases.length === 0 ? (
										<Text size="sm" c="dimmed" ta="center" py="lg">
											暂无病例数据
										</Text>
									) : (
										allCases.map((c) => (
											<Checkbox
												key={c.id}
												checked={assignForm.case_ids.includes(c.id)}
												onCheckedChange={() => toggleCaseId(c.id)}
												label={
													<Group gap={8} wrap="nowrap" align="center">
														<Text size="sm" fw={500}>{c.name}</Text>
														{c.chief_complaint && (
															<Text
																size="xs"
																c="dimmed"
																truncate
																style={{ maxWidth: 200 }}
															>
																— {c.chief_complaint}
															</Text>
														)}
													</Group>
												}
											/>
										))
									)}
								</Stack>
							</ScrollArea>
						</Paper>
						<Text size="xs" c="dimmed" mt={4}>
							已选 {assignForm.case_ids.length} 个病例
						</Text>
					</div>

					<Group align="flex-start" gap="md">
						<Select
							label="触发时机"
							data={TRIGGER_EVENT_OPTIONS}
							value={assignForm.trigger_event}
							onChange={(v) =>
								onAssignFormChange((f) => ({
									...f,
									trigger_event: v ?? "",
								}))
							}
							style={{ flex: 1 }}
						/>
						<Box style={{ flex: 1 }}>
							<Text size="xs" fw={600} c="dimmed" mb={4}>是否必填</Text>
							<Group gap={8}>
								<Switch
									checked={assignForm.is_required}
									onCheckedChange={(checked) =>
										onAssignFormChange((f) => ({
											...f,
											is_required: checked,
										}))
									}
									aria-label="是否必填"
								/>
								<Text size="sm" c="dimmed">
									{assignForm.is_required ? "必填" : "选填"}
								</Text>
							</Group>
						</Box>
					</Group>

					<Group justify="flex-end" gap="md">
						<Button type="button" variant="outline" onClick={onClose}>
							取消
						</Button>
						<Button onClick={onSubmit} disabled={isSaving}>
							{isSaving ? "保存中..." : "保存分配"}
						</Button>
					</Group>
				</Stack>
			</form>
		</Modal>
	);
}
