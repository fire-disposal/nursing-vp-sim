import { ActionIcon, Box, Button, Group, Select, Stack, Text } from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useMemo } from "react";
import type { ClassItem, MemberRole } from "@/types/store";
import type { MembershipDraft } from "./types";

const MEMBER_ROLE_OPTIONS = [
	{ value: "student", label: "学生" },
	{ value: "teacher", label: "教师" },
];

interface MembershipEditorProps {
	value: MembershipDraft[];
	onChange: (value: MembershipDraft[]) => void;
	classes: ClassItem[];
	disabled?: boolean;
	/** 校验错误（来自父级，例如班级重复）。 */
	error?: string;
}

/**
 * 用户班级归属编辑器：一个用户可同时属于多个班级，并可在不同班级承担不同角色。
 * 提交时以「全量替换」语义发送（后端 `memberships` 键）。
 */
export default function MembershipEditor({
	value,
	onChange,
	classes,
	disabled,
	error,
}: MembershipEditorProps) {
	// 已被**其他行**占用的班级在本行禁用，避免同一班级重复提交（后端会拒绝重复）。
	const options = useMemo(
		() =>
			value.map((_row, index) => {
				const usedElsewhere = new Set(
					value
						.filter((_, i) => i !== index)
						.map((v) => v.class_id)
						.filter(Boolean),
				);
				return classes.map((c) => ({
					value: String(c.id),
					label: c.cohort_label ? `${c.cohort_label} ${c.name}` : c.name,
					group: c.cohort_label || "未标注届别",
					disabled: usedElsewhere.has(String(c.id)),
				}));
			}),
		[classes, value],
	);

	const patch = (index: number, next: Partial<MembershipDraft>) => {
		onChange(value.map((row, i) => (i === index ? { ...row, ...next } : row)));
	};

	return (
		<Stack gap={6}>
			<Text size="xs" c="dimmed" fw={600}>
				班级归属
			</Text>
			{value.length === 0 && (
				<Text size="xs" c="dimmed">
					尚未加入任何班级
				</Text>
			)}
			{value.map((row, index) => (
				<Group key={index} gap={8} wrap="nowrap" align="flex-end">
					<Select
						label={index === 0 ? "班级" : undefined}
						placeholder="选择班级…"
						aria-label={`第 ${index + 1} 个班级`}
						value={row.class_id || null}
						onChange={(v) => patch(index, { class_id: v ?? "" })}
						data={options[index]?.length ? options[index] : [{ value: "", label: "暂无班级" }]}
						disabled={disabled}
						searchable
						style={{ flex: 1 }}
					/>
					<Select
						label={index === 0 ? "角色" : undefined}
						aria-label={`第 ${index + 1} 个班级的角色`}
						value={row.member_role}
						onChange={(v) =>
							patch(index, { member_role: (v as MemberRole) ?? "student" })
						}
						data={MEMBER_ROLE_OPTIONS}
						allowDeselect={false}
						disabled={disabled}
						w={110}
					/>
					<ActionIcon
						variant="subtle"
						color="red"
						size="lg"
						disabled={disabled}
						onClick={() => onChange(value.filter((_, i) => i !== index))}
						title="移除该班级归属"
						aria-label={`移除第 ${index + 1} 个班级归属`}
					>
						<IconTrash size={16} />
					</ActionIcon>
				</Group>
			))}
			{error && (
				<Text size="xs" c="red">
					{error}
				</Text>
			)}
			<Box>
				<Button
					type="button"
					variant="light"
					size="xs"
					leftSection={<IconPlus size={14} />}
					disabled={disabled || classes.length === 0}
					onClick={() =>
						onChange([...value, { class_id: "", member_role: "student" }])
					}
				>
					添加班级
				</Button>
			</Box>
		</Stack>
	);
}
