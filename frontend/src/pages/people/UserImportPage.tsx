import { Button, Group } from "@mantine/core";
import { IconUpload } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { batchCreateUsers, previewBatchUsers } from "@/api/admin/users";
import { queryKeys } from "@/api/query-keys";
import BatchImport from "@/components/admin/users/BatchImport";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import ErrorState from "@/components/ui/error-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import { useClassesQuery } from "@/hooks/useClasses";
import { getApiErrorMessage } from "@/utils/error";

/**
 * 用户批量导入页（`/admin/users/import`，权限 `user_manage`）。
 *
 * 从「用户管理 → 批量导入」弹窗搬出来：宽表、粘贴框、逐行预检结果需要的都是**整页高度**，
 * 弹窗里只能看到四行还得套两层滚动条。这里保留原解析/预检/提交三段（同一份
 * `BatchImport` 组件），页面只补三件事：班级字典的加载/失败/重试、离开前的未提交确认、
 * 与用户列表之间的往返入口。
 */
export default function UserImportPage() {
	const { confirm } = useConfirm();
	const toast = useToast();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [dirty, setDirty] = useState(false);
	const {
		data: classes = [],
		isLoading: classesLoading,
		isError: classesFailed,
		error: classesError,
		refetch: refetchClasses,
	} = useClassesQuery();

	const { mutateAsync: importUsers } = useMutation({
		mutationFn: (users: Parameters<typeof batchCreateUsers>[0]) =>
			batchCreateUsers(users).then((r) => r.data),
		onSuccess: () => {
			// 回执留在页面上核对；这里只负责让列表/班级在返回时是新的。
			queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all });
			queryClient.invalidateQueries({ queryKey: queryKeys.classes.all });
		},
		onError: (err: unknown) => {
			toast.apiError(err, "批量导入失败");
		},
	});

	// 离开确认：批量导入的粘贴内容与预检结果重做一次很贵，且预检后提交的是"确认过的名单"。
	// 页内入口走确认对话框；刷新/关标签页由 beforeunload 兜底，全部离开方式都被覆盖。
	const handleDirtyChange = useCallback((next: boolean) => setDirty(next), []);
	useEffect(() => {
		if (!dirty) return;
		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			// 现代浏览器只弹自己的默认文案，但阻止返回值仍必须给（否则不拦）。
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => window.removeEventListener("beforeunload", onBeforeUnload);
	}, [dirty]);

	const leaveGuard = useCallback(
		async (event: React.MouseEvent<HTMLAnchorElement>) => {
			if (!dirty) return;
			event.preventDefault();
			const href = event.currentTarget.getAttribute("href") ?? "/admin/users";
			const ok = await confirm({
				title: "离开批量导入",
				message: "当前粘贴的名单与预检结果不会保留，确定离开吗？",
				confirmLabel: "离开",
				danger: true,
			});
			if (ok) navigate(href);
		},
		[confirm, dirty, navigate],
	);

	return (
		<>
			<PageHeader
				title="批量导入学生"
				subtitle="上传或粘贴名单，预检后一次性创建账号"
				icon={IconUpload}
				actions={
					<Group gap={8}>
						<Button
							component={Link}
							to="/admin/users"
							variant="default"
							onClick={leaveGuard}
						>
							用户列表
						</Button>
					</Group>
				}
			/>
			{classesLoading ? (
				<LoadingSkeleton variant="table" />
			) : classesFailed ? (
				<ErrorState
					title="班级列表加载失败"
					error={classesError}
					description={`${getApiErrorMessage(classesError, "无法读取班级列表")}。没有班级字典就无法判断「届别 + 班级名」该并入哪个班，因此暂时不能导入。`}
					onRetry={() => refetchClasses()}
				/>
			) : (
				<BatchImport
					classes={classes}
					onImport={(users) => importUsers(users)}
					onPreview={(users) => previewBatchUsers(users).then((r) => r.data)}
					onDirtyChange={handleDirtyChange}
				/>
			)}
		</>
	);
}
