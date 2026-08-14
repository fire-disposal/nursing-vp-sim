import { ActionIcon, Box, Group, Text, ThemeIcon, Title } from "@mantine/core";
import { IconChevronLeft } from "@tabler/icons-react";
import type { ComponentType, ReactNode } from "react";
import { useNavigate } from "react-router-dom";

type IconType = ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

interface PageHeaderProps {
	title: string;
	subtitle?: string;
	icon?: IconType;
	actions?: ReactNode;
	backTo?: string;
	className?: string;
}

/**
 * PageHeader — 页面标题区：图标瓷片 + 标题 + 副标题 + 动作区。
 */
export default function PageHeader({
	title,
	subtitle,
	icon: Icon,
	actions,
	backTo,
	className,
}: PageHeaderProps) {
	const navigate = useNavigate();

	return (
		<Box mb="lg" className={className}>
			{backTo && (
				<ActionIcon
					variant="subtle"
					color="gray"
					size="sm"
					mb={6}
					onClick={() => navigate(backTo)}
					aria-label="返回"
				>
					<IconChevronLeft size={16} />
				</ActionIcon>
			)}
			<Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
				<Group gap={10} align="center" wrap="nowrap" style={{ minWidth: 0 }}>
					{Icon && (
						<ThemeIcon size={36} radius="md" variant="light" color="brand">
							<Icon size={18} strokeWidth={1.8} />
						</ThemeIcon>
					)}
					<div style={{ minWidth: 0 }}>
						<Title order={1} size="xl" fw={700} lh={1.3}>
							{title}
						</Title>
						{subtitle && (
							<Text size="sm" c="dimmed" mt={2} visibleFrom="sm">
								{subtitle}
							</Text>
						)}
					</div>
				</Group>
				{actions && (
					<Group gap="xs" wrap="wrap">
						{actions}
					</Group>
				)}
			</Group>
		</Box>
	);
}
