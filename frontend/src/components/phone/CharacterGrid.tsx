import { ActionIcon, Badge, Box, Button, Card, Group, SimpleGrid, Stack, Text, Title, Tooltip } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconPhoneCall } from "@tabler/icons-react";
import { characterFacts, type PhoneCharacter } from "@/engine/phone/characters";
import { PHONE_CHARACTERS } from "@/engine/phone/characters";
import { dominantLabel } from "@/engine/phone/emotion";
import { PHONE_EMOTION_LABELS } from "@/engine/phone/types";
import PhoneMiiAvatar from "./PhoneMiiAvatar";

/**
 * CharacterGrid —— 选角台：四张**人物**卡，不是四份病例。
 *
 * 卡片上刻意只有"人"的信息（名字、脾气、音色、打这通电话想聊什么），
 * 没有主诉、没有难度、没有可以被打分的东西——这是演示电话，不是训练。
 */
export interface CharacterGridProps {
	onPick: (character: PhoneCharacter) => void;
	reducedMotion?: boolean;
}

export default function CharacterGrid({ onPick, reducedMotion = false }: CharacterGridProps) {
	const narrow = useMediaQuery("(max-width: 30em)") === true;
	return (
		<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" data-testid="character-grid">
			{PHONE_CHARACTERS.map((character) => {
				const label = dominantLabel(character.initial);
				return (
					<Card
						key={character.id}
						padding="sm"
						radius="lg"
						withBorder
						style={{ borderTop: `3px solid ${character.palette.primary}` }}
						data-testid={`character-card-${character.id}`}
					>
						<Group gap="sm" align="flex-start" wrap="nowrap">
							<Box
								w={88}
								style={{
									flexShrink: 0,
									borderRadius: 14,
									overflow: "hidden",
								}}
							>
								<PhoneMiiAvatar
									character={character}
									label={label}
									speaking={false}
									size={88}
									fill
									reducedMotion={reducedMotion}
								/>
							</Box>
							<Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
								<Group justify="space-between" gap="xs" wrap="nowrap">
									<Title order={4} size="h6">
										{character.name}
									</Title>
									<Text size="xs" c="dimmed">
										{characterFacts(character).slice(0, 2).join(" · ")}
									</Text>
								</Group>
								<Text size="sm" fw={500} lineClamp={1}>
									{character.temperament}
								</Text>
								<Text size="xs" c="dimmed" lineClamp={2}>
									{character.callAbout}
								</Text>
								<Group justify="space-between" gap="xs" wrap="nowrap" mt={2}>
									<Badge variant="dot" size="xs" color="grape" style={{ flexShrink: 0 }}>
										{PHONE_EMOTION_LABELS[label]}
									</Badge>
									<Tooltip label={`呼叫 ${character.name}`} withArrow>
										{narrow ? (
											<ActionIcon
												size="md"
												variant="filled"
												onClick={() => onPick(character)}
												style={{ backgroundColor: character.palette.primary }}
												aria-label={`呼叫 ${character.name}`}
											>
												<IconPhoneCall size={15} />
											</ActionIcon>
										) : (
											<Button
												size="compact-sm"
												leftSection={<IconPhoneCall size={14} />}
												onClick={() => onPick(character)}
												style={{ backgroundColor: character.palette.primary }}
												aria-label={`呼叫 ${character.name}`}
											>
												呼叫
											</Button>
										)}
									</Tooltip>
								</Group>
							</Stack>
						</Group>
					</Card>
				);
			})}
		</SimpleGrid>
	);
}
