import { Edit3, Loader2, Search, Trash2, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import ClassFilter from "@/components/teacher/ClassFilter";
import EmptyState from "@/components/ui/EmptyState";
import Pagination from "@/components/ui/Pagination";
import { cn } from "@/lib/utils";
import type { RoleOption, UserBrief } from "./types";

interface UserListProps {
	users: UserBrief[];
	loading: boolean;
	total: number;
	offset: number;
	limit: number;
	roles: RoleOption[];
	search: string;
	roleFilter: string;
	onSearchChange: (value: string) => void;
	onRoleFilterChange: (value: string) => void;
	onClassFilterChange: (params: {
		grade_id: number | null;
		class_id: number | null;
	}) => void;
	onOffsetChange: (offset: number) => void;
	onEditUser: (user: UserBrief) => void;
	onDeleteUser: (user: UserBrief) => void;
}

const filterSelectClass =
	"py-1.5 px-2.5 border border-border rounded-lg text-sm bg-card";

const btnDanger =
	"inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg bg-destructive/10 text-destructive hover:bg-red-200 transition-colors border-none cursor-pointer";

export default function UserList({
	users,
	loading,
	total,
	offset,
	limit,
	roles,
	search,
	roleFilter,
	onSearchChange,
	onRoleFilterChange,
	onClassFilterChange,
	onOffsetChange,
	onEditUser,
	onDeleteUser,
}: UserListProps) {
	const navigate = useNavigate();

	return (
		<div className="rounded-xl border border-border bg-card shadow-sm p-6">
			<div className="mb-3 flex gap-2 items-center">
				<div className="relative flex-1 max-w-[320px]">
					<Search
						size={14}
						className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70"
					/>
					<input
						type="text"
						placeholder="搜索用户名、姓名或学号..."
						value={search}
						onChange={(e) => onSearchChange(e.target.value)}
						className="w-full py-1.5 pl-[30px] pr-2.5 border border-border rounded-lg text-sm"
					/>
				</div>
				<select
					value={roleFilter}
					onChange={(e) => onRoleFilterChange(e.target.value)}
					className={filterSelectClass}
				>
					<option value="">全部角色</option>
					{roles.map((r) => (
						<option key={r.name} value={r.name}>
							{r.display_name}
						</option>
					))}
				</select>
				<ClassFilter onChange={onClassFilterChange} />
				<span className="text-sm text-muted-foreground whitespace-nowrap">
					共 {total} 人
				</span>
			</div>
			{loading && users.length === 0 ? (
				<div className="flex justify-center py-12">
					<Loader2 size={24} className="animate-spin text-muted-foreground" />
				</div>
			) : users.length === 0 ? (
				<EmptyState
					icon={Users}
					title="暂无用户"
					description="注册第一个用户后这里会显示"
				/>
			) : (
				<>
					<div className="overflow-x-auto">
						<table className="w-full border-collapse text-sm">
							<thead>
								<tr>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										用户名
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										姓名
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										角色
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										班级
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										学号
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										注册时间
									</th>
									<th className="sticky top-0 z-10 text-left px-4 py-2.5 bg-muted text-muted-foreground font-semibold text-xs uppercase tracking-wider border-b border-border">
										操作
									</th>
								</tr>
							</thead>
							<tbody>
								{users.map((u) => (
									<tr
										key={u.id}
										className="cursor-pointer hover:bg-muted"
										onClick={() => navigate(`/admin/users/${u.id}`)}
									>
										<td className="px-4 py-3 border-b border-border">
											{u.username}
										</td>
										<td className="px-4 py-3 border-b border-border">
											{u.display_name}
										</td>
										<td className="px-4 py-3 border-b border-border">
											<span
												className={cn(
													"inline-block px-2.5 py-0.5 rounded-xl text-xs font-semibold",
													u.role === "super_admin" || u.role === "school_admin"
														? "bg-red-50 text-red-700"
														: u.role === "teacher"
															? "bg-blue-50 text-primary"
															: "bg-green-50 text-green-700",
												)}
											>
												{roles.find((r) => r.name === u.role)?.display_name ||
													u.role}
											</span>
										</td>
										<td className="px-4 py-3 border-b border-border text-muted-foreground text-sm">
											{u.grade_name && u.class_name
												? `${u.grade_name} ${u.class_name}`
												: u.class_name || "-"}
										</td>
										<td className="px-4 py-3 border-b border-border text-muted-foreground">
											{u.student_id || "-"}
										</td>
										<td className="px-4 py-3 border-b border-border text-sm text-muted-foreground">
											{new Date(u.created_at).toLocaleString("zh-CN")}
										</td>
										<td className="px-4 py-3 border-b border-border">
											<div className="flex gap-2">
												<button
													className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors border-none cursor-pointer"
													onClick={(e) => {
														e.stopPropagation();
														onEditUser(u);
													}}
													title="编辑"
												>
													<Edit3 size={14} />
												</button>
												<button
													className={btnDanger}
													onClick={(e) => {
														e.stopPropagation();
														onDeleteUser(u);
													}}
													title="删除"
												>
													<Trash2 size={14} />
												</button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<Pagination
						total={total}
						offset={offset}
						limit={limit}
						onChange={onOffsetChange}
					/>
				</>
			)}
		</div>
	);
}
