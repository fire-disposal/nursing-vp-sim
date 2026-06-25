import { useQueryClient } from "@tanstack/react-query";
import { Megaphone, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/api/axios-instance";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import EmptyState from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { useApiQuery } from "@/hooks/useApiQuery";

interface SystemNotification {
	id: number;
	title: string;
	content: string;
	level: string;
	is_active: boolean;
	published_at: string | null;
	created_at: string;
}

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

function toLocalDateTime(s: string): string {
	// Backend stores naive UTC datetimes; append Z so the browser renders local time.
	const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`;
	return new Date(iso).toLocaleString("zh-CN");
}

export default function SystemNotificationsPage() {
	const qc = useQueryClient();
	const toast = useToast();
	const [modalOpen, setModalOpen] = useState(false);
	const [editingId, setEditingId] = useState<number | null>(null);
	const [form, setForm] = useState({ title: "", content: "", level: "info", published_at: "" });
	const [saving, setSaving] = useState(false);
	const [deleteId, setDeleteId] = useState<number | null>(null);

	const { data, isLoading } = useApiQuery({
		queryKey: ["system-notifications"],
		queryFn: () => api.get<SystemNotification[]>("/admin/system-notifications"),
	});

	const notifications = data ?? [];

	const openCreate = () => {
		setEditingId(null);
		setForm({ title: "", content: "", level: "info", published_at: "" });
		setModalOpen(true);
	};

	const handleSubmit = async () => {
		if (!form.title.trim() || !form.content.trim()) {
			toast.warning("标题和内容不能为空");
			return;
		}
		setSaving(true);
		try {
			const body: Record<string, unknown> = {
				title: form.title,
				content: form.content,
				level: form.level,
				is_active: true,
			};
			if (form.published_at) {
				body.published_at = new Date(form.published_at).toISOString();
			}
			if (editingId) {
				await api.put(`/admin/system-notifications/${editingId}`, body);
				toast.success("已更新");
			} else {
				await api.post("/admin/system-notifications", body);
				toast.success(form.published_at ? "已创建定时通知" : "已发送");
			}
			qc.invalidateQueries({ queryKey: ["system-notifications"] });
			setModalOpen(false);
		} catch (e) {
			toast.apiError(e);
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async (id: number) => {
		try {
			await api.delete(`/admin/system-notifications/${id}`);
			toast.success("已删除");
			qc.invalidateQueries({ queryKey: ["system-notifications"] });
		} catch (e) {
			toast.apiError(e);
		}
	};

	return (
		<div className="space-y-6">
			<PageHeader title="系统通知" subtitle="创建定时或即时全站通知" />
			<div className="flex justify-end">
				<Button onClick={openCreate}>
					<Plus className="size-4 mr-1.5" />
					新建通知
				</Button>
			</div>
			{isLoading ? (
				<LoadingSkeleton variant="card" />
			) : notifications.length === 0 ? (
				<EmptyState icon={Megaphone} title="暂无通知" description="点击上方按钮创建第一条全站通知" />
			) : (
				<div className="space-y-3">
					{notifications.map((n) => (
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
							<button
								type="button"
								onClick={() => setDeleteId(n.id)}
								className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0"
							>
								<Trash2 className="size-4" />
							</button>
						</div>
					))}
				</div>
			)}
			<Dialog open={modalOpen} onOpenChange={(o) => !o && setModalOpen(false)}>
				<DialogContent maxWidth={560}>
				<div className="space-y-4">
					<h3 className="text-lg font-semibold">{editingId ? "编辑通知" : "新建通知"}</h3>
					<div>
						<Label>标题</Label>
						<Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="通知标题" />
					</div>
					<div>
						<Label>内容</Label>
						<Textarea value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} placeholder="通知正文，支持多行" rows={4} />
					</div>
					<div>
						<Label>级别</Label>
						<select
							value={form.level}
							onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
							className="w-full px-3 py-2 border rounded-lg text-sm"
						>
							<option value="info">通知</option>
							<option value="warning">警告</option>
							<option value="success">成功</option>
						</select>
					</div>
					<div>
						<Label>定时发布（留空即立即发布）</Label>
						<Input type="datetime-local" value={form.published_at} onChange={(e) => setForm((f) => ({ ...f, published_at: e.target.value }))} />
					</div>
					<div className="flex justify-end gap-2 pt-2">
						<Button variant="outline" onClick={() => setModalOpen(false)}>取消</Button>
						<Button onClick={handleSubmit} disabled={saving}>{saving ? "保存中..." : editingId ? "更新" : "创建"}</Button>
					</div>
				</div>
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
