import { useEffect, useState } from "react";
import type { ChatMessage, MessageBus, PatientData } from "@/engine/types";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { ChatDisplay } from "./ChatDisplay";
import { ChatInput } from "./ChatInput";
import { EmotionIndicator } from "./EmotionIndicator";
import SceneToolbar from "./SceneToolbar";
import { WelcomeScreen } from "./WelcomeScreen";

interface ChatAreaProps {
	messages: ChatMessage[];
	patient: PatientData;
	sending: boolean;
	trainingEnded?: boolean;
	onSend: (text: string) => void;
	bus: MessageBus;
	features: Record<string, boolean>;
	recordId: number;
	hasHistory?: boolean;
}

export function ChatArea({
	messages,
	patient,
	sending,
	trainingEnded = false,
	onSend,
	bus,
	features,
	recordId,
	hasHistory,
}: ChatAreaProps) {
  const hasMessages = messages.length > 0;
  const [initiativeMsgs, setInitiativeMsgs] = useState<Set<string>>(new Set());
  const layout = useLayoutMode();
  const isCompact = layout === "phone";

  useEffect(() => {
    if (messages.length === 0) {
      setInitiativeMsgs(new Set());
    }
  }, [messages.length]);

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
		<div className="flex flex-col h-full">
			{isCompact ? (
				<EmotionIndicator bus={bus} features={features} recordId={recordId} compact />
			) : (
				<EmotionIndicator bus={bus} features={features} recordId={recordId} />
			)}
			<div className="flex-1 overflow-y-auto overscroll-contain">
				{!hasMessages && !hasHistory && (
					<WelcomeScreen
						patient={patient}
						onQuickPrompt={onSend}
					/>
				)}
				<ChatDisplay
					messages={messages}
					patient={patient}
					bus={bus}
					initiativeMsgs={initiativeMsgs}
					hasStreaming={sending}
				/>
			</div>
			<SceneToolbar />
			<ChatInput onSend={onSend} disabled={sending || trainingEnded} loading={sending} trainingEnded={trainingEnded} />
		</div>
	);
}
