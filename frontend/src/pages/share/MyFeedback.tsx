import { REPLY_FILTER_OPTIONS_WITH_ALL, TAG_FILTER_OPTIONS, repliedToUi, tagLabel, uiToReplied } from "@/config/feedback-tags";
import { APP_TIME_ZONE } from "@/utils/date";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Badge, Box, Container, Group, Paper, Select, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconCamera, IconMessageCircle, IconMessageReply } from "@tabler/icons-react";
import { useState } from "react";
import { feedbackImageUrl, getMyFeedback } from "@/api/admin/feedback";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import AuthImage from "@/components/ui/auth-image";
import { FeedbackImagePreview } from "@/components/feedback/ImagePreviewModal";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import { FilterToolbar } from "@/components/ui/filter-toolbar";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import ProfileTabs from "@/components/shell/ProfileTabs";
import Pagination from "@/components/ui/pagination";
import { useListFilters } from "@/hooks/useListFilters";
import PageHeader from "@/components/ui/page-header";

type Schemas = components["schemas"];
type FeedbackItem = Schemas["FeedbackItem"] & {
	developer_reply?: string | null;
	replied_at?: string | null;
	version?: string;
};

const RATING_LABELS = ["很不满意", "不满意", "一般", "满意", "很满意"];
const RATING_COLORS = ["red", "orange", "yellow", "green", "blue"];
const LIMIT = 20;

type MyFeedbackParams = { tag?: string; replied?: boolean };

export default function MyFeedbackPage() {
	// 与其它列表页同一套筛选范式（见 ui-improvement-plan §6.4）：筛选态一次构造出请求参数，
	// 改筛选自动归零 offset，避免"过滤后停在空页"。
	const list = useListFilters<MyFeedbackParams>(
		{ tag: "", replied: undefined },
		{ limit: LIMIT },
	);

	const { data, isLoading, isError, error, refetch } = useQuery({
		queryKey: queryKeys.admin.feedback.my(list.params),
		queryFn: () => getMyFeedback(list.params).then((r) => r.data),
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

				<Paper withBorder p="md">
					<SimpleGrid cols={3} spacing="xs">
						<Paper bg="var(--mantine-color-default-hover)" px="sm" py="xs" ta="center">
							<Text size="lg" fw={600}>
								{isError ? "—" : total}
							</Text>
							<Text size="xs" c="dimmed">
								累计反馈
							</Text>
						</Paper>
						<Paper bg="var(--mantine-color-blue-light)" px="sm" py="xs" ta="center">
							<Text size="lg" fw={600} c="var(--mantine-color-blue-light-color)">
								{isError ? "—" : repliedCount}
							</Text>
							<Text size="xs" c="dimmed">
								本页已回复
							</Text>
						</Paper>
						<Paper bg="var(--mantine-color-default-hover)" px="sm" py="xs" ta="center">
							<Text size="lg" fw={600}>
								{isError ? "—" : pendingCount}
							</Text>
							<Text size="xs" c="dimmed">
								本页待处理
							</Text>
						</Paper>
					</SimpleGrid>
				</Paper>

				{/* 统一工具栏：计数 / 筛选 + 一键复位（与 /admin/feedback 同范式）；本页无可搜索的行，故无搜索框 */}
				<FilterToolbar
					summary={isError ? "共 — 条反馈" : `共 ${total} 条反馈`}
					hasActiveFilters={list.hasActiveFilters}
					onClear={list.reset}
					filters={
						<>
							{/* 标签用下拉（原先 7 个按钮排一行，窄屏要横向滚动） */}
							<Select
								size="sm"
								clearable
								w={130}
								placeholder="全部标签"
								aria-label="标签"
								value={list.values.tag || null}
								onChange={(v) => list.setFilter("tag", v ?? "")}
								data={TAG_FILTER_OPTIONS}
							/>
							<Text size="xs" c="dimmed">
								回复状态
							</Text>
							<Select
								size="xs"
								w={110}
								data={REPLY_FILTER_OPTIONS_WITH_ALL}
								value={repliedToUi(list.values.replied)}
								onChange={(v) => list.setFilter("replied", uiToReplied(v ?? ""))}
							/>
						</>
					}
				/>

				{isLoading ? (
					<Stack gap="sm">
						{Array.from({ length: 3 }).map((_, i) => (
							<LoadingSkeleton key={i} variant="card" />
						))}
					</Stack>
				) : isError ? (
					<ErrorState title="我的反馈加载失败" error={error} onRetry={() => refetch()} />
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
								<Paper key={fb.id} withBorder p="md">
									<Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
										<Group gap="xs" wrap="wrap">
											<Badge
												variant="light"
												color={RATING_COLORS[ratingIndex]}
												radius="md"
												size="sm"
											>
												{fb.rating}{" "}
												<Text component="span" inherit opacity={0.75}>
													{RATING_LABELS[ratingIndex]}
												</Text>
											</Badge>
											{fb.tag && (
												<Badge variant="outline" size="xs">
													{tagLabel(fb.tag)}
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
											{new Date(fb.created_at).toLocaleString("zh-CN", { timeZone: APP_TIME_ZONE })}
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
										<Paper bg="var(--mantine-color-blue-light)" px="sm" py="xs" mt="md">
											<Group gap={6} mb={4}>
												<IconMessageReply
													size={13}
													style={{ color: "var(--mantine-color-blue-7)" }}
												/>
												<Text size="xs" fw={500} c="blue">
													开发者回复
												</Text>
												{fb.replied_at && (
													<Text size="xs" c="dimmed">
														{new Date(fb.replied_at).toLocaleString("zh-CN", { timeZone: APP_TIME_ZONE })}
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
						offset={list.offset}
						limit={LIMIT}
						onChange={list.setOffset}
					/>
				)}

				<FeedbackImagePreview url={previewUrl} onClose={() => setPreviewUrl(null)} />
			</Stack>
		</Container>
	);
}
