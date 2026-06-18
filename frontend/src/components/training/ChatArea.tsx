import { useEffect, useState } from "react";
import type { ChatMessage, PatientData } from "@/engine/types";
import { ChatDisplay } from "./ChatDisplay";
import { ChatInput } from "./ChatInput";
import { EmotionIndicator } from "./EmotionIndicator";
import { InitiativeBar } from "./InitiativeBar";
import { WelcomeScreen } from "./WelcomeScreen";

interface ChatAreaProps {
	messages: ChatMessage[];
	patient: PatientData;
	sending: boolean;
	onSend: (text: string) => void;
	bus: {
		on: (
			event: string,
			handler: (...args: any[]) => void,
		) => () => void;
	};
	features: Record<string, boolean>;
}

export function ChatArea({
	messages,
	patient,
	sending,
	onSend,
	bus,
	features,
}: ChatAreaProps) {
	const hasMessages = messages.length > 0;
	const [initiativeMsgs, setInitiativeMsgs] = useState<Set<string>>(new Set());

	useEffect(() => {
		const unsub = bus.on(
			"initiative:triggered",
			(data: { content: string }) => {
				setInitiativeMsgs((prev) => new Set(prev).add(data.content));
			},
		);
		return unsub;
	}, [bus]);

	return (
		<div className="flex flex-col h-full">
			<EmotionIndicator bus={bus} features={features} />
			<div className="flex-1 overflow-hidden">
				{hasMessages ? (
					<ChatDisplay
						messages={messages}
						patient={patient}
						bus={bus}
						initiativeMsgs={initiativeMsgs}
					/>
				) : (
					<WelcomeScreen patient={patient} onQuickPrompt={onSend} />
				)}
			</div>
			<InitiativeBar bus={bus} features={features} />
			<ChatInput onSend={onSend} disabled={sending} loading={sending} />
		</div>
	);
}
