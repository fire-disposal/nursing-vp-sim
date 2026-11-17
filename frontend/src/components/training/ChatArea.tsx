import { useEffect, useMemo, useState } from "react";
import { Box, Group, Stack, Text } from "@mantine/core";
import { IconCloudOff, IconPlugConnectedX } from "@tabler/icons-react";
import type { ChatMessage } from "@/engine/types";
import { useInitialMessages, useExamResults, usePatientData } from "@/engine/TrainingDataContext";
import { useTrainingStore, getTrainingState } from "@/stores/trainingStore";

import { ChatDisplay } from "./ChatDisplay";
import { ConversationComposer } from "./ConversationComposer";
import ActivityBar from "./workspace/ActivityBar";
import { useWorkspacePanes } from "./workspace/useWorkspacePanes";
import { useTrainingConnection } from "@/hooks/useNetworkStatus";
import { StatusStrip } from "@/components/ui/status-strip";
import { WelcomeScreen } from "./WelcomeScreen";

/**
 * 连接状态条 —— 只说**实际受损**的能力，走全站同一张状态条（`StatusStrip`）。
 *
 * - 断网：对话(SSE)、工具(HTTP)、交卷都会失败 → danger；
 * - 仅 WS 断开：只有服务端推送（评分进度 / 状态通知）暂停 → warn。
 *
 * 训练页是沉浸壳、没有 `ManageShell` 的断网条，所以这一条在这里承担"全局状态"的职责；
 * 反过来有壳的页面上由 `NetworkBanner` 承担，两者不会同时出现。
 */
export function ConnectionNotice() {
	const { degraded } = useTrainingConnection();
	if (degraded === "none") return null;

	const offline = degraded === "all";

	return (
		<StatusStrip
			tone={offline ? "danger" : "warn"}
			center={false}
			icon={offline ? <IconCloudOff size={14} /> : <IconPlugConnectedX size={14} />}
		>
			{offline
				? "网络已断开：发送、工具保存与交卷都会失败；恢复后自动继续"
				: "实时推送已断开：评分进度与状态通知暂停；对话与工具照常，正在自动重连…"}
		</StatusStrip>
	);
}

interface ChatAreaProps {
	onSend: (text: string) => void;
	onCorrectLast: (messageId: string | number, text: string) => void;
	/** 失败重试：学生消息未送达时重发原句；患者回复中断时重发上一条学生消息。 */
	onRetrySend?: (message: ChatMessage) => void;
	/** 打断出口：学生开口而患者仍在说话/回复时调用（由训练装配层停播 + 取消在途生成）。 */
	onBargeIn?: () => void;
}

export function ChatArea({
	onSend,
	onCorrectLast,
	onRetrySend,
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
      (data: { id?: number; content: string }) => {
        getTrainingState().mergeHistory([{ id: data.id, role: "patient", content: data.content }]);
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
		// 顶栏退避由 TrainingEngine 负责；这里只保留一个主内容宿主，不再切换两棵带位移动画的树。
		<Stack gap={0} flex={1} mih={0} miw={0}>
			<Box style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
				{!hasConversationActivity ? (
					<>
						<Box
							miw={0}
							className="stu-welcome-scroll"
							style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}
						>
							{!messages.some((m) => m.role === "student") && (
								<WelcomeScreen patient={patient} onQuickPrompt={onSend} />
							)}
							{greeting && (
								<Box px="xs" pt="md" mt="auto" mx="auto" w="100%" maw={900} miw={0}>
									<Group justify="flex-start">
										<Box
											maw="80%"
											px="md"
											py={10}
											style={{
												borderRadius: "var(--stu-radius)",
												borderBottomLeftRadius: 4,
												background: "var(--stu-panel)",
												border: "1px solid var(--stu-line)",
												lineHeight: 1.65,
											}}
										>
											<Text size="md">{greeting}</Text>
										</Box>
									</Group>
								</Box>
							)}
						</Box>
						<ActivityBar />
					</>
				) : (
					<>
						<ChatDisplay
							messages={messages}
							patient={patient}
							bus={bus}
							initiativeMsgs={initiativeMsgs}
							hasStreaming={sending}
							onCorrectLast={onCorrectLast}
							onRetry={onRetrySend}
						/>
						<ActivityBar />
					</>
				)}
			</Box>
			<ConnectionNotice />
			{!hasWorkspacePane && (
				<Text size="xs" c="dimmed" ta="center" py={6}>
					本病例未配置床旁能力，本次训练以护患对话为主
				</Text>
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
