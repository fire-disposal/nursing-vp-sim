import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatBubble } from "@/components/ChatBubble";
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

	const hasStream = messages.some((m) => m.streaming);
	const showFab = (!isNearBottom || hasStream || hasStreaming) && messages.length > 3;

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
			{messages.map((msg, i) => (
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
			))}
			{/* Typing indicator */}
			{hasStreaming && messages.length > 0 && messages[messages.length - 1]?.role === "student" && (
				<div className="flex justify-start px-4">
					<div className="flex items-center gap-2 px-4 py-3 rounded-2xl rounded-bl-sm bg-muted animate-in fade-in-0 duration-300">
						<span className="size-2 rounded-full bg-foreground/30 animate-bounce [animation-delay:0ms]" />
						<span className="size-2 rounded-full bg-foreground/30 animate-bounce [animation-delay:150ms]" />
						<span className="size-2 rounded-full bg-foreground/30 animate-bounce [animation-delay:300ms]" />
					</div>
				</div>
			)}
			<div ref={bottomRef} className="h-1" />

			{showFab && (
				<button
					type="button"
					onClick={() => scrollToBottom(true)}
					className={cn(
						"fixed right-4 z-30 flex items-center justify-center rounded-full border bg-background shadow-md hover:bg-muted transition-colors",
						hasStreaming || hasStream
							? "bottom-28 px-3 py-1.5 gap-1.5"
							: "bottom-24 size-9",
					)}
					aria-label="滚动到最新消息"
				>
					{hasStreaming || hasStream ? (
						<>
							<span className="size-2 rounded-full bg-primary/60 animate-pulse" />
							<span className="text-xs text-muted-foreground whitespace-nowrap">患者正在回复...</span>
						</>
					) : (
						<svg
						width="16"
						height="16"
						viewBox="0 0 16 16"
						fill="none"
						className="text-foreground"
						role="img"
					>
						<title>滚动到最新消息</title>
						<path
							d="M8 3v7m0 0l-3-3m3 3l3-3"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
						<path
							d="M3 13h10"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
					</svg>
					)}
				</button>
			)}
		</div>
	);
});

export const ChatDisplay = ChatDisplayInner;
