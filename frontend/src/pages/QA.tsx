import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Bot, Lightbulb, Menu, Plus, Send, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
	askInQASessionStream,
	createQASession,
	deleteQASession,
	getQASessionMessages,
	getQASessions,
} from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import EmptyState from "@/components/ui/empty-state";
import { getNurseAvatar } from "@/utils/avatar";
import { cn } from "@/utils/cn";
import CitationCard from "./CitationCard";

type QAMessageItem = components["schemas"]["QAMessageItem"];

const SUGGESTIONS = [
	"病史采集技巧",
	"护理评估方法",
	"护理诊断与医疗诊断区别",
	"无菌技术要点",
	"生命体征测量规范",
];

const BUBBLE_CONTENT_CLASSES = [
	"break-words",
	"[&_p]:mb-0.5 [&_p:last-child]:mb-0",
	"[&_code]:bg-black/[0.06] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:font-mono",
	"[&_pre]:bg-black/[0.06] [&_pre]:p-2.5 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:my-2",
	"[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-sm",
	"[&_ul]:my-1 [&_ul]:pl-6 [&_ol]:my-1 [&_ol]:pl-6",
	"[&_li]:mb-0.5",
	"[&_table]:border-collapse [&_table]:my-2 [&_table]:w-full",
	"[&_th]:bg-black/[0.04] [&_th]:font-semibold [&_th]:border [&_th]:border-black/10 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-sm",
	"[&_td]:border [&_td]:border-black/10 [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:text-left [&_td]:text-sm",
	"[&_blockquote]:border-l-[3px] [&_blockquote]:border-black/15 [&_blockquote]:my-2 [&_blockquote]:px-3 [&_blockquote]:py-1 [&_blockquote]:opacity-85",
].join(" ");

const BUBBLE_CONTENT_USER = [
	"[&_code]:bg-white/15 [&_code]:text-white",
	"[&_pre]:bg-white/10",
	"[&_blockquote]:border-l-white/30",
	"[&_th]:border-white/20 [&_th]:bg-white/[0.08]",
	"[&_td]:border-white/20",
].join(" ");

