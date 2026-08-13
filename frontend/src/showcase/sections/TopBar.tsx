import { Box, Button, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconStethoscope } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { CTA_HREF, CTA_LABEL, PRODUCT_NAME } from "../data";

export default function TopBar() {
	return (
		<Box
			component="header"
			pos="sticky"
			top={0}
			style={{
				zIndex: 50,
				borderBottom: "1px solid var(--mantine-color-default-border)",
				backdropFilter: "blur(24px)",
				background: "color-mix(in srgb, var(--mantine-color-body) 60%, transparent)",
			}}
		>
			<Group
				h={64}
				mx="auto"
				px="md"
				justify="space-between"
				style={{ maxWidth: "80rem" }}
			>
				<Group gap={12}>
					<Box pos="relative">
						<ThemeIcon
							size={36}
							radius="md"
							variant="filled"
							style={{
								boxShadow:
									"0 10px 20px -10px var(--mantine-primary-color-filled)",
							}}
						>
							<IconStethoscope size={20} strokeWidth={1.5} />
						</ThemeIcon>
					</Box>
					<Stack gap={0}>
						<Text fw={700} lh={1.2} size="md">
							{PRODUCT_NAME}
						</Text>
						<Text
							size="10px"
							fw={500}
							tt="uppercase"
							c="dimmed"
							style={{ letterSpacing: "0.24em" }}
						>
							Training System
						</Text>
					</Stack>
				</Group>
				<Button
					component={Link}
					to={CTA_HREF}
					size="sm"
					radius="md"
					px="xl"
					fw={600}
				>
					{CTA_LABEL}
				</Button>
			</Group>
		</Box>
	);
}
