import { ActionIcon, Box, Group, Text, Title } from "@mantine/core";
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
					mb={4}
					onClick={() => navigate(backTo)}
					aria-label="返回"
				>
					<IconChevronLeft size={16} />
				</ActionIcon>
			)}
			<Group justify="space-between" align="flex-start" wrap="nowrap">
				<div style={{ minWidth: 0 }}>
					<Title order={1} size="lg" fw={700} style={{ display: "flex", alignItems: "center", gap: 8 }}>
						{Icon && <Icon size={22} />}
						{title}
					</Title>
					{subtitle && (
						<Text size="sm" c="dimmed" mt={4} visibleFrom="sm">
							{subtitle}
						</Text>
					)}
				</div>
				{actions && <Group gap="xs">{actions}</Group>}
			</Group>
		</Box>
	);
}
