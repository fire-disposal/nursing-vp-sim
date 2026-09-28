/**
 * 表单原语：列表编辑器（增删排序）、带定位的分节卡片、以及"这一节有校验问题"的提示。
 *
 * 与 `PackForm` 分开只为让"每个列表都能增删排序"这句话只实现一次：八节里的
 * 线索、在场者、动作、事实、判据、维度、锚点、设备共用同一套上下移/删除/添加。
 */

import {
	ActionIcon,
	Alert,
	Badge,
	Button,
	Code,
	Group,
	Paper,
	Stack,
	Text,
} from "@mantine/core";
import { IconAlertTriangle, IconArrowDown, IconArrowUp, IconPlus, IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { ScenarioPackProblem } from "@/api/scenario";
import { moveIn, removeAt } from "./packDoc";

/** 一个可增删排序的列表：每一项由调用方渲染，工具条在这一层统一。 */
export function ListEditor<T>({
	items,
	onChange,
	render,
	create,
	addLabel,
	emptyText,
}: {
	items: T[];
	onChange: (next: T[]) => void;
	render: (item: T, index: number) => ReactNode;
	/** 新项的初值（作者点了「添加」之后能直接改，不弹对话框）。 */
	create: () => T;
	addLabel: string;
	emptyText: string;
}) {
	return (
		<Stack gap="sm">
			{items.length === 0 && (
				<Text size="xs" c="dimmed">
					{emptyText}
				</Text>
			)}
			{items.map((item, index) => (
				<Paper key={index} withBorder p="xs">
					<Group gap="xs" align="flex-start" wrap="nowrap">
						<Stack gap="xs" style={{ flex: 1 }}>
							{render(item, index)}
						</Stack>
						<Stack gap={4}>
							<ActionIcon
								variant="subtle"
								size="sm"
								aria-label="上移"
								disabled={index === 0}
								onClick={() => onChange(moveIn(items, index, index - 1))}
							>
								<IconArrowUp size={14} />
							</ActionIcon>
							<ActionIcon
								variant="subtle"
								size="sm"
								aria-label="下移"
								disabled={index === items.length - 1}
								onClick={() => onChange(moveIn(items, index, index + 1))}
							>
								<IconArrowDown size={14} />
							</ActionIcon>
							<ActionIcon
								variant="subtle"
								color="red"
								size="sm"
								aria-label="删除"
								onClick={() => onChange(removeAt(items, index))}
							>
								<IconX size={14} />
							</ActionIcon>
						</Stack>
					</Group>
				</Paper>
			))}
			<Group>
				<Button
					variant="light"
					size="compact-sm"
					leftSection={<IconPlus size={14} />}
					onClick={() => onChange([...items, create()])}
				>
					{addLabel}
				</Button>
			</Group>
		</Stack>
	);
}

/** 一节的标题 + 该节自己的校验问题（问题来自后端，不在这里重算）。 */
export function Section({
	id,
	title,
	hint,
	issues,
	children,
}: {
	id: string;
	title: string;
	hint?: string;
	issues: ScenarioPackProblem[];
	children: ReactNode;
}) {
	return (
		<Paper withBorder p="md" id={`pack-section-${id}`}>
			<Group gap="xs" mb={4} wrap="wrap">
				<Text fw={600}>{title}</Text>
				{issues.length > 0 && (
					<Badge color="red" variant="light">
						{issues.length} 处问题
					</Badge>
				)}
			</Group>
			{hint !== undefined && (
				<Text size="xs" c="dimmed" mb="sm">
					{hint}
				</Text>
			)}
			{issues.length > 0 && (
				<Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} mb="sm">
					<Stack gap={2}>
						{issues.map((issue) => (
							<Text size="xs" key={`${issue.path}:${issue.message}`}>
								{issue.path !== "" && <Code>{issue.path}</Code>} {issue.message}
							</Text>
						))}
					</Stack>
				</Alert>
			)}
			{children}
		</Paper>
	);
}
