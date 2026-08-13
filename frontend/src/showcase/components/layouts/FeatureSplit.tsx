import { Box, Grid, Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import type { TablerIcon } from "@tabler/icons-react";
import type { ReactNode } from "react";
import Reveal from "../Reveal";

interface FeatureSplitProps {
	icon: TablerIcon;
	title: string;
	body: string;
	points: string[];
	reverse?: boolean;
	visual: ReactNode;
}

export default function FeatureSplit({
	icon: Icon,
	title,
	body,
	points,
	reverse,
	visual,
}: FeatureSplitProps) {
	return (
		<Grid align="center" gap="xl">
			<Grid.Col span={{ base: 12, md: 6 }} order={{ base: 1, md: reverse ? 2 : 1 }}>
				<Reveal>
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
						<Stack
							component="ul"
							gap={8}
							style={{ listStyle: "none", margin: 0, padding: 0 }}
						>
							{points.map((p) => (
								<Group component="li" key={p} gap={8} align="flex-start" wrap="nowrap">
									<Box
										style={{
											marginTop: 8,
											width: 6,
											height: 6,
											borderRadius: "50%",
											background: "var(--mantine-primary-color-6)",
											flexShrink: 0,
										}}
									/>
									<Text size="sm" c="dimmed">
										{p}
									</Text>
								</Group>
							))}
						</Stack>
					</Stack>
				</Reveal>
			</Grid.Col>
			<Grid.Col span={{ base: 12, md: 6 }} order={{ base: 2, md: reverse ? 1 : 2 }}>
				<Reveal delay={120}>{visual}</Reveal>
			</Grid.Col>
		</Grid>
	);
}
