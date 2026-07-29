import { Check, Info, Pencil, X } from "lucide-react";
import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/engine/types";
import { cn } from "@/lib/utils";

interface ChatBubbleProps {
	message: ChatMessage;
	patientAvatar: string;
	nurseAvatar: string;
	emotionBorder: string;
	portraitUrl: string | null;
	initiative?: boolean;
	showAvatar?: boolean;
	canCorrect?: boolean;
	correctionsRemaining?: number;
	onCorrect?: (content: string) => void;
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
		oldProps.message.streamError === newProps.message.streamError &&
		oldProps.emotionBorder === newProps.emotionBorder &&
		oldProps.portraitUrl === newProps.portraitUrl &&
		oldProps.initiative === newProps.initiative &&
		oldProps.showAvatar === newProps.showAvatar &&
		oldProps.canCorrect === newProps.canCorrect &&
		oldProps.correctionsRemaining === newProps.correctionsRemaining
	);
}

export const ChatBubble = memo(function ChatBubble({
	message,
	patientAvatar,
	nurseAvatar,
	emotionBorder,
	portraitUrl,
	initiative,
	showAvatar,
	canCorrect,
	correctionsRemaining = 0,
	onCorrect,
}: ChatBubbleProps) {
	const displayAvatar = portraitUrl || patientAvatar;
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(message.content);
	const trimmedDraft = draft.trim();
	const canSubmitCorrection = trimmedDraft.length > 0 && trimmedDraft !== message.content.trim();

	if (message.role === "system") {
		return (
			<div className="flex justify-center" data-role="system">
				<div className="flex items-start gap-2 max-w-[85%] rounded-xl border-transparent bg-info text-info-foreground px-3 py-2 text-xs sm:text-sm">
					<Info className="h-4 w-4 text-info-foreground shrink-0 mt-0.5" />
					<div className="whitespace-pre-wrap leading-relaxed">
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
				{showAvatar !== false ? (
					<img
						className="w-7 h-7 sm:w-8 sm:h-8 md:w-9 md:h-9 rounded-full object-cover shrink-0 bg-muted"
						src={displayAvatar}
						alt="患者"
					/>
				) : (
					<div className="w-7 h-7 sm:w-8 sm:h-8 md:w-9 md:h-9 shrink-0" />
				)}
				<div
					className={cn(
						"max-w-[88%] sm:max-w-[78%] md:max-w-[72%] px-3.5 py-2.5 sm:px-4 sm:py-2.5 rounded-2xl rounded-tl-md text-sm md:text-base leading-relaxed break-words",
						"bg-card text-foreground border-2",
						emotionBorder,
						!isStreamingEmpty &&
							message.streaming &&
							"after:content-['▎'] after:animate-pulse after:text-primary after:font-bold",
					)}
				>
					{initiative && (
						<span data-badge className="inline-block text-xs font-medium bg-warning text-warning-foreground px-1.5 py-0.5 rounded-sm mb-1">
							患者自主反应
						</span>
					)}
					{isStreamingEmpty ? (
						<div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
							<span>患者正在回复</span>
							<span className="size-1.5 rounded-full bg-foreground/30 animate-bounce [animation-delay:0ms]" />
							<span className="size-1.5 rounded-full bg-foreground/30 animate-bounce [animation-delay:150ms]" />
							<span className="size-1.5 rounded-full bg-foreground/30 animate-bounce [animation-delay:300ms]" />
						</div>
					) : (
						<div className="prose prose-sm dark:prose-invert max-w-none
							[&_p]:mb-1 [&_p:last-child]:mb-0
							[&_ul]:my-1 [&_ul]:pl-4
							[&_ol]:my-1 [&_ol]:pl-4
							[&_li]:mb-0.5
							[&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs
							[&_pre]:bg-black/10 [&_pre]:p-2 [&_pre]:rounded-lg [&_pre]:overflow-x-auto
							[&_blockquote]:border-l-2 [&_blockquote]:border-primary/30 [&_blockquote]:pl-3 [&_blockquote]:opacity-80
						">
							<ReactMarkdown remarkPlugins={[remarkGfm]}>
								{message.content}
							</ReactMarkdown>
						</div>
					)}
					{!isStreamingEmpty && message.streamError && (
						<span className="inline-flex items-center gap-1 mt-1 text-xs text-warning-foreground bg-warning/20 rounded px-1.5 py-0.5">
							⚠ 回复中断
						</span>
					)}
				</div>
			</div>
		);
	}

	if (editing) {
		return (
			<div className="flex items-start gap-2 justify-end" data-role="student">
				<div className="w-full max-w-[88%] sm:max-w-[78%] md:max-w-[72%] rounded-2xl rounded-tr-md bg-primary/10 border border-primary/30 p-2.5">
					<textarea
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						maxLength={2000}
						autoFocus
						className="min-h-20 w-full resize-none rounded-xl border border-primary/30 bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
					/>
					<div className="mt-2 flex items-center justify-between gap-2">
						<span className="text-[11px] text-muted-foreground">
							将重新生成患者回复，剩余 {correctionsRemaining} 次
						</span>
						<div className="flex gap-1.5">
							<button
								type="button"
								className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
								onClick={() => {
									setDraft(message.content);
									setEditing(false);
								}}
								aria-label="取消修正"
							>
								<X className="size-4" />
							</button>
							<button
								type="button"
								disabled={!canSubmitCorrection}
								className="inline-flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
								onClick={() => {
									if (!canSubmitCorrection) return;
									onCorrect?.(trimmedDraft);
									setEditing(false);
								}}
								aria-label="提交修正"
							>
								<Check className="size-4" />
							</button>
						</div>
					</div>
				</div>
				<img
					className="w-7 h-7 sm:w-8 sm:h-8 md:w-9 md:h-9 rounded-full object-cover shrink-0 bg-muted"
					src={nurseAvatar}
					alt="护士"
				/>
			</div>
		);
	}

	return (
		<div className="group flex items-start gap-2 justify-end" data-role="student">
			<div className="flex w-full flex-col items-end gap-1">
				<div
					className={cn(
						"max-w-[88%] sm:max-w-[78%] md:max-w-[72%] px-3.5 py-2.5 sm:px-4 sm:py-2.5 rounded-2xl rounded-tr-md text-sm sm:text-base leading-relaxed break-words",
						"bg-primary text-primary-foreground",
					)}
				>
					<p className="whitespace-pre-wrap">{message.content}</p>
				</div>
				{canCorrect && (
					<button
						type="button"
						className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-muted transition-opacity"
						onClick={() => {
							setDraft(message.content);
							setEditing(true);
						}}
					>
						<Pencil className="size-3" />
						修正 · 剩余 {correctionsRemaining}
					</button>
				)}
			</div>
			<img
				className="w-7 h-7 sm:w-8 sm:h-8 md:w-9 md:h-9 rounded-full object-cover shrink-0 bg-muted"
				src={nurseAvatar}
				alt="护士"
			/>
		</div>
	);
}, areBubblePropsEqual);
