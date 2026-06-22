import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatBubble } from "@/components/ChatBubble";
import { ExamCard } from "@/components/training/ExamCard";
import {
	getEmotionBorder,
	useEmotion,
	usePortrait,
} from "@/engine/PluginContext";
import type { ChatMessage, MessageBus, PatientData } from "@/engine/types";
import { cn } from "@/lib/utils";
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
	hasStreaming,
}: ChatDisplayProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const bottomRef = useRef<HTMLDivElement>(null);
	const [isNearBottom, setIsNearBottom] = useState(true);
	const isNearBottomRef = useRef(true);
	const prevCountRef = useRef(0);
	const { portraitUrl } = usePortrait();
	const { emotion } = useEmotion();
	const emotionBorder = useMemo(() => getEmotionBorder(emotion), [emotion]);

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

	return (
		<div
			ref={scrollRef}
			className="h-full overflow-y-auto scroll-smooth px-4 py-4 space-y-4"
			onScroll={handleScroll}
		>
			{messages.map((msg, i) =>
				msg.role === "system" && msg.examResult ? (
					<ExamCard key={msg.id ?? i} result={msg.examResult} />
				) : (
					<ChatBubble
						key={msg.id ?? i}
						message={msg}
						patientAvatar={patientAvatar}
						nurseAvatar={nurseAvatar}
						emotionBorder={emotionBorder}
						portraitUrl={portraitUrl}
						initiative={
							msg.role === "patient" &&
							initiativeMsgs?.has(msg.content)
						}
					/>
				)
			)}
			<div ref={bottomRef} className="h-1" />
		</div>
	);
});

export const ChatDisplay = ChatDisplayInner;
