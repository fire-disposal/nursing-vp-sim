import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	IconBook2,
	IconBooks,
	IconChevronRight,
	IconMenu2,
	IconMessageCircle,
	IconPlus,
	IconRobot,
	IconSend,
	IconSparkles,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Avatar, Badge, Box, Button, Divider, Drawer, Group, Paper, ScrollArea, Stack, Text, ThemeIcon, Title, Typography, UnstyledButton } from "@mantine/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
	askInQASessionStream,
	createQASession,
	deleteQASession,
	getQASessionMessages,
	getQASessions,
} from "@/api";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import CitationCard from "@/components/citation/CitationCard";
import { useToast } from "@/components/Toast";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { Textarea } from "@/components/ui/textarea";
import { getNurseAvatar } from "@/utils/avatar";
import { useConfirm } from "@/components/ui/confirm";

type QAMessageItem = components["schemas"]["QAMessageItem"];
type Citation = NonNullable<QAMessageItem["citations"]>[number];
type IconType = ComponentType<{ size?: number; className?: string; stroke?: number; color?: string }>;

const SUGGESTIONS = [
	{
		title: "病史采集技巧",
		description: "追问顺序、开放式问题、关键阴性症状",
	},
	{
		title: "护理评估方法",
		description: "现病史、既往史、风险评估的组织方式",
	},
	{
		title: "护理诊断与医疗诊断区别",
		description: "区分护理问题、病因和证据",
	},
	{
		title: "无菌技术要点",
		description: "操作前、中、后的失误点检查",
	},
	{
		title: "生命体征测量规范",
		description: "体温、脉搏、呼吸、血压的记录边界",
	},
];

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
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const { confirm } = useConfirm();
	const toast = useToast();

	const { data: sessions = [], isError } = useQuery({
		queryKey: queryKeys.qa.sessions(),
		queryFn: () => getQASessions().then((r) => r.data),
		staleTime: 30_000,
	});

	const activeSession = useMemo(
		() => sessions.find((session) => session.id === activeSessionId),
		[sessions, activeSessionId],
	);

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
			abortRef.current?.abort();
			try {
				const res = await getQASessionMessages(sessionId);
				setActiveSessionId(sessionId);
				setMessages(res.data || []);
				setStreamingAnswer("");
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
					if (isCanceledError(err)) return;
					const errorMessage = getRequestErrorMessage(err);
					setMessages([
						{ id: optimisticId, role: "user", content: q } as QAMessageItem,
						{
							id: -1,
							role: "assistant",
							content: `抱歉，AI导师暂时无法回复：${errorMessage}`,
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

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
		<Box
			component="main"
			style={{ height: "calc(100dvh - 6.5rem)", minHeight: "32rem", display: "flex", position: "relative" }}
		>
			<Box
				visibleFrom="md"
				style={{
					width: 304,
					flexShrink: 0,
					borderRight: "1px solid var(--mantine-color-gray-3)",
					background: "var(--mantine-color-gray-1)",
					display: "flex",
					flexDirection: "column",
				}}
			>
				<QASidebar
					activeSessionId={activeSessionId}
					handleDeleteSession={handleDeleteSession}
					handleNewChat={handleNewChat}
					isError={isError}
					loadSessions={loadSessions}
					sessions={sessions}
					switchSession={switchSession}
					onClose={() => setShowSidebar(false)}
				/>
			</Box>

			<Drawer
				opened={showSidebar}
				onClose={() => setShowSidebar(false)}
				position="left"
				size="19rem"
				padding={0}
				withCloseButton={false}
			>
				<QASidebar
					activeSessionId={activeSessionId}
					handleDeleteSession={handleDeleteSession}
					handleNewChat={handleNewChat}
					isError={isError}
					loadSessions={loadSessions}
					sessions={sessions}
					switchSession={switchSession}
					onClose={() => setShowSidebar(false)}
				/>
			</Drawer>

			<Box component="section" style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column" }}>
				<Group
					gap="sm"
					wrap="nowrap"
					px="md"
					style={{ minHeight: 64, borderBottom: "1px solid var(--mantine-color-gray-3)", flexShrink: 0 }}
				>
					<Button
						variant="subtle" color="gray"
						size="sm" w={36} h={36} p={0}
						hiddenFrom="md"
						onClick={() => setShowSidebar(true)}
						aria-label="打开对话记录"
					>
						<IconMenu2 size={17} />
					</Button>
					<ThemeIcon size={40} radius="md" variant="light" color="blue">
						<IconRobot size={20} />
					</ThemeIcon>
					<Box style={{ minWidth: 0, flex: 1 }}>
						<Title order={1} size="md" lineClamp={1}>
							护理问答工作台
						</Title>
						<Text size="xs" c="dimmed" truncate hiddenFrom="sm">
							{activeSession?.title || "教材检索、护理推理和操作规范集中在一个对话里"}
						</Text>
					</Box>
					<Badge variant={ragEnabled ? "filled" : "outline"} visibleFrom="sm">
						{ragEnabled ? "教材增强" : "基础模式"}
					</Badge>
					<Button variant="outline" size="sm" onClick={handleNewChat}>
						<IconPlus size={15} />
						新对话
					</Button>
				</Group>

				<Box px="md" py="lg" style={{ minHeight: 0, flex: 1, overflowY: "auto" }}>
					{messages.length === 0 ? (
						<QAWelcome onAsk={sendMessage} />
					) : (
						<Stack gap="lg" mx="auto" maw={896}>
							{messages.map((message, index) => (
								<MessageBubble
									key={`${message.id}-${index}`}
									message={message}
									nurseAvatar={nurseAvatar}
								/>
							))}
							{loading && <AssistantDraft content={streamingAnswer} />}
							<div ref={messagesEndRef} />
						</Stack>
					)}
				</Box>

				<Composer
					input={input}
					inputRef={inputRef}
					loading={loading}
					ragEnabled={ragEnabled}
					onInput={setInput}
					onKeyDown={handleKeyDown}
					onSend={() => sendMessage()}
					onToggleRag={() => setRagEnabled((value) => !value)}
				/>
			</Box>
		</Box>
	);
}

function QASidebar({
	activeSessionId,
	handleDeleteSession,
	handleNewChat,
	isError,
	loadSessions,
	onClose,
	sessions,
	switchSession,
}: {
	activeSessionId: number | null;
	handleDeleteSession: (e: React.MouseEvent, sessionId: number) => void;
	handleNewChat: () => void;
	isError: boolean;
	loadSessions: () => Promise<void>;
	onClose: () => void;
	sessions: components["schemas"]["QASessionItem"][];
	switchSession: (sessionId: number) => Promise<void>;
}) {
	return (
		<Box style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
			<Group justify="space-between" wrap="nowrap" px="md" py="md">
				<Box>
					<Text size="xs" c="dimmed" fw={500}>
						QA history
					</Text>
					<Title order={2} size="lg">
						对话记录
					</Title>
				</Box>
				<Button
					variant="subtle" color="gray"
					size="sm" w={36} h={36} p={0}
					hiddenFrom="md"
					onClick={onClose}
					aria-label="关闭对话记录"
				>
					<IconX size={16} />
				</Button>
			</Group>
			<Box px="md" pb="md">
				<Button fullWidth justify="flex-start" onClick={handleNewChat}>
					<IconPlus size={16} />
					新对话
				</Button>
			</Box>
			<Divider />
			<ScrollArea style={{ flex: 1, minHeight: 0 }}>
				<Stack gap={4} p="sm">
					{sessions.map((session) => (
						<UnstyledButton
							key={session.id}
							onClick={() => switchSession(session.id)}
							style={{
								width: "100%",
								textAlign: "left",
								padding: "12px",
								borderRadius: "var(--mantine-radius-xl)",
								background: activeSessionId === session.id ? "var(--mantine-color-blue-1)" : undefined,
							}}
						>
							<Group gap="sm" align="flex-start" wrap="nowrap">
								<ThemeIcon size={32} radius="md" variant="default" color="gray">
									<IconMessageCircle size={15} />
								</ThemeIcon>
								<Box style={{ minWidth: 0, flex: 1 }}>
									<Text size="sm" fw={500} truncate>
										{session.title}
									</Text>
									<Text size="xs" c="dimmed" mt={4}>
										{formatSessionDate(session.updated_at)}
									</Text>
								</Box>
								<Button
									variant="subtle" color="gray"
									size="xs" w={32} h={32} p={0}
									style={{ flexShrink: 0, opacity: 0.6 }}
									onClick={(event) => handleDeleteSession(event, session.id)}
									aria-label="删除会话"
								>
									<IconTrash size={13} />
								</Button>
							</Group>
						</UnstyledButton>
					))}
					{isError && (
						<EmptyState
							title="加载失败"
							description="无法获取对话记录"
							className="py-10"
							action={
								<Button variant="outline" size="sm" onClick={loadSessions}>
									重试
								</Button>
							}
						/>
					)}
					{sessions.length === 0 && !isError && (
						<EmptyState
							title="暂无历史对话"
							description="提问后将自动保存记录"
							className="py-10"
						/>
					)}
				</Stack>
			</ScrollArea>
		</Box>
	);
}

function QAWelcome({ onAsk }: { onAsk: (text: string) => void }) {
	return (
		<Box mx="auto" w="100%" maw={1024}>
			<Stack gap="md" py="lg">
				<Box>
					<Group gap="xs" style={{ display: "inline-flex", width: "fit-content" }} px="sm" py={4} wrap="nowrap" mb="md">
						<IconSparkles size={15} />
						<Text size="sm" fw={500} c="blue">
							教材增强问答
						</Text>
					</Group>
					<Title order={2} size="3xl">
						把护理学问题问到可以执行
					</Title>
					<Text mt="md" size="md" c="dimmed" lh={1.9} maw={544}>
						围绕教材原文、临床判断和操作规范回答。适合课前预习、训练复盘和病例讨论。
					</Text>
					<Group gap="sm" mt="lg" align="stretch">
						<InfoTile icon={IconBooks} title="引用可回看" description="有教材依据时，可直接打开原文片段。" />
						<InfoTile icon={IconRobot} title="按护理语境回答" description="更关注评估、干预、风险和记录。" />
					</Group>
				</Box>

				<Card>
					<CardHeader>
						<CardTitle size="md">从一个具体问题开始</CardTitle>
						<CardDescription>点击示例后会直接发送，也可以在底部输入自己的问题。</CardDescription>
					</CardHeader>
					<CardContent>
						<Stack gap="xs">
							{SUGGESTIONS.map((suggestion) => (
								<UnstyledButton
									key={suggestion.title}
									onClick={() => onAsk(suggestion.title)}
									style={{
										width: "100%",
										textAlign: "left",
										padding: "12px 16px",
										borderRadius: "var(--mantine-radius-lg)",
										border: "1px solid var(--mantine-color-gray-3)",
									}}
								>
									<Group gap="sm" align="center" wrap="nowrap">
										<ThemeIcon size={36} radius="md" variant="light" color="blue">
											<IconBook2 size={16} />
										</ThemeIcon>
										<Box style={{ minWidth: 0, flex: 1 }}>
											<Text size="sm" fw={500}>
												{suggestion.title}
											</Text>
											<Text size="xs" c="dimmed" mt={2}>
												{suggestion.description}
											</Text>
										</Box>
										<IconChevronRight size={16} style={{ color: "var(--mantine-color-gray-6)" }} />
									</Group>
								</UnstyledButton>
							))}
						</Stack>
					</CardContent>
				</Card>
			</Stack>
		</Box>
	);
}

function InfoTile({
	description,
	icon: Icon,
	title,
}: {
	description: string;
	icon: IconType;
	title: string;
}) {
	return (
		<Paper withBorder radius="md" p="md" style={{ flex: 1 }}>
			<ThemeIcon size={40} radius="md" variant="light" color="gray" mb="sm">
				<Icon size={18} />
			</ThemeIcon>
			<Text size="sm" fw={600}>
				{title}
			</Text>
			<Text size="sm" c="dimmed" mt={4} lh={1.6}>
				{description}
			</Text>
		</Paper>
	);
}

function MessageBubble({
	message,
	nurseAvatar,
}: {
	message: QAMessageItem;
	nurseAvatar: string;
}) {
	const isUser = message.role === "user";

	return (
		<Group gap="sm" align="flex-end" wrap="nowrap" justify={isUser ? "flex-end" : "flex-start"}>
			{!isUser && <AssistantAvatar />}
			<Box
				style={{
					maxWidth: "92%",
					padding: "12px 16px",
					borderRadius: "var(--mantine-radius-lg)",
				}}
				bg={isUser ? "blue" : "var(--mantine-color-body)"}
				c={isUser ? "white" : undefined}
				bd={isUser ? undefined : "1px solid var(--mantine-color-gray-3)"}
			>
				<MarkdownContent isUser={isUser}>{message.content}</MarkdownContent>
				{!isUser && hasCitations(message.citations) && (
					<CitationCard citations={message.citations} />
				)}
			</Box>
			{isUser && (
				<Avatar src={nurseAvatar} alt="护士头像" size={36} radius="xl" />
			)}
		</Group>
	);
}

function AssistantDraft({ content }: { content: string }) {
	return (
		<Group gap="sm" align="flex-end" wrap="nowrap" justify="flex-start" aria-busy="true">
			<AssistantAvatar />
			<Box
				style={{
					maxWidth: "92%",
					padding: "12px 16px",
					borderRadius: "var(--mantine-radius-lg)",
					border: "1px solid var(--mantine-color-gray-3)",
				}}
			>
				{content ? (
					<MarkdownContent>{content}</MarkdownContent>
				) : (
					<div className="typing-dots" role="status" aria-label="AI导师正在思考">
						<span />
						<span />
						<span />
					</div>
				)}
			</Box>
		</Group>
	);
}

function AssistantAvatar() {
	return (
		<ThemeIcon size={36} radius="md" variant="light" color="blue">
			<IconRobot size={18} />
		</ThemeIcon>
	);
}

function MarkdownContent({
	children,
	isUser = false,
}: {
	children: string;
	isUser?: boolean;
}) {
	return (
		<Typography
			style={{ fontSize: "15px", lineHeight: 1.75, ...(isUser ? { color: "white" } : undefined) }}
		>
			<ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
		</Typography>
	);
}

function Composer({
	input,
	inputRef,
	loading,
	onInput,
	onKeyDown,
	onSend,
	onToggleRag,
	ragEnabled,
}: {
	input: string;
	inputRef: React.RefObject<HTMLTextAreaElement | null>;
	loading: boolean;
	onInput: (value: string) => void;
	onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
	onSend: () => void;
	onToggleRag: () => void;
	ragEnabled: boolean;
}) {
	return (
		<Box
			component="footer"
			style={{
				borderTop: "1px solid var(--mantine-color-gray-3)",
				padding: "0.75rem 1rem",
				paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)",
				flexShrink: 0,
			}}
		>
			<Group
				align="flex-end"
				gap="xs"
				wrap="nowrap"
				style={{
					maxWidth: 896,
					margin: "0 auto",
					borderRadius: "var(--mantine-radius-lg)",
					border: "1px solid var(--mantine-color-gray-3)",
					padding: 8,
				}}
			>
				<Button
					type="button"
					variant={ragEnabled ? "filled" : "light"} color={ragEnabled ? undefined : "gray"}
					size="sm"
					visibleFrom="sm"
					onClick={onToggleRag}
					title={ragEnabled ? "关闭教材参考" : "开启教材参考"}
				>
					<IconBook2 size={14} />
					{ragEnabled ? "教材" : "基础"}
				</Button>
				<Textarea
					ref={inputRef}
					variant="unstyled"
					autosize
					minRows={1}
					maxRows={6}
					style={{ flex: 1 }}
					value={input}
					onChange={(event) => onInput(event.target.value)}
					onKeyDown={onKeyDown}
					placeholder="输入护理学问题，Enter 发送，Shift + Enter 换行"
					disabled={loading}
					autoCapitalize="off"
					autoCorrect="off"
				/>
				<Button
					w={44} h={44} p={0}
					onClick={onSend}
					disabled={loading || !input.trim()}
					aria-label="发送问题"
				>
					<IconSend size={17} />
				</Button>
			</Group>
		</Box>
	);
}

function hasCitations(citations: QAMessageItem["citations"]): citations is Citation[] {
	return Array.isArray(citations) && citations.length > 0;
}

function isCanceledError(error: unknown): boolean {
	return (
		error !== null &&
		typeof error === "object" &&
		"name" in error &&
		error.name === "CanceledError"
	);
}

function getRequestErrorMessage(error: unknown): string {
	if (error === null || typeof error !== "object") return "网络错误";
	if (
		"response" in error &&
		error.response !== null &&
		typeof error.response === "object" &&
		"data" in error.response &&
		error.response.data !== null &&
		typeof error.response.data === "object" &&
		"detail" in error.response.data &&
		typeof error.response.data.detail === "string"
	) {
		return error.response.data.detail;
	}
	if ("message" in error && typeof error.message === "string") {
		return error.message;
	}
	return "网络错误";
}

function formatSessionDate(value: string) {
	return new Date(value).toLocaleDateString("zh-CN", {
		month: "2-digit",
		day: "2-digit",
	});
}
