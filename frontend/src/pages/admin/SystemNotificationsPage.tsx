import { zodResolver } from "@hookform/resolvers/zod";
import { ActionIcon, Badge, Group, Paper, Select, Stack, Text } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconPencil, IconPlus, IconSpeakerphone, IconTrash } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import {
	createSystemNotification,
	deleteSystemNotification,
	getSystemNotifications,
	updateSystemNotification,
} from "@/api/admin/system-notifications";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import { ConfirmDialog, useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import EmptyState from "@/components/ui/empty-state";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { Textarea } from "@/components/ui/textarea";
import {
	type NotificationValues,
	notificationSchema,
} from "@/schemas/notification";
import { fromDatetimeLocal, toDatetimeLocal } from "@/utils/date";

type SystemNotification = components["schemas"]["SystemNotificationResponse"];

const LEVEL_LABELS: Record<string, string> = {
	info: "通知",
	warning: "警告",
	success: "成功",
};

const LEVEL_COLORS: Record<string, string> = {
	info: "blue",
	warning: "yellow",
	success: "green",
};

function toLocalDateTime(s: string | null | undefined): string {
	if (!s) return "";
	const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`;
	return new Date(iso).toLocaleString("zh-CN");
}

const DEFAULT_VALUES: NotificationValues = {
	title: "",
	content: "",
	level: "info",
	published_at: "",
};

export default function SystemNotificationsPage() {
	const qc = useQueryClient();
	const toast = useToast();
	const { confirm } = useConfirm();
	const [modalOpen, setModalOpen] = useState(false);
	const [editing, setEditing] = useState<SystemNotification | null>(null);
	const [deleteId, setDeleteId] = useState<number | null>(null);
	const [levelFilter, setLevelFilter] = useState("");
	const [searchText, setSearchText] = useState("");

	const form = useForm<NotificationValues>({
		resolver: zodResolver(notificationSchema),
		defaultValues: DEFAULT_VALUES,
	});

	const { data, isLoading } = useQuery({
		queryKey: queryKeys.systemNotifications.all,
		queryFn: () => getSystemNotifications().then((r) => r.data),
	});

	const notifications = data ?? [];

	const filtered = useMemo(() => {
		let result = notifications;
		if (levelFilter) {
			result = result.filter((n) => n.level === levelFilter);
		}
		if (searchText) {
			const q = searchText.toLowerCase();
			result = result.filter((n) => n.title.toLowerCase().includes(q));
		}
		return result;
	}, [notifications, levelFilter, searchText]);

	useEffect(() => {
		if (!modalOpen) return;
		form.reset(
			editing
				? {
						title: editing.title,
						content: editing.content,
						level: editing.level as NotificationValues["level"],
						published_at: toDatetimeLocal(editing.published_at),
					}
				: DEFAULT_VALUES,
		);
	}, [modalOpen, editing, form]);

	const openCreate = () => {
		setEditing(null);
		setModalOpen(true);
	};

	const onSubmit = async (values: NotificationValues) => {
		try {
			const publishedAt = fromDatetimeLocal(values.published_at);
			const body: components["schemas"]["SystemNotificationCreateRequest"] = {
				title: values.title,
				content: values.content,
				level: values.level,
				is_active: true,
			};
			if (publishedAt) {
				body.published_at = publishedAt;
			}
			if (editing) {
				await updateSystemNotification(editing.id, body);
				toast.success("已更新");
			} else {
				await createSystemNotification(body);
				toast.success(publishedAt ? "已创建定时通知" : "已发送");
			}
			qc.invalidateQueries({ queryKey: queryKeys.systemNotifications.all });
			setModalOpen(false);
		} catch (e) {
			toast.apiError(e);
		}
	};

	const handleDelete = async (id: number) => {
		try {
			await deleteSystemNotification(id);
			toast.success("已删除");
			qc.invalidateQueries({ queryKey: queryKeys.systemNotifications.all });
		} catch (e) {
			toast.apiError(e);
		}
	};

	return (
		<Stack gap="xl">
			<PageHeader title="系统通知" subtitle="创建定时或即时全站通知" />
			<Group justify="space-between" align="center" gap="sm" wrap="wrap">
				<Group gap={8} wrap="wrap" align="center">
					<SearchInput
						value={searchText}
						onChange={setSearchText}
						placeholder="搜索标题..."
					/>
					<Select
						value={levelFilter || null}
						onChange={(v) => setLevelFilter(v ?? "")}
						data={[
							{ value: "", label: "全部级别" },
							{ value: "info", label: "通知" },
							{ value: "warning", label: "警告" },
							{ value: "success", label: "成功" },
						]}
						w={140}
					/>
				</Group>
				<Button onClick={openCreate} leftSection={<IconPlus size={16} />}>
					新建通知
				</Button>
			</Group>
			{isLoading ? (
				<LoadingSkeleton variant="card" />
			) : filtered.length === 0 ? (
				<EmptyState icon={IconSpeakerphone} title="暂无通知" description="点击上方按钮创建第一条全站通知" />
			) : (
				<Stack gap="sm">
					{filtered.map((n) => (
						<Paper key={n.id} withBorder radius="lg" p="md">
							<Group align="flex-start" gap={16} wrap="nowrap">
								<div style={{ flex: 1, minWidth: 0 }}>
									<Group gap={8} align="center" wrap="wrap">
										<Badge variant="secondary" color={LEVEL_COLORS[n.level] ?? "blue"} size="sm">
											{LEVEL_LABELS[n.level] ?? n.level}
										</Badge>
										<Text size="sm" fw={600}>{n.title}</Text>
									</Group>
									<Text size="sm" c="dimmed" mt={4} lineClamp={2}>{n.content}</Text>
									<Group gap={12} mt={8} wrap="wrap">
										{n.published_at ? (
											<Text size="xs" c="dimmed">📅 {toLocalDateTime(n.published_at)} 发布</Text>
										) : (
											<Text size="xs" c="dimmed">即时发布</Text>
										)}
										<Text size="xs" c="dimmed">创建于 {n.created_at.slice(0, 10)}</Text>
									</Group>
								</div>
								<Group gap={4} style={{ flexShrink: 0 }}>
									<ActionIcon
										variant="subtle"
										color="gray"
										onClick={() => {
											setEditing(n);
											setModalOpen(true);
										}}
										title="编辑"
									>
										<IconPencil size={16} />
									</ActionIcon>
									<ActionIcon
										variant="subtle"
										color="red"
										onClick={() => setDeleteId(n.id)}
										title="删除"
									>
										<IconTrash size={16} />
									</ActionIcon>
								</Group>
							</Group>
						</Paper>
					))}
				</Stack>
			)}
			<Dialog open={modalOpen} onOpenChange={async (o) => {
				if (!o) {
					if (form.formState.isDirty) {
						const ok = await confirm({ title: "未保存的更改", message: "内容未保存，确定关闭？", danger: true });
						if (!ok) return;
					}
					setModalOpen(false);
				}
			}}>
				<DialogContent title={editing ? "编辑通知" : "新建通知"} maxWidth={560}>
					<Form {...form}>
						<form onSubmit={form.handleSubmit(onSubmit)}>
							<Stack gap="md">
								<FormField
									control={form.control}
									name="title"
									render={({ field }) => (
										<FormItem>
											<FormLabel>标题</FormLabel>
											<FormControl>
												<Input placeholder="通知标题" {...field} />
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="content"
									render={({ field }) => (
										<FormItem>
											<FormLabel>内容</FormLabel>
											<FormControl>
												<Textarea
													placeholder="通知正文，支持多行"
													rows={4}
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="level"
									render={({ field }) => (
										<FormItem>
											<FormLabel>级别</FormLabel>
											<FormControl>
												<Select
													value={field.value}
													onChange={(v) => field.onChange(v ?? "info")}
													data={[
														{ value: "info", label: "通知" },
														{ value: "warning", label: "警告" },
														{ value: "success", label: "成功" },
													]}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="published_at"
									render={({ field }) => (
										<FormItem>
											<FormLabel>定时发布（留空即立即发布）</FormLabel>
											<FormControl>
												<Input type="datetime-local" {...field} />
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<DialogFooter>
									<Button
										type="button"
										variant="outline"
										onClick={async () => {
											if (form.formState.isDirty) {
												const ok = await confirm({ title: "未保存的更改", message: "内容未保存，确定关闭？", danger: true });
												if (!ok) return;
											}
											setModalOpen(false);
										}}
									>
										取消
									</Button>
									<Button
										onClick={form.handleSubmit(onSubmit)}
										disabled={form.formState.isSubmitting}
									>
										{form.formState.isSubmitting
											? "保存中..."
											: editing
												? "更新"
												: "创建"}
									</Button>
								</DialogFooter>
							</Stack>
						</form>
					</Form>
				</DialogContent>
			</Dialog>
			<ConfirmDialog
				open={deleteId !== null}
				title="删除系统通知"
				message="确定删除这条系统通知？此操作不可撤销。"
				confirmLabel="删除"
				danger
				onCancel={() => setDeleteId(null)}
				onConfirm={() => {
					if (deleteId !== null) handleDelete(deleteId);
					setDeleteId(null);
				}}
			/>
		</Stack>
	);
}
