import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Group, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconCloudOff, IconPlugConnectedX } from "@tabler/icons-react";
import { completionBlockers } from "@/engine/manifest";
import { useInitialMessages, useExamResults, usePatientData, useSessionManifest } from "@/engine/TrainingDataContext";
import { useTrainingStore } from "@/stores/trainingStore";

import { ChatDisplay } from "./ChatDisplay";
import { ConversationComposer } from "./ConversationComposer";
import ActivityBar from "./workspace/ActivityBar";
import { useWorkspacePanes } from "./workspace/useWorkspacePanes";
import { useTrainingConnection } from "@/hooks/useNetworkStatus";
import { WelcomeScreen } from "./WelcomeScreen";

/**
 * 连接状态横幅 —— 只说**实际受损**的能力（docs/19 E5）。
 *
 * - 网络断开：对话(SSE)、工具(HTTP)、提交都会失败；
 * - 仅 WS 断开：只有服务端推送（评分进度 / 状态通知）暂停，对话与工具照常。
 *
 * 旧实现把 WS 断开说成「工具暂不可用」，属归因错误：工具根本不走 WS。
 */
export function ConnectionNotice() {
	const { degraded } = useTrainingConnection();
	if (degraded === "none") return null;

	const offline = degraded === "all";
	const text = offline
		? "网络已断开：消息发送、工具保存与提交都会失败，请恢复网络后继续"
		: "实时推送连接中断：评分进度与状态通知暂停；对话与工具仍可用，正在自动重连…";

	return (
		<Group
			role="status"
			aria-live="polite"
			gap={8}
			justify="center"
			wrap="nowrap"
			px="md"
			py={6}
			bg={offline ? "red.6" : "yellow.6"}
			style={{ flexShrink: 0 }}
		>
			{offline ? <IconCloudOff size={14} color="#fff" /> : <IconPlugConnectedX size={14} color="#000" />}
			<Text size="xs" fw={600} c={offline ? "white" : "black"}>
				{text}
			</Text>
		</Group>
	);
}

interface ChatAreaProps {
	onSend: (text: string) => void;
	onCorrectLast: (messageId: string | number, text: string) => void;
	/** 打断出口：学生开口而患者仍在说话/回复时调用（由训练装配层停播 + 取消在途生成）。 */
	onBargeIn?: () => void;
}

export function ChatArea({
	onSend,
	onCorrectLast,
	onBargeIn,
}: ChatAreaProps) {
  const messages = useTrainingStore(s => s.messages);
  const patient = usePatientData()!;
  const sending = useTrainingStore(s => s.sending);
  const trainingEnded = useTrainingStore(s => s.trainingEnded);
  const bus = useTrainingStore(s => s.bus)!;
  // 首帧空态判定也看服务端记录（历史学生发言 / 已采集查体），不复制进 store
  const initialMessages = useInitialMessages();
  const examResults = useExamResults();
  // 空态：本病例没有可用的床旁能力（也没有问诊清单）时，明确告知本次训练以对话为主
  const hasWorkspacePane = useWorkspacePanes().length > 0;
  // 交卷门禁由 manifest 下发；这里只渲染原因，不在前端推导
  const blockers = completionBlockers(useSessionManifest());
  const hasConversationActivity =
    messages.some(m => m.role === "student") ||
    initialMessages.some(m => m.role === "student") ||
    examResults.length > 0;
  const greeting = useMemo(
    () => initialMessages.find(m => m.role === "patient")?.content,
    [initialMessages],
  );
  const [initiativeMsgs, setInitiativeMsgs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (messages.length === 0) {
      setInitiativeMsgs(new Set());
    }
  }, [messages.length]);

  useEffect(() => {
    if (!bus) return;
    const MAX_INITIATIVE = 200;
    const unsub = bus.on(
      "initiative:triggered",
      (data: { content: string }) => {
        setInitiativeMsgs((prev) => {
          const next = new Set(prev).add(data.content);
          if (next.size <= MAX_INITIATIVE) return next;
          const arr = [...next];
          return new Set(arr.slice(arr.length - MAX_INITIATIVE));
        });
      },
    );
    return unsub;
  }, [bus]);

	return (
		// 顶部退避由 TrainingEngine 统一负责，本层不得重复让位——重复会让对话列比患者列低一个顶栏高度
		<Stack gap={0} flex={1} mih={0} miw={0}>
			<AnimatePresence mode="wait">
				{!hasConversationActivity ? (
					<motion.div
						key="welcome"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0, y: -16 }}
						transition={{ duration: 0.2 }}
						style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
					>
						<Box miw={0} style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain" }}>
							<WelcomeScreen
								patient={patient}
								onQuickPrompt={onSend}
							/>
							{greeting && (
								<Box px="xs" mt="xs" mx="auto" w="100%" maw={800} miw={0}>
									<Group justify="flex-start">
										<Box
											maw="80%"
											px="md"
											py={10}
											style={{
												borderRadius: 16,
												borderBottomLeftRadius: 4,
												background: "var(--mantine-color-default-hover)",
												lineHeight: 1.6,
											}}
										>
											<Text size="sm">{greeting}</Text>
										</Box>
									</Group>
								</Box>
							)}
						</Box>
						{/* 欢迎态也给出 manifest 能力入口：首条消息前即可打开随堂测验/床旁能力 */}
						<ActivityBar />
					</motion.div>
				) : (
					<motion.div
						key="chat"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ duration: 0.2 }}
						style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
					>
						<Box miw={0} style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain" }}>
							<ChatDisplay
								messages={messages}
								patient={patient}
								bus={bus}
								initiativeMsgs={initiativeMsgs}
								hasStreaming={sending}
								onCorrectLast={onCorrectLast}
							/>
						</Box>
						<ActivityBar />
					</motion.div>
				)}
			</AnimatePresence>
			<ConnectionNotice />
			{!hasWorkspacePane && (
				<Text size="xs" c="dimmed" ta="center" py={6}>
					本病例未配置床旁能力，本次训练以护患对话为主
				</Text>
			)}
			{/* 交卷门禁的**唯一可见处**：原因在这里，计数在顶栏按钮，逐条动作与"要交什么"在完成清单。
			    窄屏也一样（任何一级都不降级成纯文字）。 */}
			{blockers.length > 0 && (
				<Alert
					variant="light"
					color="orange"
					radius="md"
					icon={<IconAlertTriangle size={18} />}
					title="还不能交卷"
					aria-live="polite"
					mx="md"
					mb="xs"
				>
					<Stack gap={2}>
						{blockers.map((blocker) => (
							<Text key={blocker.code} size="sm">
								{blocker.message}
							</Text>
						))}
					</Stack>
				</Alert>
			)}
			<ConversationComposer
				onSend={onSend}
				disabled={sending || trainingEnded}
				loading={sending}
				trainingEnded={trainingEnded}
				bus={bus}
				onBargeIn={onBargeIn}
			/>

		</Stack>
	);
}
