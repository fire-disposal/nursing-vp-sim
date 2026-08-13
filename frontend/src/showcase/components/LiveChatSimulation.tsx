import { Box, Group, Loader, Stack, Text } from "@mantine/core";
import { IconSend } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

const SCENE = [
	{ role: "nurse" as const, text: "您好，我是您的责任护士。请问您今天哪里不舒服？", delay: 1200 },
	{ role: "patient" as const, text: "最近胸口总是闷闷的，一走路就喘不上气来，晚上躺下的时候更严重。", delay: 3000 },
	{ role: "nurse" as const, text: "这种情况大概持续多长时间了？有什么诱因吗？", delay: 1500 },
	{ role: "patient" as const, text: "大概有两周了。好像没什么特别的，就是突然开始的。之前在社区医院看过，开了点药但是没什么用。", delay: 3500 },
	{ role: "nurse" as const, text: "您之前有心脏病或高血压的病史吗？", delay: 1500 },
	{ role: "patient" as const, text: "去年体检说血压有点偏高，但没当回事，也没吃药。", delay: 3000 },
	{ role: "nurse" as const, text: "家里人有没有心脏病、高血压或糖尿病的情况？", delay: 1800 },
	{ role: "patient" as const, text: "我父亲有冠心病……你说这个会遗传吗？", delay: 2800 },
	{ role: "nurse" as const, text: "了解。您对什么药物或食物过敏吗？", delay: 1500 },
	{ role: "patient" as const, text: "没有，没发现过什么过敏的。", delay: 2000 },
	{ role: "nurse" as const, text: "最近在吃什么药吗？包括中药或保健品。", delay: 1600 },
	{ role: "patient" as const, text: "社区医院开了点丹参片，别的没吃。", delay: 2200 },
	{ role: "nurse" as const, text: "好的，信息都记下来了。您先休息，我会把情况整理好，稍后医生会来看您。", delay: 2500 },
];

type Message = { role: "nurse" | "patient"; text: string };

