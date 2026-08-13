import { Badge, Box, Group, Paper, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { TTS_DEMO_ITEMS } from "../data";

export default function VoicePlayback() {
	const [playingId, setPlayingId] = useState<string | null>(null);
	const audioRef = useRef<HTMLAudioElement | null>(null);

	const handlePlay = (id: string, fileName: string) => {
		if (audioRef.current) {
			audioRef.current.pause();
			audioRef.current = null;
		}

		if (playingId === id) {
			setPlayingId(null);
			return;
		}

		const audio = new Audio(`/audio/${fileName}`);
		audioRef.current = audio;
		setPlayingId(id);

		audio.onended = () => {
			setPlayingId(null);
			audioRef.current = null;
		};

		audio.onerror = () => {
			setPlayingId(null);
			audioRef.current = null;
		};

		audio.play().catch(() => {
			setPlayingId(null);
			audioRef.current = null;
		});
	};

	return (
		<Paper
			withBorder
			radius="xl"
			p="lg"
			pos="relative"
			style={{ minHeight: 460, display: "flex", flexDirection: "column", overflow: "hidden" }}
		>
			<Group justify="space-between" gap="md" pos="relative" style={{ zIndex: 10 }}>
				<Stack gap={4}>
					<Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.3em" }}>
						语音合成演示
					</Text>
					<Text size="lg" fw={700}>
						豆包 TTS · 情绪联动音色
					</Text>
				</Stack>
				<Badge variant="default" radius="xl">
					SeedTTS 2.0
				</Badge>
			</Group>

			<Stack gap={12} mt="lg" pos="relative" style={{ zIndex: 10 }}>
				{TTS_DEMO_ITEMS.map((item) => {
					const isPlaying = playingId === item.id;
					return (
						<Paper
							key={item.id}
							component="button"
							onClick={() => handlePlay(item.id, item.fileName)}
							p="md"
							radius="lg"
							style={{
								display: "flex",
								width: "100%",
								alignItems: "center",
								gap: 16,
								textAlign: "left",
								cursor: "pointer",
								transition: "all 300ms",
								border: isPlaying
									? "1px solid var(--mantine-primary-color-4)"
									: "1px solid var(--mantine-color-default-border)",
								background: isPlaying
									? "var(--mantine-color-body)"
									: "var(--mantine-color-gray-0)",
								boxShadow: isPlaying ? "var(--mantine-shadow-md)" : undefined,
							}}
						>
							<ThemeIcon size={40} radius="md" variant="light" style={{ flexShrink: 0 }}>
								{isPlaying ? (
									<IconPlayerPause size={18} strokeWidth={2} />
								) : (
									<IconPlayerPlay size={18} strokeWidth={2} />
								)}
							</ThemeIcon>

							<Box style={{ minWidth: 0, flex: 1 }}>
								<Group gap={8}>
									<Box
										style={{
											width: 6,
											height: 6,
											borderRadius: "50%",
											background: `var(--mantine-color-${item.emotionColor}-6)`,
										}}
									/>
									<Text size="xs" fw={600} c="dimmed">
										{item.label}
									</Text>
								</Group>
								<Text
									size="sm"
									mt={4}
									lh={1.6}
									c={isPlaying ? "var(--mantine-primary-color-6)" : "dimmed"}
								>
									"{item.patientText}"
								</Text>
							</Box>

							{isPlaying && (
								<Group gap={4} style={{ flexShrink: 0 }}>
									{[0, 1, 2].map((i) => (
										<Box
											key={i}
											w={2}
											style={{
												height: `${10 + i * 6}px`,
												borderRadius: "9999px",
												background: "var(--mantine-primary-color-6)",
												animation: "audio-wave 0.6s ease-in-out infinite",
												animationDelay: `${i * 0.15}s`,
											}}
										/>
									))}
								</Group>
							)}
						</Paper>
					);
				})}
			</Stack>

			<Group
				justify="space-between"
				gap={12}
				px="md"
				py={10}
				mt="md"
				pos="relative"
				style={{
					zIndex: 10,
					border: "1px solid var(--mantine-color-default-border)",
					borderRadius: "var(--mantine-radius-md)",
					background: "var(--mantine-color-gray-0)",
				}}
			>
				<Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.3em" }}>
					提供方
				</Text>
				<Badge variant="light" radius="xl">
					火山引擎
				</Badge>
			</Group>
		</Paper>
	);
}
