import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Badge, Badge as MantineBadge, Box, Button, Container, Group, Modal, Paper, Select, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconCamera, IconMessageCircle, IconMessageReply } from "@tabler/icons-react";
import { useState } from "react";
import { feedbackImageUrl, getMyFeedback } from "@/api/admin/feedback";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import AuthImage from "@/components/ui/auth-image";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import ProfileTabs from "@/components/shell/ProfileTabs";
import Pagination from "@/components/ui/pagination";
import PageHeader from "@/components/ui/page-header";

type Schemas = components["schemas"];
type FeedbackItem = Schemas["FeedbackItem"] & {
	developer_reply?: string | null;
	replied_at?: string | null;
	version?: string;
};

const RATING_LABELS = ["很不满意", "不满意", "一般", "满意", "很满意"];
const RATING_COLORS = ["red", "orange", "yellow", "green", "blue"];
const TAG_LABELS: Record<string, string> = {
	feature: "功能建议", bug: "BUG反馈", experience: "体验评价",
	content: "内容质量", ui: "界面设计", other: "其他",
};
const LIMIT = 20;

const TAG_OPTIONS = [
	{ label: "全部", value: "" },
	{ label: "BUG", value: "bug" },
	{ label: "功能", value: "feature" },
	{ label: "体验", value: "experience" },
	{ label: "内容", value: "content" },
	{ label: "UI", value: "ui" },
	{ label: "其他", value: "other" },
];

