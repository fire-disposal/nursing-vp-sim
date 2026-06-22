import { useQueryClient } from "@tanstack/react-query";
import { Edit, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { getCases } from "@/api/cases";
import { createPractice, deletePractice, getPractice, getPractices, updatePractice } from "@/api/practices";
import { queryKeys } from "@/api/query-keys";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { getApiErrorMessage } from "@/lib/error-utils";

interface PracticeForm {
	name: string;
	description: string;
	case_id: number;
	features: Record<string, boolean>;
	time_limit: number;
	max_rounds: number;
}

const emptyForm: PracticeForm = {
	name: "",
	description: "",
	case_id: 0,
	features: {},
	time_limit: 20,
	max_rounds: 30,
};

export default function PracticesPage() {
	const toast = useToast();
	const queryClient = useQueryClient();
	const [modalOpen, setModalOpen] = useState(false);
	const [editingId, setEditingId] = useState<number | null>(null);
	const [saving, setSaving] = useState(false);
	const { confirm } = useConfirm();
	const [form, setForm] = useState<PracticeForm>(emptyForm);
	const resetForm = () => setForm(emptyForm);
	const updateForm = (patch: Partial<PracticeForm>) =>
		setForm((f) => ({ ...f, ...patch }));

	const { data: listData, isLoading } = useApiQuery({
		queryKey: queryKeys.practices.all,
		queryFn: () => getPractices(),
		staleTime: 2 * 60_000,
	});
	const { data: casesData } = useApiQuery({
		queryKey: queryKeys.cases.managed.all,
		queryFn: () => getCases(),
		staleTime: 5 * 60_000,
	});

	const practices = listData?.items ?? [];
	const cases = casesData?.items ?? [];

	const openCreate = () => {
		setEditingId(null);
		resetForm();
		setModalOpen(true);
	};

	const openEdit = async (id: number) => {
		try {
			const { data: d } = await getPractice(id);
			setEditingId(id);
			setForm({
				name: d.name || "",
				description: d.description || "",
				case_id: d.case_id || 0,
				features: d.features || {},
				time_limit:
					(d.behavior as { time_limit_minutes?: number })?.time_limit_minutes ?? 20,
				max_rounds:
					(d.behavior as { max_rounds?: number })?.max_rounds ?? 30,
			});
			setModalOpen(true);
		} catch (e: unknown) {
			toast.error(getApiErrorMessage(e, "加载失败"));
		}
	};

	const handleSave = async () => {
		const { name, case_id, features, time_limit, max_rounds } = form;
		if (!name.trim() || !case_id) {
			toast.warning("请填写名称和病例");
			return;
		}
		const payload = {
			name: name.trim(),
			description: form.description.trim() || null,
			case_id,
			features,
			behavior: { time_limit_minutes: time_limit, max_rounds },
		};
		setSaving(true);
		try {
			if (editingId) {
				await updatePractice(editingId, payload);
				toast.success("更新成功");
			} else {
				await createPractice(payload);
				toast.success("创建成功");
			}
			queryClient.invalidateQueries({ queryKey: queryKeys.practices.all });
			setModalOpen(false);
		} catch (e: unknown) {
			toast.error(getApiErrorMessage(e, "操作失败"));
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async (id: number) => {
		const ok = await confirm({
			title: "确认删除",
			message: "确定要删除这个练习模板吗？此操作不可逆。",
		});
		if (!ok) return;
		try {
			await deletePractice(id);
			toast.success("已删除");
			queryClient.invalidateQueries({ queryKey: queryKeys.practices.all });
		} catch (e: unknown) {
			toast.error(getApiErrorMessage(e, "删除失败"));
		}
	};

	return (
		<div className="space-y-6">
			<PageHeader
				title="练习模板"
				subtitle="管理练习模式、功能开关、时长限制等配置。创建作业时选择模板即可。"
				actions={
					<Button onClick={openCreate}>
						<Plus size={16} className="mr-1" />
						新建模板
					</Button>
				}
			/>

			{isLoading ? (
				<LoadingSkeleton />
			) : practices.length === 0 ? (
				<EmptyState
					icon={Plus}
					title="暂无练习模板"
					description="点击上方按钮创建第一个练习模板"
				/>
			) : (
				<Card className="overflow-hidden">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>名称</TableHead>
							<TableHead>病例</TableHead>
							<TableHead>功能</TableHead>
								<TableHead>时长</TableHead>
								<TableHead>训练次数</TableHead>
								<TableHead>操作</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{practices.map((p: any) => (
								<TableRow key={p.id}>
									<TableCell className="font-medium max-w-[180px] truncate">
										{p.name}
									</TableCell>
								<TableCell className="text-sm text-muted-foreground">
									{p.case_name}
								</TableCell>
								<TableCell className="text-xs text-muted-foreground">
									{Object.entries(p.features || {})
										.filter(([, v]) => v)
										.map(
											([k]) =>
												k,
										)
										.join("、") || "—"}
									</TableCell>
									<TableCell className="text-sm">
										{p.behavior?.time_limit_minutes ?? 20} 分钟
									</TableCell>
									<TableCell className="text-sm">{p.training_count}</TableCell>
									<TableCell>
										<div className="flex gap-0.5">
											<Button
												variant="ghost"
												size="icon"
												onClick={() => openEdit(p.id)}
												title="编辑"
											>
												<Edit size={15} />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												onClick={() => handleDelete(p.id)}
												title="删除"
											>
												<Trash2 size={15} className="text-destructive" />
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</Card>
			)}

			<Modal
				open={modalOpen}
				onClose={() => setModalOpen(false)}
				title={editingId ? "编辑练习模板" : "新建练习模板"}
				maxWidth={560}
			>
				<div className="flex flex-col gap-4">
					<div>
						<label className="text-sm font-medium">名称</label>
						<Input
							value={form.name}
							onChange={(e) => updateForm({ name: e.target.value })}
							placeholder="如：情境模拟考核"
						/>
					</div>
					<div>
						<label className="text-sm font-medium">说明（可选）</label>
						<Input
							value={form.description}
							onChange={(e) => updateForm({ description: e.target.value })}
							placeholder="补充说明"
						/>
					</div>
					<div>
						<label className="text-sm font-medium">病例</label>
						<select
							className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
							value={form.case_id || ""}
							onChange={(e) => updateForm({ case_id: Number(e.target.value) })}
						>
							<option value="">选择病例...</option>
							{cases.map((c: any) => (
								<option key={c.id} value={c.id}>
									{c.name}
								</option>
							))}
					</select>
				</div>
				<div className="grid grid-cols-2 gap-3">
						<div>
							<label className="text-sm font-medium">时长限制（分钟）</label>
							<Input
								type="number"
								min={5}
								max={120}
								value={form.time_limit}
								onChange={(e) =>
									updateForm({ time_limit: Number(e.target.value) })
								}
							/>
						</div>
						<div>
							<label className="text-sm font-medium">最大轮次</label>
							<Input
								type="number"
								min={5}
								max={100}
								value={form.max_rounds}
								onChange={(e) =>
									updateForm({ max_rounds: Number(e.target.value) })
								}
							/>
						</div>
					</div>
					<div>
						<label className="text-sm font-medium mb-1 block">功能开关</label>
						<div className="grid grid-cols-2 gap-1.5">
							{[
								{ key: "physical_exam", label: "护理查体" },
								{ key: "emotion", label: "情绪状态机" },
								{ key: "patient_initiative", label: "患者追问" },
								{ key: "questionnaire", label: "问卷评估" },
								{ key: "exam_emotion_bridge", label: "查体-情绪联动" },
								{ key: "allow_pause", label: "允许暂停" },
							].map((f) => (
								<label
									key={f.key}
									className="flex items-center gap-1.5 text-sm py-0.5"
								>
									<input
										type="checkbox"
										checked={form.features[f.key] ?? false}
										onChange={(e) =>
											updateForm({
												features: {
													...form.features,
													[f.key]: e.target.checked,
												},
											})
										}
										className="size-4"
									/>
									{f.label}
								</label>
							))}
						</div>
					</div>
					<div className="flex justify-end gap-2 pt-2">
						<Button variant="outline" onClick={() => setModalOpen(false)}>
							取消
						</Button>
						<Button onClick={handleSave} disabled={saving}>
							{editingId ? "保存" : "创建"}
						</Button>
					</div>
				</div>
			</Modal>
		</div>
	);
}
