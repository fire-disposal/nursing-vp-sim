import { ActionIcon, Badge, Button, Group, Modal, Paper, Select, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconPencil, IconPlus, IconSpeakerphone, IconTrash } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import {
	createSystemNotification,
	deleteSystemNotification,
	getSystemNotifications,
	updateSystemNotification,
} from "@/api/admin/system-notifications";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import { ConfirmDialog, useConfirm } from "@/components/ui/confirm";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
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
	const [isSubmitting, setIsSubmitting] = useState(false);

	const form = useForm<NotificationValues>({
		initialValues: DEFAULT_VALUES,
		validate: schemaResolver(notificationSchema),
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
		form.setValues(
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
		if (isSubmitting) return;
		setIsSubmitting(true);
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
		} finally {
			setIsSubmitting(false);
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
						<Paper key={n.id} withBorder radius="md" p="md">
							<Group align="flex-start" gap={16} wrap="nowrap">
								<div style={{ flex: 1, minWidth: 0 }}>
									<Group gap={8} align="center" wrap="wrap">
										<Badge variant="light" color={LEVEL_COLORS[n.level] ?? "blue"} size="sm">
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
			<Modal
				opened={modalOpen}
				onClose={async () => {
					if (form.isDirty()) {
						const ok = await confirm({ title: "未保存的更改", message: "内容未保存，确定关闭？", danger: true });
						if (!ok) return;
					}
					setModalOpen(false);
				}}
				title={editing ? "编辑通知" : "新建通知"}
				size={560}
				centered
				withinPortal
			>
					<form onSubmit={form.onSubmit(onSubmit)}>
						<Stack gap="md">
							<TextInput
								label="标题" withAsterisk
								placeholder="通知标题"
								{...form.getInputProps("title")}
							/>
							<Textarea
								label="内容" withAsterisk
								placeholder="通知正文，支持多行"
								rows={4}
								{...form.getInputProps("content")}
							/>
							<Select
								label="级别" withAsterisk
								data={[
									{ value: "info", label: "通知" },
									{ value: "warning", label: "警告" },
									{ value: "success", label: "成功" },
								]}
								{...form.getInputProps("level")}
							/>
							<TextInput
								label="定时发布（留空即立即发布）"
								type="datetime-local"
								{...form.getInputProps("published_at")}
							/>
							<Group justify="flex-end" mt="lg" gap="sm">
								<Button
									type="button"
									variant="outline"
									onClick={async () => {
										if (form.isDirty()) {
											const ok = await confirm({ title: "未保存的更改", message: "内容未保存，确定关闭？", danger: true });
											if (!ok) return;
										}
										setModalOpen(false);
									}}
								>
									取消
								</Button>
								<Button
									type="submit"
									disabled={isSubmitting}
								>
									{isSubmitting
										? "保存中..."
										: editing
											? "更新"
											: "创建"}
								</Button>
							</Group>
						</Stack>
					</form>
			</Modal>
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
