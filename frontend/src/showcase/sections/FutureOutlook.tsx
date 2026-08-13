import { Box, Group, Paper, SimpleGrid, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconDeviceDesktop, IconDeviceMobile } from "@tabler/icons-react";
import Reveal from "../components/Reveal";

export default function FutureOutlook() {
	return (
		<Box component="section" mx="auto" px="md" py={80} style={{ maxWidth: "64rem" }}>
			<Reveal>
				<Paper withBorder radius="xl" p="xl" pos="relative" style={{ overflow: "hidden" }}>
					<Stack align="center" gap="md" ta="center" pos="relative" style={{ zIndex: 10 }}>
						<Text
							size="xs"
							fw={600}
							tt="uppercase"
							c="dimmed"
							style={{ letterSpacing: "0.3em" }}
						>
							未来展望
						</Text>
						<Title order={2} fw={700}>
							随时随地，触手可及
						</Title>
						<Text size="sm" c="dimmed" style={{ maxWidth: "52ch" }}>
							即将推出微信小程序与手机 App 适配，将虚拟患者训练从桌面延伸到移动端，让学生在任何场景下都能随时随地进行护理沟通练习。
						</Text>

						<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg" mt="lg">
							<Group gap="md" px="lg" py="md" style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: "var(--mantine-radius-md)", background: "var(--mantine-color-body)" }}>
								<ThemeIcon size={40} radius="md" variant="light" color="green">
									<IconDeviceMobile size={20} strokeWidth={1.5} />
								</ThemeIcon>
								<Stack gap={2} ta="left">
									<Text size="sm" fw={700}>
										微信小程序
									</Text>
									<Text size="xs" c="dimmed">
										轻量接入，即开即用
									</Text>
								</Stack>
							</Group>
							<Group gap="md" px="lg" py="md" style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: "var(--mantine-radius-md)", background: "var(--mantine-color-body)" }}>
								<ThemeIcon size={40} radius="md" variant="light" color="indigo">
									<IconDeviceDesktop size={20} strokeWidth={1.5} />
								</ThemeIcon>
								<Stack gap={2} ta="left">
									<Text size="sm" fw={700}>
										手机 App
									</Text>
									<Text size="xs" c="dimmed">
										原生体验，深度集成
									</Text>
								</Stack>
							</Group>
						</SimpleGrid>
					</Stack>
				</Paper>
			</Reveal>
		</Box>
	);
}
