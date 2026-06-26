import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, ExternalLink, Plus, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { createSchool, deleteSchool, getSchools } from "@/api/api-client";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import DataTable, { type DataTableColumn } from "@/components/ui/data-table";
import {
	Dialog,
	DialogCancel,
	DialogContent,
	DialogFooter,
} from "@/components/ui/dialog";
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
import { SearchInput } from "@/components/ui/search-input";
import { useAdminList } from "@/hooks/useAdminList";
import { formatDate } from "@/utils/date";
import { type SchoolCreateValues, schoolCreateSchema } from "@/schemas/school";

type SchoolRow = Awaited<
	ReturnType<typeof getSchools>
>["data"]["items"][number];

const LIMIT = 50;

export default function SchoolsPage() {
	const toast = useToast();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { confirm } = useConfirm();

	const {
		items: schools,
		total,
		isLoading,
		searchInput,
		handleSearchChange,
		offset,
		limit,
		setOffset,
		showModal,
		openCreate,
		closeModal,
	} = useAdminList<SchoolRow>({
		queryKey: (p) => queryKeys.admin.schools.list(p.search, p.offset),
		queryFn: (p) =>
			getSchools({
				search: p.search || undefined,
				limit: p.limit,
				offset: p.offset,
			}).then((r) => r.data),
		limit: LIMIT,
		staleTime: 2 * 60_000,
	});

	const form = useForm<SchoolCreateValues>({
		resolver: zodResolver(schoolCreateSchema),
		defaultValues: {
			name: "",
			adminUsername: "",
			adminPassword: "",
			adminDisplayName: "",
		},
	});

	const createMutation = useMutation({
		mutationFn: (values: SchoolCreateValues) =>
			createSchool({
				name: values.name,
				admin_username: values.adminUsername,
				admin_password: values.adminPassword,
				admin_display_name: values.adminDisplayName,
			}),
		onSuccess: () => {
			toast.success("学校创建成功");
			form.reset();
			closeModal();
			queryClient.invalidateQueries({ queryKey: queryKeys.admin.schools.all });
		},
		onError: (e: unknown) => {
			toast.apiError(e, "创建失败");
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (id: number) => deleteSchool(id),
		onSuccess: () => {
			toast.success("学校已删除");
			queryClient.invalidateQueries({ queryKey: queryKeys.admin.schools.all });
		},
		onError: (e: unknown) => {
			toast.apiError(e, "删除失败");
		},
	});

	const handleDelete = async (id: number, schoolName: string) => {
		const ok = await confirm({
			title: "删除学校",
			message: `确定要删除学校「${schoolName}」？此操作不可恢复。`,
		});
		if (!ok) return;
		deleteMutation.mutate(id);
	};

	const onSubmit = async (values: SchoolCreateValues) => {
		try {
			await createMutation.mutateAsync(values);
		} catch {
			// error surfaced via createMutation.onError
		}
	};

	const columns: DataTableColumn<SchoolRow>[] = [
		{
			key: "name",
			header: "学校名称",
			cellClassName: "font-medium",
			render: (s) => s.name,
		},
		{ key: "teacher_count", header: "教师数", render: (s) => s.teacher_count },
		{ key: "student_count", header: "学生数", render: (s) => s.student_count },
		{
			key: "created_at",
			header: "创建时间",
			cellClassName: "text-muted-foreground",
			render: (s) => formatDate(s.created_at),
		},
		{
			key: "actions",
			header: "操作",
			render: (s) => (
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="sm"
						className="h-8 text-xs"
						onClick={(e) => {
							e.stopPropagation();
							navigate("/home");
						}}
						title="进入此学校管理"
					>
						<ExternalLink size={14} className="mr-1" />
						进入管理
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="text-destructive h-8"
						onClick={(e) => {
							e.stopPropagation();
							handleDelete(s.id, s.name);
						}}
					>
						<Trash2 size={14} />
					</Button>
				</div>
			),
		},
	];

	return (
		<div className="space-y-6">
			<PageHeader
				title="学校管理"
				subtitle="管理所有入驻学校及其管理员"
				actions={
					<Button
						onClick={() => {
							form.reset();
							openCreate();
						}}
					>
						<Plus size={16} /> 新建学校
					</Button>
				}
			/>

			<div className="flex items-center gap-3">
				<div className="flex-1 max-w-xs">
					<SearchInput
						value={searchInput}
						onChange={handleSearchChange}
						placeholder="搜索学校名称..."
					/>
				</div>
			</div>

			<DataTable
				columns={columns}
				rows={schools}
				rowKey={(s) => s.id}
				loading={isLoading}
				emptyIcon={Building2}
				emptyTitle="暂无学校"
				emptyDescription="创建第一个学校后这里会显示"
				total={total}
				offset={offset}
				limit={limit}
				onOffsetChange={setOffset}
			/>

			<Dialog
				open={showModal}
				onOpenChange={(o) => {
					if (!o) {
						form.reset();
						closeModal();
					}
				}}
			>
				<DialogContent title="新建学校" maxWidth={560}>
					<Form {...form}>
						<form
							onSubmit={form.handleSubmit(onSubmit)}
							className="space-y-4 py-2"
						>
							<FormField
								control={form.control}
								name="name"
								render={({ field }) => (
									<FormItem>
										<FormLabel>学校名称</FormLabel>
										<FormControl>
											<Input placeholder="例如：北京护理学院" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="adminUsername"
								render={({ field }) => (
									<FormItem>
										<FormLabel>管理员用户名</FormLabel>
										<FormControl>
											<Input placeholder="学校管理员账号" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="adminPassword"
								render={({ field }) => (
									<FormItem>
										<FormLabel>管理员密码</FormLabel>
										<FormControl>
											<Input type="password" placeholder="至少6位" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="adminDisplayName"
								render={({ field }) => (
									<FormItem>
										<FormLabel>管理员显示名</FormLabel>
										<FormControl>
											<Input placeholder="管理员姓名" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<DialogFooter>
								<DialogCancel type="button">取消</DialogCancel>
								<Button type="submit" disabled={form.formState.isSubmitting}>
									{form.formState.isSubmitting ? "创建中..." : "创建学校"}
								</Button>
							</DialogFooter>
						</form>
					</Form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
