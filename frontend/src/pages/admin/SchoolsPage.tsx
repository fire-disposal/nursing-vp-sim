import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Building2,
	ExternalLink,
	Loader2,
	Plus,
	Search,
	Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createSchool, deleteSchool, getSchools } from "@/api/api-client";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Modal from "@/components/ui/Modal";
import Pagination from "@/components/ui/Pagination";

export default function SchoolsPage() {
	const toast = useToast();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [showCreate, setShowCreate] = useState(false);
	const [name, setName] = useState("");
	const [adminUsername, setAdminUsername] = useState("");
	const [adminPassword, setAdminPassword] = useState("");
	const [adminDisplayName, setAdminDisplayName] = useState("");
	const [search, setSearch] = useState("");
	const [searchInput, setSearchInput] = useState("");
	const searchTimer = useRef<ReturnType<typeof setTimeout>>(null);
	const [offset, setOffset] = useState(0);
	const LIMIT = 50;
	const { confirm } = useConfirm();

	const handleSearchChange = (value: string) => {
		setSearchInput(value);
		if (searchTimer.current) clearTimeout(searchTimer.current);
		searchTimer.current = setTimeout(() => {
			setSearch(value);
			setOffset(0);
		}, 200);
	};

	const { data, isLoading } = useQuery({
		queryKey: ["schools", search, offset],
		queryFn: () =>
			getSchools({
				search: search || undefined,
				limit: LIMIT,
				offset,
			}).then((r) => r.data),
		staleTime: 2 * 60_000,
	});

	const schools = data?.items ?? [];
	const total = data?.total ?? 0;

	const resetForm = () => {
		setName("");
		setAdminUsername("");
		setAdminPassword("");
		setAdminDisplayName("");
	};

	const createMutation = useMutation({
		mutationFn: () =>
			createSchool({
				name,
				admin_username: adminUsername,
				admin_password: adminPassword,
				admin_display_name: adminDisplayName,
			}),
		onSuccess: () => {
			toast.success("学校创建成功");
			resetForm();
			setShowCreate(false);
			queryClient.invalidateQueries({ queryKey: ["schools"] });
		},
		onError: (e: unknown) => {
			const err = e as { response?: { data?: { detail?: string } } };
			toast.error(err.response?.data?.detail || "创建失败");
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (id: number) => deleteSchool(id),
		onSuccess: () => {
			toast.success("学校已删除");
			queryClient.invalidateQueries({ queryKey: ["schools"] });
		},
		onError: (e: unknown) => {
			const err = e as { response?: { data?: { detail?: string } } };
			toast.error(err.response?.data?.detail || "删除失败");
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

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-3 mb-4">
				<div className="relative flex-1 max-w-xs">
					<Search
						size={16}
						className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
					/>
					<input
						type="text"
						placeholder="搜索学校名称..."
						value={searchInput}
						onChange={(e) => handleSearchChange(e.target.value)}
						className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm bg-muted focus:outline-none focus:border-blue-500 focus:bg-card"
					/>
				</div>
				<Button onClick={() => setShowCreate(true)}>
					<Plus size={16} /> 新建学校
				</Button>
			</div>

			<div className="rounded-xl border bg-card">
				{isLoading ? (
					<div className="flex justify-center py-12">
						<Loader2
							size={24}
							className="animate-spin text-muted-foreground"
						/>
					</div>
				) : schools.length === 0 ? (
					<EmptyState
						icon={Building2}
						title="暂无学校"
						description="创建第一个学校后这里会显示"
					/>
				) : (
					<table className="w-full">
						<thead>
							<tr className="border-b text-left text-sm text-muted-foreground">
								<th className="px-4 py-3">学校名称</th>
								<th className="px-4 py-3">教师数</th>
								<th className="px-4 py-3">学生数</th>
								<th className="px-4 py-3">创建时间</th>
								<th className="px-4 py-3">操作</th>
							</tr>
						</thead>
						<tbody>
							{schools.map((s) => (
								<tr key={s.id} className="border-b last:border-0 text-sm">
									<td className="px-4 py-3 font-medium">{s.name}</td>
									<td className="px-4 py-3">{s.teacher_count}</td>
									<td className="px-4 py-3">{s.student_count}</td>
									<td className="px-4 py-3 text-muted-foreground">
										{s.created_at
											? new Date(s.created_at).toLocaleDateString()
											: ""}
									</td>
									<td className="px-4 py-3">
										<div className="flex items-center gap-1">
											<Button
												variant="ghost"
												size="sm"
												className="h-8 text-xs"
												onClick={() => navigate("/home")}
												title="进入此学校管理"
											>
												<ExternalLink size={14} className="mr-1" />
												进入管理
											</Button>
											<Button
												variant="ghost"
												size="sm"
												className="text-destructive h-8"
												onClick={() => handleDelete(s.id, s.name)}
											>
												<Trash2 size={14} />
											</Button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			{total > LIMIT && (
				<div className="mt-4 flex justify-center">
					<Pagination
						offset={offset}
						limit={LIMIT}
						total={total}
						onChange={(v) => setOffset(v)}
					/>
				</div>
			)}

			<Modal
				open={showCreate}
				onClose={() => {
					resetForm();
					setShowCreate(false);
				}}
				title="新建学校"
			>
				<div className="space-y-4 py-2">
					<div>
						<Label>学校名称</Label>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="例如：北京护理学院"
						/>
					</div>
					<div>
						<Label>管理员用户名</Label>
						<Input
							value={adminUsername}
							onChange={(e) => setAdminUsername(e.target.value)}
							placeholder="学校管理员账号"
						/>
					</div>
					<div>
						<Label>管理员密码</Label>
						<Input
							type="password"
							value={adminPassword}
							onChange={(e) => setAdminPassword(e.target.value)}
							placeholder="至少6位"
						/>
					</div>
					<div>
						<Label>管理员显示名</Label>
						<Input
							value={adminDisplayName}
							onChange={(e) => setAdminDisplayName(e.target.value)}
							placeholder="管理员姓名"
						/>
					</div>
					<Button
						className="w-full"
						onClick={() => createMutation.mutate()}
						disabled={createMutation.isPending}
					>
						{createMutation.isPending ? "创建中..." : "创建学校"}
					</Button>
				</div>
			</Modal>
		</div>
	);
}
