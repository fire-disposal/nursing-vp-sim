import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Pencil, Plus, Search, Trash2 } from "lucide-react";
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
import { ConfirmDialog } from "@/components/ui/confirm";
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

const LEVEL_CLASSES: Record<string, string> = {
	info: "bg-info text-info-foreground",
	warning: "bg-warning text-warning-foreground",
	success: "bg-success text-success-foreground",
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
			const body: Record<string, unknown> = {
				title: values.title,
				content: values.content,
				level: values.level,
				is_active: true,
			};
			if (publishedAt) {
				body.published_at = publishedAt;
			}
			if (editing) {
				await updateSystemNotification(editing.id, body as any);
				toast.success("已更新");
			} else {
				await createSystemNotification(body as any);
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
		<div className="space-y-6">
			<PageHeader title="系统通知" subtitle="创建定时或即时全站通知" />
			<div className="flex justify-between items-center gap-3 flex-wrap">
				<div className="flex gap-2 flex-wrap items-center">
					<div className="relative">
						<Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
						<input
							type="text"
							placeholder="搜索标题..."
							aria-label="搜索通知标题"
							value={searchText}
							onChange={(e) => setSearchText(e.target.value)}
							className="pl-8 pr-3 py-1.5 border border-border rounded-lg text-sm bg-card w-48"
						/>
					</div>
					<select
						value={levelFilter}
						onChange={(e) => setLevelFilter(e.target.value)}
						className="py-1.5 px-2.5 border border-border rounded-lg text-sm bg-card"
					>
						<option value="">全部级别</option>
						<option value="info">通知</option>
						<option value="warning">警告</option>
						<option value="success">成功</option>
					</select>
				</div>
				<Button onClick={openCreate}>
					<Plus className="size-4 mr-1.5" />
					新建通知
				</Button>
			</div>
			{isLoading ? (
				<LoadingSkeleton variant="card" />
			) : filtered.length === 0 ? (
				<EmptyState icon={Megaphone} title="暂无通知" description="点击上方按钮创建第一条全站通知" />
			) : (
				<div className="space-y-3">
					{filtered.map((n) => (
						<div key={n.id} className="flex items-start gap-4 p-4 rounded-xl border bg-card">
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2">
									<span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LEVEL_CLASSES[n.level] ?? LEVEL_CLASSES.info}`}>
										{LEVEL_LABELS[n.level] ?? n.level}
									</span>
									<span className="text-sm font-semibold">{n.title}</span>
								</div>
								<p className="text-sm text-muted-foreground mt-1 line-clamp-2">{n.content}</p>
								<div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
									{n.published_at ? (
										<span>📅 {toLocalDateTime(n.published_at)} 发布</span>
									) : (
										<span>即时发布</span>
									)}
									<span>创建于 {n.created_at.slice(0, 10)}</span>
								</div>
							</div>
							<div className="flex items-center gap-1 shrink-0">
								<button
									type="button"
									onClick={() => {
										setEditing(n);
										setModalOpen(true);
									}}
									className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
									title="编辑"
								>
									<Pencil className="size-4" />
								</button>
								<button
									type="button"
									onClick={() => setDeleteId(n.id)}
									className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
									title="删除"
								>
									<Trash2 className="size-4" />
								</button>
							</div>
						</div>
					))}
				</div>
			)}
			<Dialog open={modalOpen} onOpenChange={(o) => {
				if (!o) {
					if (form.formState.isDirty && !window.confirm("内容未保存，确定关闭？")) return;
					setModalOpen(false);
				}
			}}>
				<DialogContent title={editing ? "编辑通知" : "新建通知"} maxWidth={560}>
					<Form {...form}>
						<form
							onSubmit={form.handleSubmit(onSubmit)}
							className="space-y-4"
						>
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
											<select
												className="w-full px-3 py-2 border rounded-lg text-sm"
												{...field}
											>
												<option value="info">通知</option>
												<option value="warning">警告</option>
												<option value="success">成功</option>
											</select>
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
									onClick={() => { if (form.formState.isDirty && !window.confirm("内容未保存，确定关闭？")) return; setModalOpen(false); }}
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
		</div>
	);
}
