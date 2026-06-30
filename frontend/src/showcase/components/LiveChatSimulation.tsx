import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";

const SCENE = [
	{ role: "nurse" as const, text: "您好，我是您的责任护士。请问您今天哪里不舒服？", delay: 1200 },
	{ role: "patient" as const, text: "最近胸口总是闷闷的，一走路就喘不上气来，晚上躺下的时候更严重。", delay: 3000 },
	{ role: "nurse" as const, text: "这种情况大概持续多长时间了？有什么诱因吗？", delay: 1500 },
	{ role: "patient" as const, text: "大概有两周了。好像没什么特别的，就是突然开始的。之前在社区医院看过，开了点药但是没什么用。", delay: 3500 },
	{ role: "nurse" as const, text: "您之前有心脏病或高血压的病史吗？", delay: 1500 },
	{ role: "patient" as const, text: "去年体检说血压有点偏高，但没当回事，也没吃药。", delay: 3000 },
	{ role: "nurse" as const, text: "家里人有没有心脏病、高血压或糖尿病的情况？", delay: 1800 },
	{ role: "patient" as const, text: "我父亲有冠心病……你说这个会遗传吗？", delay: 2800 },
	{ role: "nurse" as const, text: "了解。您对什么药物或食物过敏吗？", delay: 1500 },
	{ role: "patient" as const, text: "没有，没发现过什么过敏的。", delay: 2000 },
	{ role: "nurse" as const, text: "最近在吃什么药吗？包括中药或保健品。", delay: 1600 },
	{ role: "patient" as const, text: "社区医院开了点丹参片，别的没吃。", delay: 2200 },
	{ role: "nurse" as const, text: "好的，信息都记下来了。您先休息，我会把情况整理好，稍后医生会来看您。", delay: 2500 },
];

type Message = { role: "nurse" | "patient"; text: string };

function TypingDots() {
	return (
		<div className="flex gap-1">
			{Array.from({ length: 3 }).map((_, i) => (
				<div
					key={i}
					className="size-1.5 rounded-full bg-muted-foreground/40 animate-bounce"
					style={{ animationDelay: `${i * 0.15}s` }}
				/>
			))}
		</div>
	);
}

export default function LiveChatSimulation() {
	const [messages, setMessages] = useState<Message[]>([]);
	const [typing, setTyping] = useState(false);
	const [inputText, setInputText] = useState("");
	const [inputVisible, setInputVisible] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [messages, typing]);

	useEffect(() => {
		let cancelled = false;

		const typeText = async (text: string) => {
			setInputVisible(true);
			for (let i = 0; i <= text.length; i++) {
				if (cancelled) return;
				setInputText(text.slice(0, i));
				await new Promise((r) => setTimeout(r, 50 + Math.random() * 40));
			}
			await new Promise((r) => setTimeout(r, 300));
			if (cancelled) return;
			setInputText("");
			setInputVisible(false);
		};

		const run = async () => {
			for (let i = 0; i < SCENE.length; i++) {
				if (cancelled) return;
				const item = SCENE[i];

				if (item.role === "nurse") {
					await typeText(item.text);
					if (cancelled) return;
				}

				if (item.role === "patient") {
					setTyping(true);
					await new Promise((r) => setTimeout(r, 1500));
					if (cancelled) return;
					setTyping(false);
				}

				setMessages((prev) => [...prev, { role: item.role, text: item.text }]);
				await new Promise((r) => setTimeout(r, item.delay));
			}

			if (!cancelled) {
				await new Promise((r) => setTimeout(r, 2500));
				setMessages([]);
				run();
			}
		};

		run();
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<div className="relative flex h-[380px] flex-col overflow-hidden mt-0.5">
			<div className="mb-2 flex shrink-0 items-center gap-3 px-2">
				<div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
					训
				</div>
				<div>
					<div className="text-xs font-semibold text-foreground/80">模拟问诊训练</div>
					<div className="text-[10px] text-muted-foreground">病史采集 · 实时对话</div>
				</div>
				<div className="ml-auto flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5">
					<div className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
					<span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">进行中</span>
				</div>
			</div>

			<div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
				{messages.map((msg, i) => {
					const isPatient = msg.role === "patient";
					return (
						<div
							key={i}
							className={cn(
								"flex items-start gap-3 animate-[fadeIn_0.4s_ease-out]",
								isPatient ? "justify-start" : "justify-end",
							)}
						>
							{isPatient && (
								<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-rose-100 text-xs font-bold text-rose-600 dark:bg-rose-900/40 dark:text-rose-400">
									患
								</div>
							)}
							<div
								className={cn(
									"max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
									isPatient
										? "rounded-tl-md border border-border/60 bg-muted/30 text-foreground/85"
										: "rounded-tr-md bg-primary text-primary-foreground",
								)}
							>
								{msg.text}
							</div>
							{!isPatient && (
								<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
									护
								</div>
							)}
						</div>
					);
				})}

				{typing && (
					<div className="flex items-start gap-3">
						<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-rose-100 text-xs font-bold text-rose-600 dark:bg-rose-900/40 dark:text-rose-400">
							患
						</div>
						<div className="rounded-2xl rounded-tl-md border border-border/60 bg-muted/30 px-4 py-3">
							<TypingDots />
						</div>
					</div>
				)}
			</div>

			<div className="mt-3 shrink-0 rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
				<div className="flex items-center gap-3">
					<div className="flex-1 text-[13px] text-muted-foreground/70">
						{inputVisible ? (
							<span>
								{inputText}
								<span className="ml-0.5 inline-block h-3.5 w-px animate-pulse bg-foreground/50 align-middle" />
							</span>
						) : (
							<span className="text-muted-foreground/30">输入您的问题...</span>
						)}
					</div>
					<div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary/40">
						<Send size={12} strokeWidth={2} />
					</div>
				</div>
			</div>
		</div>
	);
}
