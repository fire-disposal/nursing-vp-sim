import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useTrainingStore } from "@/stores/trainingStore";

import { computeCovered } from "./tools/inquiryProgress";
import { ChatDisplay } from "./ChatDisplay";
import { ChatInput } from "./ChatInput";
import SceneToolbar from "./SceneToolbar";
import { useShortViewport } from "@/hooks/useShortViewport";
import { WelcomeScreen } from "./WelcomeScreen";

interface ChatAreaProps {
	onSend: (text: string) => void;
	onCorrectLast: (messageId: string | number, text: string) => void;
	endTraining: () => Promise<void>;
}

export function ChatArea({
	onSend,
	onCorrectLast,
	endTraining,
}: ChatAreaProps) {
  const messages = useTrainingStore(s => s.messages);
  const patient = useTrainingStore(s => s.patient)!;
  const sending = useTrainingStore(s => s.sending);
  const trainingEnded = useTrainingStore(s => s.trainingEnded);
  const bus = useTrainingStore(s => s.bus)!;
  const capabilities = useTrainingStore(s => s.capabilities);
  const recordDetail = useTrainingStore(s => s.recordDetail);
  const hasStudentMessages = messages.some(m => m.role === "student") || recordDetail?.messages?.some(m => m.role === "student");
  const greeting = useMemo(() => {
    const msgs = recordDetail?.messages;
    if (msgs && msgs.length > 0) {
      const firstPatient = msgs.find(m => m.role === "patient");
      if (firstPatient) return firstPatient.content;
    }
    return undefined;
  }, [recordDetail]);
  const [initiativeMsgs, setInitiativeMsgs] = useState<Set<string>>(new Set());
  const [inquiryModalOpen, setInquiryModalOpen] = useState(false);
  const shownRef = useRef(false);
  const isShort = useShortViewport();

  const inquiriesComplete = useMemo(() => {
    const inquiries = (recordDetail as { required_inquiries?: string[] })?.required_inquiries ?? [];
    if (inquiries.length === 0) return false;
    const studentText = messages
      .filter((m) => m.role === "student")
      .map((m) => String(m.content ?? ""))
      .join("");
    return computeCovered(inquiries, studentText).size === inquiries.length;
  }, [messages, recordDetail]);

  useEffect(() => {
    if (inquiriesComplete && !shownRef.current && !trainingEnded) {
      shownRef.current = true;
      setInquiryModalOpen(true);
    }
  }, [inquiriesComplete, trainingEnded]);

  useEffect(() => {
    if (messages.length === 0) {
      setInitiativeMsgs(new Set());
      shownRef.current = false;
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
				{!hasStudentMessages ? (
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
			<ChatInput onSend={onSend} disabled={sending || trainingEnded} loading={sending} trainingEnded={trainingEnded} />

			<Modal opened={inquiryModalOpen} onClose={() => setInquiryModalOpen(false)} title="问诊内容全部覆盖" size={360} centered withinPortal>
				<Text size="sm" c="dimmed">
					你已成功采集了该病例的全部关键病史信息。是否结束本次训练并生成评分？
				</Text>
				<Group justify="flex-end" gap={8} mt="xl">
					<Button variant="outline" size="sm" onClick={() => setInquiryModalOpen(false)}>
						继续交流
					</Button>
					<Button size="sm" onClick={() => { setInquiryModalOpen(false); endTraining(); }}>
						立即结算
					</Button>
				</Group>
			</Modal>
		</Stack>
	);
}
