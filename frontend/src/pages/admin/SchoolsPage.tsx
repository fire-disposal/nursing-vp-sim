import {
	Box,
	Button,
	Group,
	Modal,
	Stack,
	Text,
	TextInput,
	Tooltip,
} from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { IconSchool } from "@tabler/icons-react";
import { useState } from "react";
import { z } from "zod";

import type { SchoolItem } from "@/api/admin/schools";
import { useConfirm } from "@/components/ui/confirm";
import type { DataTableColumn } from "@/components/ui/data-table";
import ErrorState from "@/components/ui/error-state";
import { FilterToolbar } from "@/components/ui/filter-toolbar";
import PageHeader from "@/components/ui/page-header";
import ResponsiveTable from "@/components/ui/responsive-table";
import { SearchInput } from "@/components/ui/search-input";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import {
	useCreateSchool,
	useDeleteSchool,
	useSchoolsQuery,
	useUpdateSchool,
} from "@/hooks/useSchools";
import { formatDate } from "@/utils/date";

const schoolSchema = z.object({
	name: z.string().trim().min(1, "院校名称不能为空").max(80, "院校名称最多 80 字"),
});

type SchoolFormValues = z.infer<typeof schoolSchema>;

/**
 * 院校管理：租户边界的唯一入口（`school_manage`）。
 * 删除只允许删空院校 —— 有班级或账号时后端会 409，这里把原因原样呈现。
 */
