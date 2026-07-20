import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useSearchParams } from "react-router-dom";
import { getManageCases } from "@/api/cases";
import {
	createPractice,
	deletePractice,
	getPractice,
	getPractices,
	updatePractice,
} from "@/api/practices";
import { queryKeys } from "@/api/query-keys";
import CaseSelector from "@/components/admin/cases/CaseSelector";
import ExportButton from "@/components/ExportButton";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import type { DataTableColumn } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import PageHeader from "@/components/ui/page-header";
import Pagination from "@/components/ui/pagination";
import ResponsiveTable from "@/components/ui/responsive-table";
import { ALL_CAPABILITIES } from "@/engine/capabilities.gen";
import { type PracticeValues, practiceSchema } from "@/schemas/practice";

interface PracticeRow {
	id: number;
	name: string;
	case_id?: number;
	case_name?: string;
	training_type?: string;
	features?: Record<string, boolean>;
	behavior?: { time_limit_minutes?: number };
	training_count?: number;
	assignment_count?: number;
	is_active?: boolean;
}

interface CaseOption {
	id: number;
	name: string;
	difficulty?: number;
	capabilities?: Record<string, boolean>;
	training_type?: string;
}

const DEFAULT_VALUES: PracticeValues = {
	name: "",
	description: "",
	case_id: 0,
	features: {},
	time_limit: 20,
	is_active: true,
};

