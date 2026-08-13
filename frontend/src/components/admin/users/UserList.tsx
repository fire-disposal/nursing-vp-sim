import { IconEdit, IconTrash, IconUsers } from "@tabler/icons-react";
import {
	ActionIcon,
	Box,
	Center,
	Group,
	Loader,
	Paper,
	ScrollArea,
	Select,
	Text,
} from "@mantine/core";
import { useNavigate } from "react-router-dom";
import ClassFilter from "@/components/admin/ClassFilter";
import EmptyState from "@/components/ui/empty-state";
import Pagination from "@/components/ui/pagination";
import { Checkbox } from "@/components/ui/checkbox";
import { RoleBadge } from "@/components/ui/role-badge";
import { SearchInput } from "@/components/ui/search-input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
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
	selectedIds: Set<number>;
	onSearchChange: (value: string) => void;
	onRoleFilterChange: (value: string) => void;
	onClassFilterChange: (params: {
		grade_id: number | null;
		class_id: number | null;
	}) => void;
	onOffsetChange: (offset: number) => void;
	onEditUser: (user: UserBrief) => void;
	onDeleteUser: (user: UserBrief) => void;
	onToggleSelect: (userId: number) => void;
	onSelectAll: () => void;
	onDeselectAll: () => void;
}

export default function UserList({
	users,
	loading,
	total,
	offset,
	limit,
	roles,
	search,
	roleFilter,
	selectedIds,
	onSearchChange,
	onRoleFilterChange,
	onClassFilterChange,
	onOffsetChange,
	onEditUser,
	onDeleteUser,
	onToggleSelect,
	onSelectAll,
	onDeselectAll,
}: UserListProps) {
	const navigate = useNavigate();

	return (
		<Paper withBorder radius="lg" p="lg" shadow="sm">
			<Group gap={8} mb="md" wrap="wrap">
				<Box style={{ flex: "1 1 320px", maxWidth: 320 }}>
					<SearchInput
						value={search}
						onChange={onSearchChange}
						placeholder="搜索用户名、姓名或学号..."
					/>
				</Box>
				<Select
					value={roleFilter}
					onChange={(v) => onRoleFilterChange(v ?? "")}
					data={[
						{ value: "", label: "全部角色" },
						...roles.map((r) => ({ value: r.name, label: r.display_name })),
					]}
					allowDeselect={false}
					size="sm"
					w={140}
				/>
				<ClassFilter onChange={onClassFilterChange} />
				<Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap" }}>
					共 {total} 人
				</Text>
			</Group>
			{loading && users.length === 0 ? (
				<Center py={48}>
					<Loader size={24} color="gray" />
				</Center>
			) : users.length === 0 ? (
				<EmptyState
					icon={IconUsers}
					title="暂无用户"
					description="注册第一个用户后这里会显示"
				/>
			) : (
				<>
					<ScrollArea>
						<Table stickyHeader highlightOnHover>
							<TableHeader>
								<TableRow>
									<TableHead style={{ width: 40, textAlign: "center" }}>
										<Checkbox
											checked={
												users.length > 0 &&
												users.every((u) => selectedIds.has(u.id))
											}
											onCheckedChange={(checked) =>
												checked ? onSelectAll() : onDeselectAll()
											}
											aria-label="全选"
										/>
									</TableHead>
									<TableHead>用户名</TableHead>
									<TableHead>姓名</TableHead>
									<TableHead>角色</TableHead>
									<TableHead>班级</TableHead>
									<TableHead>学号</TableHead>
									<TableHead>注册时间</TableHead>
									<TableHead>操作</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{users.map((u) => (
									<TableRow
										key={u.id}
										onClick={() => navigate(`/admin/users/${u.id}`)}
										style={{
											cursor: "pointer",
											...(selectedIds.has(u.id) && {
												backgroundColor: "var(--mantine-color-teal-0)",
											}),
										}}
									>
										<TableCell
											style={{ textAlign: "center" }}
											onClick={(e) => e.stopPropagation()}
										>
											<Checkbox
												checked={selectedIds.has(u.id)}
												onCheckedChange={() => onToggleSelect(u.id)}
												aria-label={`选择 ${u.display_name}`}
											/>
										</TableCell>
										<TableCell>{u.username}</TableCell>
										<TableCell>{u.display_name}</TableCell>
										<TableCell>
											<RoleBadge
												role={u.role}
												label={
													roles.find((r) => r.name === u.role)
														?.display_name || u.role
												}
											/>
										</TableCell>
										<TableCell>
											<Text size="sm" c="dimmed">
												{u.grade_name && u.class_name
													? `${u.grade_name} ${u.class_name}`
													: u.class_name || "-"}
											</Text>
										</TableCell>
										<TableCell>
											<Text size="sm" c="dimmed">{u.student_id || "-"}</Text>
										</TableCell>
										<TableCell>
											<Text size="sm" c="dimmed">
												{new Date(u.created_at).toLocaleString("zh-CN")}
											</Text>
										</TableCell>
										<TableCell>
											<Group gap={4} wrap="nowrap">
												<ActionIcon
													variant="subtle"
													size="md"
													onClick={(e) => {
														e.stopPropagation();
														onEditUser(u);
													}}
													title="编辑"
													aria-label="编辑"
												>
													<IconEdit size={16} />
												</ActionIcon>
												<ActionIcon
													variant="subtle"
													color="red"
													size="md"
													onClick={(e) => {
														e.stopPropagation();
														onDeleteUser(u);
													}}
													title="删除"
													aria-label="删除"
												>
													<IconTrash size={16} />
												</ActionIcon>
											</Group>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</ScrollArea>
					<Pagination
						total={total}
						offset={offset}
						limit={limit}
						onChange={onOffsetChange}
					/>
				</>
			)}
		</Paper>
	);
}