export default function MyFeedbackPage() {
	const [offset, setOffset] = useState(0);
	const [tagFilter, setTagFilter] = useState("");
	const [replyFilter, setReplyFilter] = useState("");

	// 服务端过滤：tag / replied 与分页 total 同源，避免"过滤后空页"脱节
	const params: Record<string, unknown> = { offset, limit: LIMIT };
	if (tagFilter) params.tag = tagFilter;
	if (replyFilter === "replied") params.replied = true;
	else if (replyFilter === "unreplied") params.replied = false;

	const { data, isLoading } = useQuery({
		queryKey: queryKeys.admin.feedback.my(params),
		queryFn: () => getMyFeedback(params).then((r) => r.data),
		staleTime: 0,
		placeholderData: keepPreviousData,
	});

	const items = (data?.items ?? []) as FeedbackItem[];
	const total = data?.total ?? 0;
	const repliedCount = items.filter((item) => item.developer_reply).length;
	const pendingCount = Math.max(items.length - repliedCount, 0);

	const [previewUrl, setPreviewUrl] = useState<string | null>(null);

	return (
		<Container size="md" py="md">
			<Stack gap="lg">
				<ProfileTabs />
				<PageHeader
					title="我的反馈"
					subtitle="查看已提交的问题、建议、截图与开发者回复"
					icon={IconMessageCircle}
				/>

				<Paper withBorder radius="md" p="md">
					<SimpleGrid cols={3} spacing="xs" mb="md">
						<Paper radius="md" bg="gray.1" px="sm" py="xs" ta="center">
							<Text size="lg" fw={600}>
								{total}
							</Text>
							<Text size="xs" c="dimmed">
								累计反馈
							</Text>
						</Paper>
						<Paper radius="md" bg="blue.1" px="sm" py="xs" ta="center">
							<Text size="lg" fw={600} c="blue">
								{repliedCount}
							</Text>
							<Text size="xs" c="dimmed">
								本页已回复
							</Text>
						</Paper>
						<Paper radius="md" bg="gray.1" px="sm" py="xs" ta="center">
							<Text size="lg" fw={600}>
								{pendingCount}
							</Text>
							<Text size="xs" c="dimmed">
								本页待处理
							</Text>
						</Paper>
					</SimpleGrid>

					<Group justify="space-between" align="center" wrap="wrap" gap="sm">
						<Group gap={6} wrap="nowrap" style={{ overflowX: "auto", flex: 1 }}>
							{TAG_OPTIONS.map((opt) => (
								<Button
									key={opt.value}
									type="button"
									variant={tagFilter === opt.value ? "filled" : "light"} color={tagFilter === opt.value ? undefined : "gray"}
									size="xs"
									radius="md"
									style={{ flexShrink: 0 }}
									onClick={() => {
										setTagFilter(opt.value);
										setOffset(0);
									}}
								>
									{opt.label}
								</Button>
							))}
						</Group>
						<Group gap="xs">
							<Text size="xs" c="dimmed">
								回复状态
							</Text>
							<Select
								size="xs"
								w={110}
								data={[
									{ value: "", label: "全部" },
									{ value: "replied", label: "已回复" },
									{ value: "unreplied", label: "未回复" },
								]}
								value={replyFilter}
								onChange={(v) => {
									setReplyFilter(v ?? "");
									setOffset(0);
								}}
							/>
						</Group>
					</Group>
				</Paper>

				{isLoading ? (
					<Stack gap="sm">
						{Array.from({ length: 3 }).map((_, i) => (
							<LoadingSkeleton key={i} variant="card" />
						))}
					</Stack>
				) : items.length === 0 ? (
					<EmptyState
						icon={IconMessageCircle}
						title="暂无反馈"
						description="你提交过的反馈、处理状态和开发者回复会显示在这里。"
					/>
				) : (
					<Stack gap="sm">
						{items.map((fb) => {
							const ratingIndex = Math.max(
								0,
								Math.min(RATING_LABELS.length - 1, fb.rating - 1),
							);
							return (
								<Paper key={fb.id} withBorder radius="md" p="md">
									<Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
										<Group gap="xs" wrap="wrap">
											<MantineBadge
												variant="light"
												color={RATING_COLORS[ratingIndex]}
												radius="md"
												size="sm"
											>
												{fb.rating}{" "}
												<Text component="span" inherit opacity={0.75}>
													{RATING_LABELS[ratingIndex]}
												</Text>
											</MantineBadge>
											{fb.tag && (
												<Badge variant="outline" size="xs">
													{TAG_LABELS[fb.tag] || fb.tag}
												</Badge>
											)}
											<Badge
												variant="light" color={fb.developer_reply ? "green" : "gray"}
												size="xs"
											>
												{fb.developer_reply ? "已回复" : "待处理"}
											</Badge>
										</Group>
										<Text size="xs" c="dimmed">
											{new Date(fb.created_at).toLocaleString("zh-CN")}
											{fb.version && (
												<Text component="span" ml={8} opacity={0.6}>
													v{fb.version}
												</Text>
											)}
										</Text>
									</Group>

									{fb.content && (
										<Text size="sm" lh={1.6} mt="sm" style={{ whiteSpace: "pre-wrap" }}>
											{fb.content}
										</Text>
									)}

									{fb.image_ids && fb.image_ids.length > 0 && (
										<Group gap="xs" align="flex-start" mt="sm" wrap="nowrap">
											<IconCamera
												size={14}
												style={{ color: "var(--mantine-color-gray-6)", flexShrink: 0, marginTop: 4 }}
											/>
											<Group gap="xs" wrap="nowrap" style={{ overflowX: "auto" }}>
												{fb.image_ids.map((imgId) => (
													<Box
														component="button"
														type="button"
														key={imgId}
														onClick={() =>
															setPreviewUrl(feedbackImageUrl(fb.id, imgId))
														}
														style={{
															flexShrink: 0,
															overflow: "hidden",
															borderRadius: "var(--mantine-radius-md)",
															border: "1px solid var(--mantine-color-gray-3)",
															background: "var(--mantine-color-gray-1)",
															padding: 0,
															cursor: "pointer",
														}}
													>
														<AuthImage
															src={feedbackImageUrl(fb.id, imgId)}
															alt={`反馈截图 ${imgId}`}
															style={{ height: 64, width: 96, objectFit: "cover", display: "block" }}
														/>
													</Box>
												))}
											</Group>
										</Group>
									)}

									{fb.developer_reply && (
										<Paper
											radius="md"
											bg="blue.1"
											px="sm"
											py="xs"
											mt="md"
											style={{ border: "1px solid var(--mantine-color-blue-3)" }}
										>
											<Group gap={6} mb={4}>
												<IconMessageReply
													size={13}
													style={{ color: "var(--mantine-color-blue-7)" }}
												/>
												<Text size="xs" fw={500} c="blue">
													开发者回复
												</Text>
												{fb.replied_at && (
													<Text size="10px" c="dimmed">
														{new Date(fb.replied_at).toLocaleString("zh-CN")}
													</Text>
												)}
											</Group>
											<Text size="sm" lh={1.6} style={{ whiteSpace: "pre-wrap" }}>
												{fb.developer_reply}
											</Text>
										</Paper>
									)}
								</Paper>
							);
						})}
					</Stack>
				)}

				{total > LIMIT && (
					<Pagination
						total={total}
						offset={offset}
						limit={LIMIT}
						onChange={setOffset}
					/>
				)}

				{previewUrl && (
					<Modal opened onClose={() => setPreviewUrl(null)} title="截图预览" size={800} centered withinPortal>
						<AuthImage
							src={previewUrl}
							alt="截图预览"
							style={{ maxHeight: "70vh", maxWidth: "100%", objectFit: "contain", borderRadius: "var(--mantine-radius-md)" }}
						/>
					</Modal>
				)}
			</Stack>
		</Container>
	);
}
