import { Box, Container, Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconPhone } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import CharacterGrid from "@/components/phone/CharacterGrid";
import AcousticLabPanel from "@/components/phone/AcousticLabPanel";
import PhonePanel from "@/components/phone/PhonePanel";
import { useReducedMotion } from "@/components/phone/hooks";
import { findCharacter, type PhoneCharacter } from "@/engine/phone/characters";

/**
 * Phone —— 学生「电话」页：**独立演示**，不是训练。
 *
 * 1. 首屏是四张人物卡（不同性别/年龄/脾气/音色/配色/形象）；
 * 2. 选中即进入电话界面：左侧是程序化角色形象，右侧是真实状态（VAD/ASR/TTS/阶段/四维情绪/
 *    首块与停播延迟/实时转写/事件日志），底部是快捷用例与文本输入；
 * 3. 自由对话：语音只借 ASR 传输层（`recordId: 0` → demo ASR），回复来自
 *    `POST /api/voice-demo/chat/stream`（后端权威角色 Prompt），播报走 `DemoTTSPlayer`。
 *    历史只活在当前页面里，刷新即清空。
 *
 * 选中的角色落在 `?c=<id>` 上：刷新/分享链接能回到同一通电话，返回角色卡只是清参数。
 */
export default function Phone() {
	const reducedMotion = useReducedMotion();
	const [params, setParams] = useSearchParams();
	const activeId = params.get("c");
	const [character, setCharacter] = useState<PhoneCharacter | null>(() => findCharacter(activeId));

	// 地址栏是唯一真相：前进/后退（浏览器手势）也要跟着换人。
	useEffect(() => {
		setCharacter(findCharacter(activeId));
	}, [activeId]);

	const handlePick = useCallback(
		(next: PhoneCharacter) => {
			setParams({ c: next.id }, { replace: false });
			setCharacter(next);
		},
		[setParams],
	);

	const handleBack = useCallback(() => {
		setParams({}, { replace: false });
		setCharacter(null);
	}, [setParams]);

	return (
		<Container size="lg" px={{ base: "xs", sm: "md" }} py={{ base: "sm", sm: "md" }}>
			<Stack gap={character ? "md" : "sm"}>
				{!character && (
					<Group gap="sm" wrap="nowrap" align="center">
						<ThemeIcon size={36} radius="xl" variant="light" color="indigo">
							<IconPhone size={19} />
						</ThemeIcon>
						<Box>
							<Title order={3} size="h4">
								电话
							</Title>
							<Text size="xs" c="dimmed">
								自由对谈。
							</Text>
						</Box>
					</Group>
				)}

				{character ? (
					<PhonePanel
						key={character.id}
						character={character}
						onBack={handleBack}
						reducedMotion={reducedMotion}
					/>
				) : (
					<>
						<CharacterGrid onPick={handlePick} reducedMotion={reducedMotion} />
						<AcousticLabPanel />
					</>
				)}
			</Stack>
		</Container>
	);
}
