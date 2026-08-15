import { Box, Group, Text, UnstyledButton } from "@mantine/core";
import { IconChevronDown } from "@tabler/icons-react";
import type { ReactNode } from "react";

interface CollapsibleSectionProps {
	icon: ReactNode;
	title: string;
	expanded: boolean;
	onToggle: () => void;
	children: ReactNode;
}

export default function CollapsibleSection({
	icon,
	title,
	expanded,
	onToggle,
	children,
}: CollapsibleSectionProps) {
	return (
		<Box pt="xs" style={{ borderTop: "1px solid var(--mantine-color-gray-3)" }}>
			<UnstyledButton
				onClick={onToggle}
				w="100%"
				py="xs"
				px="xs"
				style={{ borderRadius: "var(--mantine-radius-sm)", transition: "background 120ms ease", marginLeft: -8, width: "calc(100% + 16px)" }}
				onMouseEnter={(e) => { e.currentTarget.style.background = "var(--mantine-color-gray-0)"; }}
				onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
			>
				<Group justify="space-between" wrap="nowrap">
					<Group gap="xs" wrap="nowrap">
						{icon}
						<Text component="h4" size="sm" fw={600}>
							{title}
						</Text>
					</Group>
					<IconChevronDown
						size={16}
						style={{
							transform: expanded ? "rotate(180deg)" : undefined,
							transition: "transform 200ms",
						}}
					/>
				</Group>
			</UnstyledButton>
			{expanded && children}
		</Box>
	);
}
