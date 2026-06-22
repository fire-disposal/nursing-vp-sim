import { useEffect, useState } from "react";
import type { ChatMessage, MessageBus, PatientData } from "@/engine/types";
import { cn } from "@/lib/utils";
import { ChatDisplay } from "./ChatDisplay";
import { ChatInput } from "./ChatInput";
import { EmotionIndicator } from "./EmotionIndicator";
import { InitiativeBar } from "./InitiativeBar";
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
}: ChatAreaProps) {
  const hasMessages = messages.length > 0;
  const [initiativeMsgs, setInitiativeMsgs] = useState<Set<string>>(new Set());

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
			<EmotionIndicator bus={bus} features={features} />
			<div className="flex-1 overflow-hidden relative">
				<div
					className={cn(
						"absolute inset-0 transition-opacity duration-300",
						hasMessages ? "opacity-100" : "opacity-0 pointer-events-none",
					)}
				>
					<ChatDisplay
						messages={messages}
						patient={patient}
						bus={bus}
						initiativeMsgs={initiativeMsgs}
						hasStreaming={sending}
					/>
				</div>
				<div
					className={cn(
						"absolute inset-0 transition-opacity duration-300",
						hasMessages ? "opacity-0 pointer-events-none" : "opacity-100",
					)}
				>
					<WelcomeScreen patient={patient} onQuickPrompt={onSend} />
				</div>
			</div>
			<InitiativeBar bus={bus} features={features} recordId={recordId} />
			<ChatInput onSend={onSend} disabled={sending || trainingEnded} loading={sending} />
		</div>
	);
}
