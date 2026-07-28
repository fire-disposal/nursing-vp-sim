import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { ChatMessage, MessageBus, PatientData } from "@/engine/types";
import type { TrainingRecordDetail } from "@/engine/TrainingContext";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { ChatDisplay } from "./ChatDisplay";
import { ChatInput } from "./ChatInput";
import { EmotionIndicator } from "./EmotionIndicator";
import SceneToolbar from "./SceneToolbar";
import { cn } from "@/utils/cn";
import { useShortViewport } from "@/hooks/useShortViewport";
import { WelcomeScreen } from "./WelcomeScreen";

interface ChatAreaProps {
	messages: ChatMessage[];
	patient: PatientData;
	sending: boolean;
	trainingEnded?: boolean;
	onSend: (text: string) => void;
	bus: MessageBus;
	capabilities: Record<string, boolean>;
	recordId: number;
	hasHistory?: boolean;
	recordDetail: TrainingRecordDetail | null;
}

export function ChatArea({
	messages,
	patient,
	sending,
	trainingEnded = false,
	onSend,
	bus,
	capabilities,
	recordId,
	hasHistory,
	recordDetail,
}: ChatAreaProps) {
  const hasStudentMessages = messages.some(m => m.role === "student") || (hasHistory && recordDetail?.messages?.some(m => m.role === "student"));
  const greeting = useMemo(() => {
    const msgs = recordDetail?.messages;
    if (msgs && msgs.length > 0) {
      const firstPatient = msgs.find(m => m.role === "patient");
      if (firstPatient) return firstPatient.content;
    }
    return undefined;
  }, [recordDetail]);
  const [initiativeMsgs, setInitiativeMsgs] = useState<Set<string>>(new Set());
  const layout = useLayoutMode();
  const isCompact = layout === "phone";
  const isShort = useShortViewport();



  useEffect(() => {
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
		<div className={cn("flex flex-col flex-1 min-h-0", isShort ? "pt-9" : "pt-11 sm:pt-12")}>
			<AnimatePresence mode="wait">
				{!hasStudentMessages ? (
					<motion.div
						key="welcome"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0, y: -16 }}
						transition={{ duration: 0.2 }}
						className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
					>
						<WelcomeScreen
							patient={patient}
							onQuickPrompt={onSend}
							capabilities={capabilities}
						/>
						{greeting && (
							<div className="px-3 mt-3 mx-auto w-full max-w-3xl">
								<div className="flex justify-start">
									<div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-bl-md bg-muted text-sm text-foreground leading-relaxed">
										{greeting}
									</div>
								</div>
							</div>
						)}
					</motion.div>
				) : (
					<motion.div
						key="chat"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ duration: 0.2 }}
						className="flex-1 flex flex-col min-h-0"
					>
						<EmotionIndicator
							bus={bus}
							capabilities={capabilities}
							recordId={recordId}
							compact={isCompact}
						/>
						<div className="flex-1 overflow-y-auto overscroll-contain">
							<ChatDisplay
								messages={messages}
								patient={patient}
								bus={bus}
								initiativeMsgs={initiativeMsgs}
								hasStreaming={sending}
							/>
						</div>
						<SceneToolbar />
					</motion.div>
				)}
			</AnimatePresence>
			<ChatInput onSend={onSend} disabled={sending || trainingEnded} loading={sending} trainingEnded={trainingEnded} />

		</div>
	);
}
