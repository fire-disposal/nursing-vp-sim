import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Box, Group, Stack, Text } from "@mantine/core";
import { useTrainingStore } from "@/stores/trainingStore";

import { ChatDisplay } from "./ChatDisplay";
import { ConversationComposer } from "./ConversationComposer";
import SceneToolbar from "./SceneToolbar";
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
  const patient = useTrainingStore(s => s.patient)!;
  const sending = useTrainingStore(s => s.sending);
  const trainingEnded = useTrainingStore(s => s.trainingEnded);
  const bus = useTrainingStore(s => s.bus)!;
  const capabilities = useTrainingStore(s => s.capabilities);
  const recordDetail = useTrainingStore(s => s.recordDetail);
  const hasConversationActivity =
    messages.some(m => m.role === "student") ||
    recordDetail?.messages?.some(m => m.role === "student") ||
    (recordDetail?.exam_results?.length ?? 0) > 0;
  const greeting = useMemo(() => {
    const msgs = recordDetail?.messages;
    if (msgs && msgs.length > 0) {
      const firstPatient = msgs.find(m => m.role === "patient");
      if (firstPatient) return firstPatient.content;
    }
    return undefined;
  }, [recordDetail]);
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
						style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}
					>
						<WelcomeScreen
							patient={patient}
							onQuickPrompt={onSend}
							capabilities={capabilities}
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
						<SceneToolbar />
					</motion.div>
				)}
			</AnimatePresence>
			<ConversationComposer onSend={onSend} disabled={sending || trainingEnded} loading={sending} trainingEnded={trainingEnded} />

		</Stack>
	);
}