export default function LiveChatSimulation() {
	const [messages, setMessages] = useState<Message[]>([]);
	const [typing, setTyping] = useState(false);
	const [inputText, setInputText] = useState("");
	const [inputVisible, setInputVisible] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [messages, typing]);

	useEffect(() => {
		let cancelled = false;

		const typeText = async (text: string) => {
			setInputVisible(true);
			for (let i = 0; i <= text.length; i++) {
				if (cancelled) return;
				setInputText(text.slice(0, i));
				await new Promise((r) => setTimeout(r, 50 + Math.random() * 40));
			}
			await new Promise((r) => setTimeout(r, 300));
			if (cancelled) return;
			setInputText("");
			setInputVisible(false);
		};

		const run = async () => {
			for (let i = 0; i < SCENE.length; i++) {
				if (cancelled) return;
				const item = SCENE[i];

				if (item.role === "nurse") {
					await typeText(item.text);
					if (cancelled) return;
				}

				if (item.role === "patient") {
					setTyping(true);
					await new Promise((r) => setTimeout(r, 1500));
					if (cancelled) return;
					setTyping(false);
				}

				setMessages((prev) => [...prev, { role: item.role, text: item.text }]);
				await new Promise((r) => setTimeout(r, item.delay));
			}

			if (!cancelled) {
				await new Promise((r) => setTimeout(r, 2500));
				setMessages([]);
				run();
			}
		};

		run();
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<Box h={380} pos="relative" style={{ display: "flex", flexDirection: "column", overflow: "hidden", marginTop: 2 }}>
			<Group mb={8} px={4} gap={12} style={{ flexShrink: 0 }}>
				<Group
					justify="center"
					align="center"
					style={{
						width: 32,
						height: 32,
						borderRadius: "50%",
						background: "var(--mantine-primary-color-light)",
						color: "var(--mantine-primary-color-light-color)",
					}}
				>
					<Text size="xs" fw={700}>
						训
					</Text>
				</Group>
				<Stack gap={0}>
					<Text size="xs" fw={600} c="dimmed">
						模拟问诊训练
					</Text>
					<Text size="10px" c="dimmed">
						病史采集 · 实时对话
					</Text>
				</Stack>
				<Group
					ml="auto"
					gap={6}
					px={8}
					py={2}
					style={{
						border: "1px solid var(--mantine-color-green-2)",
						borderRadius: "9999px",
						background: "var(--mantine-color-green-0)",
					}}
				>
					<Box
						style={{
							width: 6,
							height: 6,
							borderRadius: "50%",
							background: "var(--mantine-color-green-6)",
						}}
					/>
					<Text size="10px" fw={500} c="green">
						进行中
					</Text>
				</Group>
			</Group>

			<Box
				ref={scrollRef}
				style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none" }}
			>
				<Stack gap={8}>
					{messages.map((msg, i) => {
						const isPatient = msg.role === "patient";
						return (
							<Group
								key={i}
								gap={12}
								align="flex-start"
								justify={isPatient ? "flex-start" : "flex-end"}
								wrap="nowrap"
								style={{ animation: "fadeIn 0.4s ease-out" }}
							>
								{isPatient && (
									<Box
										style={{
											width: 32,
											height: 32,
											borderRadius: "50%",
											background: "var(--mantine-color-red-0)",
											color: "var(--mantine-color-red-6)",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											fontSize: "xs",
											fontWeight: 700,
											flexShrink: 0,
										}}
									>
										患
									</Box>
								)}
								<Box
									px="md"
									py={10}
									style={{
										maxWidth: "78%",
										borderRadius: "var(--mantine-radius-md)",
										...(isPatient
											? {
													borderTopLeftRadius: "var(--mantine-radius-xs)",
													border: "1px solid var(--mantine-color-default-border)",
													background: "var(--mantine-color-gray-1)",
												}
											: {
													borderTopRightRadius: "var(--mantine-radius-xs)",
													background: "var(--mantine-primary-color-filled)",
													color: "var(--mantine-primary-color-contrast)",
												}),
									}}
								>
									<Text size="sm" lh={1.6}>
										{msg.text}
									</Text>
								</Box>
								{!isPatient && (
									<Box
										style={{
											width: 32,
											height: 32,
											borderRadius: "50%",
											background: "var(--mantine-primary-color-light)",
											color: "var(--mantine-primary-color-light-color)",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											fontSize: "xs",
											fontWeight: 700,
											flexShrink: 0,
										}}
									>
										护
									</Box>
								)}
							</Group>
						);
					})}

					{typing && (
						<Group gap={12} align="flex-start" wrap="nowrap">
							<Box
								style={{
									width: 32,
									height: 32,
									borderRadius: "50%",
									background: "var(--mantine-color-red-0)",
									color: "var(--mantine-color-red-6)",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									fontSize: "xs",
									fontWeight: 700,
									flexShrink: 0,
								}}
							>
								患
							</Box>
							<Box
								px="md"
								py="sm"
								style={{
									borderRadius: "var(--mantine-radius-md)",
									borderTopLeftRadius: "var(--mantine-radius-xs)",
									border: "1px solid var(--mantine-color-default-border)",
									background: "var(--mantine-color-gray-1)",
								}}
							>
								<Loader type="dots" size="sm" color="gray" />
							</Box>
						</Group>
					)}
				</Stack>
			</Box>

			<Box
				mt={12}
				px="sm"
				py={8}
				style={{
					border: "1px solid var(--mantine-color-default-border)",
					borderRadius: "var(--mantine-radius-md)",
					background: "var(--mantine-color-gray-0)",
					flexShrink: 0,
				}}
			>
				<Group gap={12}>
					<Box style={{ flex: 1 }}>
						{inputVisible ? (
							<Text size="13px" c="dimmed" span>
								{inputText}
								<Box
									component="span"
									style={{
										display: "inline-block",
										height: 14,
										width: 1,
										background: "var(--mantine-color-dimmed)",
										marginLeft: 2,
										verticalAlign: "middle",
									}}
								/>
							</Text>
						) : (
							<Text size="13px" c="dimmed" span opacity={0.4}>
								输入您的问题...
							</Text>
						)}
					</Box>
					<Box
						style={{
							width: 24,
							height: 24,
							borderRadius: "var(--mantine-radius-sm)",
							background: "var(--mantine-primary-color-light)",
							color: "var(--mantine-primary-color-light-color)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							flexShrink: 0,
						}}
					>
						<IconSend size={12} strokeWidth={2} />
					</Box>
				</Group>
			</Box>
		</Box>
	);
}
