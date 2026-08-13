import { motion } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Stack } from "@mantine/core";
import { ChatBubble } from "@/components/training/ChatBubble";
import { ExamResultCard } from "@/components/training/ExamResultCard";
import {
  getEmotionBorder,
  useTrainingStore,
} from "@/stores/trainingStore";
import type { ChatMessage, MessageBus, PatientData } from "@/engine/types";
import useAuthStore from "@/stores/authStore";
import { getNurseAvatar, getPatientAvatar, safeAvatarUrl } from "@/utils/avatar";

interface ChatDisplayProps {
  messages: ChatMessage[];
  patient: PatientData;
  bus: MessageBus;
  initiativeMsgs?: Set<string>;
  hasStreaming?: boolean;
  onCorrectLast?: (messageId: string | number, text: string) => void;
}

const ChatDisplayInner = memo(function ChatDisplayInner({
  messages,
  patient,
  bus,
  initiativeMsgs,
  onCorrectLast,
}: ChatDisplayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [_isNearBottom, setIsNearBottom] = useState(true);
  const isNearBottomRef = useRef(true);
  const prevCountRef = useRef(0);
  const portraitUrl = useTrainingStore((s) => s.portraitUrl);
  const emotion4D = useTrainingStore((s) => s.emotion4D);
  const emotionBorder = useMemo(() => getEmotionBorder(emotion4D), [emotion4D]);
  const sending = useTrainingStore((s) => s.sending);
  const trainingEnded = useTrainingStore((s) => s.trainingEnded);
  const correction = useTrainingStore((s) => s.recordDetail?.message_correction as { remaining?: number; eligible_last_message_id?: number | null } | undefined);
  const eligibleLastMessageId = correction?.eligible_last_message_id;
  const correctionsRemaining = correction?.remaining ?? 0;
  const [examResults, setExamResults] = useState<ChatMessage[]>([]);

  useEffect(() => {
    const unsub = bus.on("tool:result", (payload: { tool: string; action: string; ok: boolean; data: Record<string, unknown> }) => {
      if (payload.tool !== "physical_exam" || payload.action !== "measure" || !payload.ok) return;
      const d = payload.data as { op_type?: string; result?: { label?: string; value?: string; unit?: string } };
      if (!d?.op_type || !d?.result?.value) return;
      setExamResults((prev) => [
        ...prev,
        {
          id: `exam-${d.op_type}-${prev.length}-${Date.now()}`,
          role: "system",
          content: "",
          examResult: { type: d.op_type, data: { value: d.result?.value ?? "", label: d.result?.label, unit: d.result?.unit } },
        } as ChatMessage,
      ]);
    });
    return unsub;
  }, [bus]);

	const checkNearBottom = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return true;
		return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
	}, []);

	const scrollToBottom = useCallback((force = false) => {
		if (force || isNearBottomRef.current) {
			bottomRef.current?.scrollIntoView({
				behavior: force ? "auto" : "smooth",
			});
		}
	}, []);

	const lastScrollSet = useRef(0);
	const handleScroll = useCallback(() => {
		const now = Date.now();
		if (now - lastScrollSet.current < 100) return;
		lastScrollSet.current = now;
		const near = checkNearBottom();
		isNearBottomRef.current = near;
		setIsNearBottom(near);
	}, [checkNearBottom]);

	useEffect(() => {
		const count = messages.length;
		if (count > prevCountRef.current) scrollToBottom(true);
		prevCountRef.current = count;
	}, [messages, scrollToBottom]);

	useEffect(() => {
		const unsub = bus.on("stream:chunk", () => {
			if (isNearBottomRef.current)
				bottomRef.current?.scrollIntoView({ behavior: "auto" });
		});
		return unsub;
	}, [bus]);

	const fallbackPatientAvatar = getPatientAvatar({
		name: patient.name,
		gender: patient.gender,
	});
	const patientAvatar = safeAvatarUrl(portraitUrl, fallbackPatientAvatar);
	const nurseGender = useAuthStore((s) => s.user?.gender);
	const nurseAvatar = getNurseAvatar(nurseGender);

	const grouped = useMemo(() => {
		const result: { role: string; messages: typeof messages }[] = [];
		for (const msg of messages) {
			const last = result[result.length - 1];
			if (last && last.role === msg.role && msg.role !== "system") {
				last.messages.push(msg);
			} else {
				result.push({ role: msg.role, messages: [msg] });
			}
		}
		return result;
	}, [messages]);

	return (
		<Box
			ref={scrollRef}
			style={{ height: "100%", overflowY: "auto", position: "relative" }}
			onScroll={handleScroll}
		>
			<Stack gap="md" mx="auto" w="100%" maw={768} px="md" py="md">
				{grouped.map((group, gi) => {
					const firstMsg = group.messages[0];
					if (firstMsg.role === "system" && firstMsg.examResult) {
						return <ExamResultCard key={gi} result={firstMsg.examResult} />;
					}
					return (
						<motion.div
							key={gi}
							style={{ display: "flex", flexDirection: "column", gap: 4 }}
							initial={{ opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.2, ease: "easeOut" }}
						>
							{group.messages.map((msg, mi) => {
								const canCorrect =
									msg.role === "student" &&
									msg.id != null &&
									String(msg.id) === String(eligibleLastMessageId ?? "") &&
									correctionsRemaining > 0 &&
									!sending &&
									!trainingEnded;
								return (
									<ChatBubble
										key={msg.id ?? mi}
										message={msg}
										patientAvatar={patientAvatar}
										nurseAvatar={nurseAvatar}
										emotionBorder={emotionBorder}
										portraitUrl={portraitUrl}
										initiative={
											msg.role === "patient" &&
											initiativeMsgs?.has(msg.content)
										}
										showAvatar={mi === 0}
										canCorrect={canCorrect}
										correctionsRemaining={correctionsRemaining}
										onCorrect={
											onCorrectLast && msg.id != null
												? (text) => onCorrectLast(msg.id!, text)
												: undefined
										}
									/>
								);
							})}
						</motion.div>
					);
				})}
				{examResults
					.filter((er) => !messages.some((m) => m.role === "system" && m.examResult?.type === er.examResult?.type))
					.map((msg, i) => (
						<ExamResultCard key={msg.id ?? `exam-${i}`} result={msg.examResult!} />
					))}
				<Box ref={bottomRef} h={4} />
			</Stack>
		</Box>
	);
});

export const ChatDisplay = ChatDisplayInner;
