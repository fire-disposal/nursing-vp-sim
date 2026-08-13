import { Box, Button, Stack, Text, Title } from "@mantine/core";
import { Link } from "react-router-dom";
import { CTA_HREF, CTA_LABEL, PRODUCT_NAME } from "../data";

export default function FinalCta() {
	return (
		<>
			<Box component="section" px="md" py={80} ta="center">
				<Stack align="center" gap="md" mx="auto" style={{ maxWidth: "42rem" }}>
					<Title order={2} fw={700}>
						开始一次虚拟患者训练
					</Title>
					<Button component={Link} to={CTA_HREF} size="lg">
						{CTA_LABEL}
					</Button>
				</Stack>
			</Box>
			<Box
				component="footer"
				py="lg"
				ta="center"
				style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
			>
				<Text size="sm" c="dimmed">
					{PRODUCT_NAME} · 2026
				</Text>
			</Box>
		</>
	);
}
