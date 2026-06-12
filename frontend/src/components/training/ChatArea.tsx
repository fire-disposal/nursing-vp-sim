import type { ChatMessage, PatientData } from "@/engine/types";
import { ChatDisplay } from "./ChatDisplay";
import { ChatInput } from "./ChatInput";
import { WelcomeScreen } from "./WelcomeScreen";

interface ChatAreaProps {
	messages: ChatMessage[];
	patient: PatientData;
	sending: boolean;
	onSend: (text: string) => void;
	bus: { on: (event: string, handler: (...args: any[]) => void) => () => void };
}

export function ChatArea({
	messages,
	patient,
	sending,
	onSend,
	bus,
}: ChatAreaProps) {
	const hasMessages = messages.length > 0;

	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 overflow-hidden">
				{hasMessages ? (
					<ChatDisplay messages={messages} patient={patient} bus={bus} />
				) : (
					<WelcomeScreen patient={patient} onQuickPrompt={onSend} />
				)}
			</div>
			<ChatInput onSend={onSend} disabled={sending} loading={sending} />
		</div>
	);
}
