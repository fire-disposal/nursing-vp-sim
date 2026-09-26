import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Box, Group, Stack, Text } from "@mantine/core";
import { availableActivities } from "@/engine/manifest";
import { useInitialMessages, useExamResults, usePatientData, useSessionManifest } from "@/engine/TrainingDataContext";
import { useTrainingStore } from "@/stores/trainingStore";

import { ChatDisplay } from "./ChatDisplay";
import { ConversationComposer } from "./ConversationComposer";
import ActivityBar from "./workspace/ActivityBar";
import { CompletionStrip } from "./workspace/CompletionStatus";
import { useWorkspacePanes } from "./workspace/useWorkspacePanes";
import { useShortViewport } from "@/hooks/useShortViewport";
import { WelcomeScreen } from "./WelcomeScreen";

interface ChatAreaProps {
	onSend: (text: string) => void;
	onCorrectLast: (messageId: string | number, text: string) => void;
}

export function ChatArea({
	onSend,
	onCorrectLast,
}: ChatAreaProps) {
  const messages = useTrainingStore(s => s.messages);
  const patient = usePatientData()!;
  const sending = useTrainingStore(s => s.sending);
  const trainingEnded = useTrainingStore(s => s.trainingEnded);
  const bus = useTrainingStore(s => s.bus)!;
  const manifest = useSessionManifest();
  // 首帧空态判定也看服务端记录（历史学生发言 / 已采集查体），不复制进 store
  const initialMessages = useInitialMessages();
  const examResults = useExamResults();
  // 空态：本病例没有可用的床旁能力（也没有问诊清单）时，明确告知本次训练以对话为主
  const hasWorkspacePane = useWorkspacePanes().length > 0;
  const hasConversationActivity =
    messages.some(m => m.role === "student") ||
    initialMessages.some(m => m.role === "student") ||
    examResults.length > 0;
  const greeting = useMemo(
    () => initialMessages.find(m => m.role === "patient")?.content,
    [initialMessages],
  );
  const [initiativeMsgs, setInitiativeMsgs] = useState<Set<string>>(new Set());
  const isShort = useShortViewport();


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
		<Stack gap={0} flex={1} mih={0} style={{ paddingTop: isShort ? 36 : 44 }}>
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
						<Box style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain" }}>
							<WelcomeScreen
								patient={patient}
								onQuickPrompt={onSend}
								activityLabels={availableActivities(manifest).map((activity) => activity.label)}
							/>
							{greeting && (
								<Box px="xs" mt="xs" mx="auto" w="100%" maw={768}>
									<Group justify="flex-start">
										<Box
											maw="80%"
											px="md"
											py={10}
											style={{
												borderRadius: 16,
												borderBottomLeftRadius: 4,
												background: "var(--mantine-color-gray-1)",
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
						<Box style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain" }}>
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
			<CompletionStrip />
			{!hasWorkspacePane && (
				<Text size="xs" c="dimmed" ta="center" py={6}>
					本病例未配置床旁能力，本次训练以护患对话为主
				</Text>
			)}
			<ConversationComposer onSend={onSend} disabled={sending || trainingEnded} loading={sending} trainingEnded={trainingEnded} />

		</Stack>
	);
}