export default function SchoolsPage() {
	const { searchInput, debouncedValue: search, handleSearchChange } = useDebouncedSearch();
	const [modalOpen, setModalOpen] = useState(false);
	const [editId, setEditId] = useState<number | null>(null);
	const { confirm } = useConfirm();

	const {
		data: schools = [],
		isLoading,
		isError,
		error,
		refetch,
	} = useSchoolsQuery();
	const createMut = useCreateSchool();
	const updateMut = useUpdateSchool();
	const deleteMut = useDeleteSchool();

	const form = useForm<SchoolFormValues>({
		initialValues: { name: "" },
		validate: schemaResolver(schoolSchema),
	});

	const openCreate = () => {
		setEditId(null);
		form.setValues({ name: "" });
		form.resetDirty();
		setModalOpen(true);
	};

	const openEdit = (item: SchoolItem) => {
		setEditId(item.id);
		form.setValues({ name: item.name });
		form.resetDirty();
		setModalOpen(true);
	};

	const closeModal = () => {
		setModalOpen(false);
		setEditId(null);
	};

	const onSubmit = async (values: SchoolFormValues) => {
		const name = values.name.trim();
		// 失败时保持弹窗与输入：关闭弹窗等于把用户刚输入的内容也一起丢掉，
		// 用户只能凭记忆重来一遍（错误提示已由 useApiMutation 统一弹出）。
		try {
			if (editId == null) {
				await createMut.mutateAsync({ name });
			} else {
				await updateMut.mutateAsync({ id: editId, name });
			}
			closeModal();
		} catch {
			/* toast 已提示，保留表单 */
		}
	};

	const handleDelete = async (item: SchoolItem) => {
		const ok = await confirm({
			title: "删除院校",
			message: `确定删除院校「${item.name}」吗？仅当该院校下没有班级和账号时才能删除。`,
			confirmLabel: "确定删除",
			danger: true,
		});
		if (!ok) return;
		deleteMut.mutate(item.id);
	};

	const filtered = search
		? schools.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
		: schools;

	const num = (v: number) => (
		<Text size="sm" ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>
			{v}
		</Text>
	);

	const columns: DataTableColumn<SchoolItem>[] = [
		{ key: "name", header: "院校名称", render: (s) => <Text size="sm" fw={500}>{s.name}</Text> },
		{
			key: "admin_count",
			header: "管理员",
			render: (s) =>
				s.admin_count > 0 ? (
					num(s.admin_count)
				) : (
					<Tooltip label="这所院校还没有管理员，账号与班级目前只能由平台创建">
						<Text size="sm" ta="right" c="orange" style={{ fontVariantNumeric: "tabular-nums" }}>
							0
						</Text>
					</Tooltip>
				),
		},
		{ key: "class_count", header: "班级数", render: (s) => num(s.class_count) },
		{ key: "user_count", header: "账号数", render: (s) => num(s.user_count) },
		{
			key: "created_at",
			header: "创建时间",
			render: (s) => <Text size="xs" c="dimmed">{formatDate(s.created_at)}</Text>,
		},
		{
			key: "actions",
			header: "操作",
			render: (s) => {
				const blocked = s.class_count + s.user_count > 0;
				const btn = (
					<Button
						variant="subtle"
						size="sm"
						color="red"
						disabled={blocked}
						onClick={() => handleDelete(s)}
					>
						删除
					</Button>
				);
				return (
					<Group gap={4} wrap="nowrap">
						<Button variant="subtle" color="gray" size="sm" onClick={() => openEdit(s)}>
							重命名
						</Button>
						{blocked ? (
							<Tooltip label={`该院校下还有 ${s.class_count} 个班级、${s.user_count} 个账号，先清空才能删除`}>
								<Box>{btn}</Box>
							</Tooltip>
						) : (
							btn
						)}
					</Group>
				);
			},
		},
	];

	return (
		<div>
			<PageHeader
				title="院校管理"
				subtitle="院校是数据隔离边界：每所院校只能看到自己的班级与账号"
				actions={
					/* 层级：本页唯一 filled = 新建院校（列表页的主行动是新增） */
					<Button onClick={openCreate}>新建院校</Button>
				}
			/>

			<FilterToolbar
				compact
				summary={`共 ${filtered.length} 所院校`}
				hasActiveFilters={Boolean(searchInput)}
				onClear={() => handleSearchChange("")}
				search={
					<SearchInput
						value={searchInput}
						onChange={handleSearchChange}
						placeholder="搜索院校名称..."
					/>
				}
			/>

			{isError ? (
				<ErrorState title="院校列表加载失败" error={error} onRetry={refetch} />
			) : (
				<ResponsiveTable<SchoolItem>
					columns={columns}
					rows={filtered}
					rowKey={(s) => s.id}
					renderCard={(s) => (
						<Stack gap={6}>
							<Text fw={500}>{s.name}</Text>
							<Text size="xs" c="dimmed">
								{s.class_count} 个班级 · {s.user_count} 个账号
							</Text>
							<Group gap={4}>
								<Button variant="subtle" color="gray" size="xs" onClick={() => openEdit(s)}>
									重命名
								</Button>
								<Button variant="subtle" color="red" size="xs" onClick={() => handleDelete(s)}>
									删除
								</Button>
							</Group>
						</Stack>
					)}
					loading={isLoading}
					bare
					emptyIcon={IconSchool}
					emptyTitle={search ? "没有匹配的院校" : "暂无院校"}
					emptyDescription={
						search ? "换个关键词试试" : "创建第一所院校后，班级与账号才能挂靠"
					}
				/>
			)}

			<Modal
				opened={modalOpen}
				onClose={closeModal}
				title={editId == null ? "新建院校" : "重命名院校"}
				centered
			>
				<form onSubmit={form.onSubmit(onSubmit)}>
					<Stack gap="md">
						<TextInput
							label="院校名称"
							withAsterisk
							placeholder="例如：杭州师范大学"
							{...form.getInputProps("name")}
						/>
						<Group justify="flex-end" gap={8}>
							<Button type="button" variant="default" onClick={closeModal}>
								取消
							</Button>
							<Button
								type="submit"
								disabled={createMut.isPending || updateMut.isPending}
							>
								{editId == null ? "创建" : "保存"}
							</Button>
						</Group>
					</Stack>
				</form>
			</Modal>
		</div>
	);
}