export default function PracticesPage({ embedded = false }: { embedded?: boolean }) {
	const toast = useToast();
	const queryClient = useQueryClient();
	const [modalOpen, setModalOpen] = useState(false);
	const [editingId, setEditingId] = useState<number | null>(null);
	const { confirm } = useConfirm();

	const [searchParams, setSearchParams] = useSearchParams();
	const LIMIT = 20;
	const offset = Number(searchParams.get("offset") || "0");

	const setOffset = (newOffset: number) => {
		setSearchParams((prev) => {
			const next = new URLSearchParams(prev);
			if (newOffset > 0) next.set("offset", String(newOffset));
			else next.delete("offset");
			return next;
		});
	};

	const form = useForm<PracticeValues>({
		resolver: zodResolver(practiceSchema),
		defaultValues: DEFAULT_VALUES,
	});

	const { data: listData, isLoading } = useQuery({
		queryKey: [...queryKeys.practices.all, offset],
		queryFn: () => getPractices({ offset, limit: LIMIT }).then((r) => r.data),
		staleTime: 2 * 60_000,
	});
	const { data: casesData, isLoading: casesLoading } = useQuery({
		queryKey: queryKeys.cases.managed.all,
		queryFn: () => getManageCases({ limit: 200 }).then((r) => r.data),
		staleTime: 5 * 60_000,
	});

	const practices = (listData?.items ?? []) as unknown as PracticeRow[];
	const total = listData?.total ?? 0;
	const cases = (casesData?.items ?? []) as unknown as CaseOption[];

	const openCreate = () => {
		setEditingId(null);
		form.reset(DEFAULT_VALUES);
		setModalOpen(true);
	};

	const openEdit = async (id: number) => {
		try {
			const { data: d } = await getPractice(id);
			setEditingId(id);
			form.reset({
				name: d.name || "",
				description: d.description || "",
				case_id: d.case_id || 0,
				features: d.features || {},
				time_limit:
					(d.behavior as { time_limit_minutes?: number })
						?.time_limit_minutes ?? 20,
				is_active: (d as any).is_active !== false,
			});
			setModalOpen(true);
		} catch (e: unknown) {
			toast.apiError(e, "加载失败");
		}
	};

	const onSubmit = async (values: PracticeValues) => {
		const payload = {
			name: values.name.trim(),
			description: values.description.trim() || null,
			case_id: values.case_id,
			features: values.features || {},
			behavior: {
				time_limit_minutes: values.time_limit,
			},
			is_active: values.is_active,
		};
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
			toast.apiError(e, "操作失败");
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
			toast.apiError(e, "删除失败");
		}
	};

	const columns: DataTableColumn<PracticeRow>[] = [
		{
			key: "name",
			header: "名称",
			cellClassName: "font-medium max-w-[180px] truncate",
		},
		{
			key: "case_name",
			header: "病例",
			cellClassName: "text-sm text-muted-foreground",
		},
		{
			key: "training_type",
			header: "类型",
			cellClassName: "text-xs",
			render: (p) => {
				const val = p.training_type;
				return val === "triage" ? "🚑 分诊" : "💬 问诊";
			},
		},
		{
			key: "capabilities",
			header: "能力",
			cellClassName: "text-xs",
			render: (p) => {
				const caseCaps = cases.find((c) => c.id === p.case_id);
				const caseDefaults = caseCaps?.capabilities ?? {};
				const practiceFeatures = p.features ?? {};
				const merged: Record<string, boolean> = { ...caseDefaults, ...practiceFeatures };
				const enabled = Object.entries(merged).filter(([, v]) => v);
				if (enabled.length === 0) return <span className="text-muted-foreground">—</span>;
				return (
					<span className="flex flex-wrap gap-0.5">
						{enabled.map(([k]) => (
							<span key={k} className="inline-flex items-center rounded bg-primary/10 px-1.5 py-px text-[11px] text-primary">
								{ALL_CAPABILITIES[k]?.label ?? k}
							</span>
						))}
					</span>
				);
			},
		},
		{
			key: "time_limit",
			header: "时长",
			cellClassName: "text-sm",
			render: (p) => `${p.behavior?.time_limit_minutes ?? 20} 分钟`,
		},
		{ key: "training_count", header: "训练次数", cellClassName: "text-sm" },
		{
			key: "assignment_count",
			header: "作业数",
			cellClassName: "text-sm",
			render: (p) => (p.assignment_count ?? 0) > 0 ? String(p.assignment_count) : "-",
		},
		{
			key: "is_active",
			header: "状态",
			cellClassName: "text-xs",
			render: (p) => p.is_active === false ? (
				<span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">已停用</span>
			) : (
				<span className="inline-flex items-center rounded bg-success/10 px-1.5 py-0.5 text-[11px] text-success-foreground">启用</span>
			),
		},
		{
			key: "actions",
			header: "操作",
			render: (p) => (
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
			),
		},
	];

	return (
		<div className={embedded ? "" : "space-y-6"}>
			{embedded ? (
				<div className="flex justify-end gap-2 mb-4">
					<ExportButton endpoint="/admin/practices/export" filename="练习模板列表" />
					<Button onClick={openCreate}>
						<Plus size={16} className="mr-1" />
						新建模板
					</Button>
				</div>
			) : (
			<PageHeader
				title="练习模板"
				subtitle="管理练习模式、时长限制等配置。创建作业时选择模板即可。"
				actions={
					<>
    <ExportButton endpoint="/admin/practices/export" filename="练习模板列表" />
						<Button onClick={openCreate}>
							<Plus size={16} className="mr-1" />
							新建模板
						</Button>
				</>
			}
		/>
		)}

		<ResponsiveTable<PracticeRow>
			columns={columns}
			rows={practices}
			rowKey={(p) => p.id}
			loading={isLoading}
			emptyIcon={Plus}
			emptyTitle="暂无练习模板"
			emptyDescription="点击上方按钮创建第一个练习模板"
			renderCard={(p) => (
				<div className="rounded-lg border bg-card p-3 space-y-2">
					<div className="flex items-start justify-between gap-2">
						<span className="text-sm font-medium truncate">{p.name}</span>
						<span className="shrink-0 text-xs text-muted-foreground">
							{p.training_type === "triage" ? "🚑 分诊" : "💬 问诊"}
						</span>
					</div>
					<div className="text-xs text-muted-foreground">{p.case_name}</div>
					<div className="flex items-center justify-between gap-2">
						<span className="text-xs text-muted-foreground">{p.training_count ?? 0} 次训练</span>
					<div className="flex gap-1">
						<Button variant="outline" size="sm" onClick={() => openEdit(p.id)}>编辑</Button>
						<Button variant="outline" size="sm" onClick={() => handleDelete(p.id)}>删除</Button>
					</div>
					</div>
				</div>
			)}
		/>

		{total > LIMIT && (
			<Pagination total={total} offset={offset} limit={LIMIT} onChange={setOffset} />
		)}

			<Dialog open={modalOpen} onOpenChange={(o) => {
				if (!o) {
					if (form.formState.isDirty && !window.confirm("内容未保存，确定关闭？")) return;
					setModalOpen(false);
				}
			}}>
				<DialogContent
					title={editingId ? "编辑练习模板" : "新建练习模板"}
					maxWidth={560}
				>
					<Form {...form}>
						<form
							onSubmit={form.handleSubmit(onSubmit)}
							className="flex flex-col gap-4"
						>
							<FormField
								control={form.control}
								name="name"
								render={({ field }) => (
									<FormItem>
										<FormLabel>名称</FormLabel>
										<FormControl>
											<Input placeholder="如：情境模拟考核" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="description"
								render={({ field }) => (
									<FormItem>
										<FormLabel>说明（可选）</FormLabel>
										<FormControl>
											<Input placeholder="补充说明" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="case_id"
								render={({ field }) => (
									<FormItem>
										<FormLabel>病例</FormLabel>
										<FormControl>
											<CaseSelector
												cases={cases}
												value={field.value}
												onChange={(id) => field.onChange(id)}
												loading={casesLoading}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<div className="grid grid-cols-2 gap-3">
								<FormField
									control={form.control}
									name="time_limit"
									render={({ field }) => (
										<FormItem>
											<FormLabel>时长限制（分钟）</FormLabel>
											<FormControl>
												<Input
													type="number"
													min={5}
													max={120}
													{...field}
													value={Number.isNaN(field.value) ? "" : field.value}
													onChange={(e) =>
														field.onChange(
															e.target.value === ""
																? Number.NaN
																: e.target.valueAsNumber,
														)
													}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
							/>
						</div>
						<FormField
								control={form.control}
								name="features"
								render={({ field }) => {
									const selectedCaseId = form.watch("case_id");
									const selectedCase = cases.find((c) => c.id === selectedCaseId);
									const features = (field.value as Record<string, boolean>) || {};
									const trainingType = selectedCase?.training_type || "history_taking";
									const toggleableKeys = Object.entries(ALL_CAPABILITIES)
										.filter(([, def]) => def.tier === "toggleable")
										.map(([k]) => k);
									const relevantKeys = toggleableKeys.filter(
										(k) => !ALL_CAPABILITIES[k].trainingTypes || ALL_CAPABILITIES[k].trainingTypes!.includes(trainingType)
									);
									return (
										<FormItem>
											<FormLabel>训练能力</FormLabel>
											<div className="space-y-2 py-1">
												{relevantKeys.length === 0 ? (
													<span className="text-xs text-muted-foreground">
														{selectedCaseId ? "该类型无可配置能力" : "请先选择病例"}
													</span>
												) : (
													relevantKeys.map((k) => (
														<label key={k} className="flex items-center gap-2 cursor-pointer text-sm">
															<input
																type="checkbox"
																checked={features[k] ?? false}
																onChange={(e) => {
																	const next = { ...features, [k]: e.target.checked };
																	for (const key of Object.keys(next)) {
																		if (!relevantKeys.includes(key)) delete next[key];
																	}
																	field.onChange(next);
																}}
																className="rounded border-border"
															/>
															<span>{ALL_CAPABILITIES[k]?.label ?? k}</span>
															<span className="text-xs text-muted-foreground">{ALL_CAPABILITIES[k]?.description ?? ""}</span>
														</label>
													))
												)}
											</div>
											<FormMessage />
										</FormItem>
									);
								}}
							/>
							<FormField
								control={form.control}
								name="is_active"
								render={({ field }) => (
									<FormItem>
										<div className="flex items-center gap-2 pt-2">
											<FormControl>
												<input
													type="checkbox"
													checked={field.value}
													onChange={(e) => field.onChange(e.target.checked)}
													className="rounded border-border"
												/>
											</FormControl>
											<FormLabel className="!mt-0 cursor-pointer">启用此练习模板</FormLabel>
										</div>
										<FormMessage />
									</FormItem>
								)}
							/>
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									onClick={() => setModalOpen(false)}
								>
									取消
								</Button>
								<Button onClick={form.handleSubmit(onSubmit)} disabled={form.formState.isSubmitting}>
									{form.formState.isSubmitting ? (editingId ? "保存中..." : "创建中...") : (editingId ? "保存" : "创建")}
								</Button>
							</DialogFooter>
						</form>
					</Form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
