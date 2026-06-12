import { Info } from "lucide-react";
import { memo } from "react";
import type { ChatMessage } from "@/engine/types";
import { cn } from "@/lib/utils";

interface ChatBubbleProps {
	message: ChatMessage;
	patientAvatar: string;
	nurseAvatar: string;
	emotionBorder: string;
	portraitUrl: string | null;
}

function areBubblePropsEqual(
	oldProps: ChatBubbleProps,
	newProps: ChatBubbleProps,
) {
	return (
		oldProps.message.id === newProps.message.id &&
		oldProps.message.content === newProps.message.content &&
		oldProps.message.streaming === newProps.message.streaming &&
		oldProps.message.role === newProps.message.role &&
		oldProps.emotionBorder === newProps.emotionBorder &&
		oldProps.portraitUrl === newProps.portraitUrl
	);
}

export const ChatBubble = memo(function ChatBubble({
	message,
	patientAvatar,
	nurseAvatar,
	emotionBorder,
	portraitUrl,
}: ChatBubbleProps) {
	const displayAvatar = portraitUrl || patientAvatar;

	if (message.role === "system") {
		return (
			<div className="flex justify-center" data-role="system">
				<div className="flex items-start gap-2 max-w-[85%] rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs">
					<Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
					<div className="whitespace-pre-wrap leading-relaxed text-blue-800">
						{message.content}
					</div>
				</div>
			</div>
		);
	}

	if (message.role === "patient") {
		return (
			<div className="flex items-end gap-2 justify-start" data-role="patient">
				<img
					className="w-7 h-7 sm:w-8 sm:h-8 rounded-full object-cover shrink-0 bg-muted"
					src={displayAvatar}
					alt="患者"
				/>
				<div
					className={cn(
						"max-w-[90%] sm:max-w-[70%] px-3.5 py-2.5 sm:px-4 sm:py-2.5 rounded-2xl rounded-bl-md text-sm leading-relaxed break-words",
						"bg-card text-foreground border-2 rounded-bl-md",
						emotionBorder,
						message.streaming &&
							"after:content-['▎'] after:animate-pulse after:text-primary after:font-bold",
					)}
				>
					<p className="whitespace-pre-wrap">{message.content}</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex items-end gap-2 justify-end" data-role="student">
			<div
				className={cn(
					"max-w-[90%] sm:max-w-[70%] px-3.5 py-2.5 sm:px-4 sm:py-2.5 rounded-2xl rounded-br-md text-sm leading-relaxed break-words",
					"bg-primary text-primary-foreground",
				)}
			>
				{message.content}
			</div>
			<img
				className="w-7 h-7 sm:w-8 sm:h-8 rounded-full object-cover shrink-0 bg-muted"
				src={nurseAvatar}
				alt="护士"
			/>
		</div>
	);
}, areBubblePropsEqual);
