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
	initiative?: boolean;
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
		oldProps.portraitUrl === newProps.portraitUrl &&
		oldProps.initiative === newProps.initiative
	);
}

export const ChatBubble = memo(function ChatBubble({
	message,
	patientAvatar,
	nurseAvatar,
	emotionBorder,
	portraitUrl,
	initiative,
}: ChatBubbleProps) {
	const displayAvatar = portraitUrl || patientAvatar;

	if (message.role === "system") {
		return (
			<div className="flex justify-center" data-role="system">
				<div className="flex items-start gap-2 max-w-[85%] rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs sm:text-sm">
					<Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
					<div className="whitespace-pre-wrap leading-relaxed text-blue-800">
				<p className="whitespace-pre-wrap">{message.content}</p>
					</div>
				</div>
			</div>
		);
	}

	if (message.role === "patient") {
		const isStreamingEmpty = message.streaming && !message.content;

		return (
			<div className="flex items-start gap-2 justify-start" data-role="patient">
				<img
					className="w-7 h-7 sm:w-8 sm:h-8 md:w-9 md:h-9 rounded-full object-cover shrink-0 bg-muted"
					src={displayAvatar}
					alt="患者"
				/>
				<div
					className={cn(
						"max-w-[90%] sm:max-w-[70%] md:max-w-[60%] px-3.5 py-2.5 sm:px-4 sm:py-2.5 rounded-2xl rounded-tl-md text-sm md:text-base leading-relaxed break-words",
						"bg-card text-foreground border-2",
						emotionBorder,
						!isStreamingEmpty &&
							message.streaming &&
							"after:content-['▎'] after:animate-pulse after:text-primary after:font-bold",
					)}
				>
					{initiative && (
						<span className="inline-block text-[10px] text-amber-600 font-medium bg-amber-50 px-1.5 py-0.5 rounded-sm mb-1">
							患者自主反应
						</span>
					)}
					{isStreamingEmpty ? (
						<div className="flex items-center gap-2 py-1">
							<span className="size-2 rounded-full bg-foreground/30 animate-bounce [animation-delay:0ms]" />
							<span className="size-2 rounded-full bg-foreground/30 animate-bounce [animation-delay:150ms]" />
							<span className="size-2 rounded-full bg-foreground/30 animate-bounce [animation-delay:300ms]" />
						</div>
					) : (
						<p className="whitespace-pre-wrap">{message.content}</p>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className="flex items-start gap-2 justify-end" data-role="student">
			<div
				className={cn(
					"max-w-[90%] sm:max-w-[70%] md:max-w-[60%] px-3.5 py-2.5 sm:px-4 sm:py-2.5 rounded-2xl rounded-tr-md text-sm sm:text-base leading-relaxed break-words",
					"bg-primary text-primary-foreground",
				)}
			>
				<p className="whitespace-pre-wrap">{message.content}</p>
			</div>
			<img
				className="w-7 h-7 sm:w-8 sm:h-8 md:w-9 md:h-9 rounded-full object-cover shrink-0 bg-muted"
				src={nurseAvatar}
				alt="护士"
			/>
		</div>
	);
}, areBubblePropsEqual);
