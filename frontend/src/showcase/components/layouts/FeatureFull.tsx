import { Group, Paper, SimpleGrid, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import type { TablerIcon } from "@tabler/icons-react";
import type { ReactNode } from "react";
import Reveal from "../Reveal";

interface FeatureFullProps {
	icon: TablerIcon;
	title: string;
	body: string;
	points: string[];
	visual?: ReactNode;
}

export default function FeatureFull({
	icon: Icon,
	title,
	body,
	points,
	visual,
}: FeatureFullProps) {
	return (
		<Reveal>
			<Stack gap="lg">
				<Stack gap="md">
					<Group gap="md">
						<ThemeIcon size={44} radius="lg" variant="light">
							<Icon size={22} strokeWidth={1.5} />
						</ThemeIcon>
						<Title order={3} fw={700} size="1.65rem">
							{title}
						</Title>
					</Group>
					<Text c="dimmed" style={{ maxWidth: "65ch" }}>
						{body}
					</Text>
				</Stack>
				<SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
					{points.map((p) => (
						<Paper key={p} withBorder radius="lg" p="md">
							<Text size="sm" c="dimmed">
								{p}
							</Text>
						</Paper>
					))}
				</SimpleGrid>
				{visual}
			</Stack>
		</Reveal>
	);
}