export default function QA() {
	const queryClient = useQueryClient();
	const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
	const [messages, setMessages] = useState<QAMessageItem[]>([]);
	const [input, setInput] = useState("");
	const [loading, setLoading] = useState(false);
	const [streamingAnswer, setStreamingAnswer] = useState("");
	const [showSidebar, setShowSidebar] = useState(false);
	const [ragEnabled, setRagEnabled] = useState(true);
	const abortRef = useRef<AbortController | null>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const { confirm } = useConfirm();
	const toast = useToast();

	const { data: sessions = [], isError } = useQuery({
		queryKey: queryKeys.qa.sessions(),
		queryFn: () => getQASessions().then((r) => r.data),
		staleTime: 30_000,
	});

	const loadSessions = useCallback(async () => {
		await queryClient.invalidateQueries({ queryKey: queryKeys.qa.all });
	}, [queryClient]);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages, streamingAnswer]);

	useEffect(() => {
		return () => {
			abortRef.current?.abort();
		};
	}, []);

	const switchSession = useCallback(
		async (sessionId: number) => {
			try {
				const res = await getQASessionMessages(sessionId);
				setActiveSessionId(sessionId);
				setMessages(res.data || []);
				setShowSidebar(false);
			} catch {
				toast.error("加载会话消息失败");
			}
		},
		[toast],
	);

	const sendMessage = useCallback(
		async (text?: string) => {
			const q = (text || input).trim();
			if (!q || loading) return;
			setInput("");
			const optimisticId = -Date.now();

			if (!activeSessionId) {
				setLoading(true);
				setMessages([
					{ id: optimisticId, role: "user", content: q } as QAMessageItem,
				]);

				const abort = new AbortController();
				abortRef.current = abort;

				try {
					const res = await createQASession(q, ragEnabled, abort.signal);
					const { session_id, answer: ans, citations: cit } = res.data;
					setActiveSessionId(session_id);
					setMessages([
						{ id: optimisticId, role: "user", content: q } as QAMessageItem,
						{
							id: optimisticId + 1,
							role: "assistant",
							content: ans,
							citations: cit,
						} as QAMessageItem,
					]);
					await loadSessions();
				} catch (err: unknown) {
					if ((err as { name?: string }).name === "CanceledError") return;
					const axiosErr = err as {
						response?: { data?: { detail?: string } };
						message?: string;
					};
					setMessages([
						{ id: optimisticId, role: "user", content: q } as QAMessageItem,
						{
							id: -1,
							role: "assistant",
							content: `抱歉，AI导师暂时无法回复：${axiosErr.response?.data?.detail || axiosErr.message || "网络错误"}`,
						} as QAMessageItem,
					]);
				} finally {
					setLoading(false);
				}
				return;
			}

			setMessages((prev) => [
				...prev,
				{ id: optimisticId, role: "user", content: q } as QAMessageItem,
			]);
			setLoading(true);
			setStreamingAnswer("");

			const abort = new AbortController();
			abortRef.current = abort;

			askInQASessionStream(
				activeSessionId,
				q,
				ragEnabled,
				(chunk) => {
					setStreamingAnswer((prev) => prev + chunk);
				},
				(id, cit) => {
					setStreamingAnswer((finalAnswer) => {
						setMessages((prev) => [
							...prev.filter((m) => m.id !== optimisticId),
							{ id: optimisticId, role: "user", content: q } as QAMessageItem,
							{
								id: id || optimisticId + 1,
								role: "assistant",
								content: finalAnswer,
								citations: cit ?? undefined,
							} as QAMessageItem,
						]);
						return "";
					});
					setLoading(false);
					loadSessions();
				},
				(msg) => {
					setMessages((prev) => [
						...prev.filter((m) => m.id !== optimisticId),
						{ id: optimisticId, role: "user", content: q } as QAMessageItem,
						{
							id: -1,
							role: "assistant",
							content: `抱歉，AI导师暂时无法回复：${msg}`,
						} as QAMessageItem,
					]);
					setLoading(false);
				},
				abort.signal,
			);
		},
		[input, loading, activeSessionId, ragEnabled, loadSessions],
	);

	const handleDeleteSession = useCallback(
		async (e: React.MouseEvent, sessionId: number) => {
			e.stopPropagation();
			const ok = await confirm({
				title: "删除会话",
				message: "确定要删除此会话？",
				danger: true,
			});
			if (!ok) return;
			try {
				await deleteQASession(sessionId);
				if (activeSessionId === sessionId) {
					setActiveSessionId(null);
					setMessages([]);
				}
				await loadSessions();
			} catch {
				toast.error("删除会话失败");
			}
		},
		[activeSessionId, loadSessions, confirm, toast],
	);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	};

	const handleNewChat = () => {
		abortRef.current?.abort();
		setActiveSessionId(null);
		setMessages([]);
		setStreamingAnswer("");
		setShowSidebar(false);
		setTimeout(() => inputRef.current?.focus(), 0);
	};

	const nurseAvatar = getNurseAvatar();

	return (
		<div className="flex h-dvh overflow-hidden">
				{showSidebar && (
					<div
						className="fixed inset-0 z-40 bg-black/40 md:hidden"
						onClick={() => setShowSidebar(false)}
					/>
				)}

				<aside
					className={cn(
						"fixed inset-y-0 right-0 z-50 flex w-72 flex-col border-l bg-card transition-transform duration-300",
						"md:static md:translate-x-0 md:order-last",
						showSidebar ? "translate-x-0" : "translate-x-full",
					)}
				>
					<div className="flex items-center justify-between p-4 border-b">
						<h2 className="text-sm font-semibold">对话记录</h2>
						<Button
							variant="ghost"
							size="icon-sm"
							className="md:hidden"
							onClick={() => setShowSidebar(false)}
						>
							<X size={16} />
						</Button>
					</div>

					<div className="p-3 border-b">
						<Button
							variant="outline"
							className="w-full justify-start gap-2"
							onClick={handleNewChat}
						>
							<Plus size={16} />
							新对话
						</Button>
					</div>

					<div className="flex-1 overflow-y-auto p-2">
						{sessions.map((s) => (
							<button
								key={s.id}
								type="button"
								className={cn(
									"group flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left transition-colors",
									activeSessionId === s.id ? "bg-muted" : "hover:bg-muted/50",
								)}
								onClick={() => switchSession(s.id)}
							>
								<div className="flex-1 min-w-0">
									<p className="text-sm truncate">{s.title}</p>
									<p className="text-xs text-muted-foreground mt-0.5">
										{new Date(s.updated_at).toLocaleDateString()}
									</p>
								</div>
								<Button
									variant="ghost"
									size="icon-xs"
									className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
									onClick={(e) => handleDeleteSession(e, s.id)}
								>
									<Trash2 size={12} />
								</Button>
							</button>
						))}
						{isError && (
							<EmptyState title="加载失败" description="无法获取对话记录，请检查网络后重试" className="py-8" />
						)}
						{sessions.length === 0 && !isError && (
							<EmptyState title="暂无历史对话" className="py-8" />
						)}
					</div>
				</aside>

				<main className="flex-1 flex flex-col min-w-0 bg-background">
					<Button
						variant="outline"
						size="icon-sm"
						className="absolute top-2 right-2 z-30 md:hidden"
						onClick={() => setShowSidebar(true)}
					>
						<Menu size={16} />
					</Button>

					{messages.length > 0 && (
						<div className="flex flex-col gap-4 px-4 sm:px-6 pt-14 md:pt-6 pb-4 flex-1 overflow-y-auto">
							{messages.map((m, i) => {
								const isUser = m.role === "user";
								return (
									<div
										key={i}
										className={cn(
											"flex items-end gap-2",
											isUser ? "justify-end" : "justify-start",
										)}
									>
										{!isUser && (
											<div className="size-8 rounded-full shrink-0 flex items-center justify-center bg-primary/10 text-primary">
												<Bot size={18} />
											</div>
										)}
										<div
											className={cn(
												"max-w-[80%] sm:max-w-[70%] px-4 py-2.5 rounded-2xl text-sm leading-normal",
												isUser
													? "bg-primary text-primary-foreground rounded-br-md"
													: "bg-muted text-foreground rounded-bl-md",
											)}
										>
											<div
												className={cn(
													BUBBLE_CONTENT_CLASSES,
													isUser && BUBBLE_CONTENT_USER,
												)}
											>
												<ReactMarkdown remarkPlugins={[remarkGfm]}>
													{m.content}
												</ReactMarkdown>
											</div>
											{!isUser && m.citations && m.citations.length > 0 && (
												<CitationCard citations={m.citations} />
											)}
										</div>
										{isUser && (
											<img
												className="size-8 rounded-full shrink-0 object-cover bg-muted"
												src={nurseAvatar}
												alt="护士"
											/>
										)}
									</div>
								);
							})}
							{loading && (
								<div className="flex items-end gap-2 justify-start">
									<div className="size-8 rounded-full shrink-0 flex items-center justify-center bg-primary/10 text-primary">
										<Bot size={18} />
									</div>
									<div className="max-w-[80%] sm:max-w-[70%] px-4 py-2.5 rounded-2xl rounded-bl-md text-sm bg-muted">
										{streamingAnswer ? (
											<div className={BUBBLE_CONTENT_CLASSES}>
												<ReactMarkdown remarkPlugins={[remarkGfm]}>
													{streamingAnswer}
												</ReactMarkdown>
											</div>
										) : (
											<div className="flex gap-1 py-1">
												<span className="size-2 rounded-full bg-muted-foreground/30 animate-bounce [animation-delay:-0.3s]" />
												<span className="size-2 rounded-full bg-muted-foreground/30 animate-bounce [animation-delay:-0.15s]" />
												<span className="size-2 rounded-full bg-muted-foreground/30 animate-bounce" />
											</div>
										)}
									</div>
								</div>
							)}
							<div ref={messagesEndRef} />
						</div>
					)}

					{messages.length === 0 && (
						<div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 pb-6 pt-14 md:pt-0 text-center">
							<Lightbulb size={48} className="text-primary/30 mb-2" />
							<h2 className="text-2xl font-semibold">护理问答</h2>
							<p className="text-muted-foreground text-sm max-w-sm">
								向AI护理导师提问，获取专业的护理学知识解答
							</p>
							<div className="flex flex-wrap gap-2 justify-center mt-2">
								{SUGGESTIONS.map((s) => (
									<button
										key={s}
										type="button"
										className="inline-flex items-center rounded-full border border-border bg-card px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary hover:bg-primary/5 cursor-pointer"
										onClick={() => sendMessage(s)}
									>
										{s}
									</button>
								))}
							</div>
						</div>
					)}

				<div
					className="flex gap-2 items-center border-t p-4"
					style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}
				>
					<button
						type="button"
						className={cn(
							"flex items-center gap-1.5 shrink-0 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors cursor-pointer",
							ragEnabled
								? "bg-primary/10 text-primary border-primary/30"
								: "bg-muted text-muted-foreground border-border hover:border-primary/30",
						)}
						onClick={() => setRagEnabled(!ragEnabled)}
						title={ragEnabled ? "关闭教材参考" : "开启教材参考"}
					>
						<BookOpen size={12} />
						{ragEnabled ? "教材参考" : "基础回答"}
					</button>
					<input
							ref={inputRef}
							className="flex-1 rounded-lg border border-input bg-background px-3 py-3 text-sm placeholder:text-muted-foreground focus-ring disabled:opacity-50"
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="输入您的问题..."
							disabled={loading}
							enterKeyHint="send"
							autoCapitalize="off"
							autoCorrect="off"
						/>
						<Button
							size="icon"
							onClick={() => sendMessage()}
							disabled={loading || !input.trim()}
						>
							<Send size={16} />
						</Button>
					</div>
				</main>
			</div>
	);
}
