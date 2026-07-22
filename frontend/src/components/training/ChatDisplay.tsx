import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatBubble } from "@/components/training/ChatBubble";
import { ExamCard } from "@/components/training/ExamCard";
import {
	getEmotionBorder,
	useEmotion,
	usePortrait,
} from "@/engine";
import type { ChatMessage, MessageBus, PatientData } from "@/engine/types";
import { getPatientAvatar } from "@/utils/avatar";

interface ChatDisplayProps {
	messages: ChatMessage[];
	patient: PatientData;
	bus: MessageBus;
	initiativeMsgs?: Set<string>;
	hasStreaming?: boolean;
}

const ChatDisplayInner = memo(function ChatDisplayInner({
	messages,
	patient,
	bus,
	initiativeMsgs,
}: ChatDisplayProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const bottomRef = useRef<HTMLDivElement>(null);
	const [_isNearBottom, setIsNearBottom] = useState(true);
	const isNearBottomRef = useRef(true);
	const prevCountRef = useRef(0);
	const { portraitUrl } = usePortrait();
	const { emotion } = useEmotion();
	const emotionBorder = useMemo(() => getEmotionBorder(emotion), [emotion]);
	const [examResults, setExamResults] = useState<ChatMessage[]>([]);

	useEffect(() => {
		const unsub = bus.on("scene:exam", (e: { op_type: string; value: string; label?: string; unit?: string }) => {
			setExamResults((prev) => [
				...prev,
				{
					id: `exam-${e.op_type}-${prev.length}-${Date.now()}`,
					role: "system",
					content: "",
					examResult: { type: e.op_type, data: { value: e.value, label: e.label, unit: e.unit } },
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

	const patientAvatar =
		portraitUrl ||
		getPatientAvatar({ name: patient.name, gender: patient.gender });
	const nurseAvatar = getPatientAvatar({ name: "Nurse", gender: "female" });

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
		<div
			ref={scrollRef}
			className="h-full overflow-y-auto scroll-smooth px-4 py-4 space-y-4 relative"
			onScroll={handleScroll}
		>
			{grouped.map((group, gi) => {
				const firstMsg = group.messages[0];
				if (firstMsg.role === "system" && firstMsg.examResult) {
					return <ExamCard key={gi} result={firstMsg.examResult} />;
				}
				return (
					<div key={gi} className="flex flex-col gap-1">
						{group.messages.map((msg, mi) => (
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
							/>
						))}
					</div>
				);
			})}
			{examResults
				.filter((er) => !messages.some((m) => m.role === "system" && m.examResult?.type === er.examResult?.type))
				.map((msg, i) => (
					<ExamCard key={msg.id ?? `exam-${i}`} result={msg.examResult!} />
				))}
			<div ref={bottomRef} className="h-1" />
		</div>
	);
});

export const ChatDisplay = ChatDisplayInner;
