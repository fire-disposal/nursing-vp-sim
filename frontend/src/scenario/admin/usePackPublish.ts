import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/api/query-keys";
import {
	type ScenarioAdminPack,
	publishAdminScenarioPack,
	unpublishAdminScenarioPack,
} from "@/api/scenario";
import { toast } from "@/components/Toast";
import { getApiErrorDetail } from "@/utils/error";

/**
 * 上架 / 下架 —— **学生可见性的唯一开关**。
 *
 * 只有一个写者（这份 hook），所以「病例列表那一行的按钮」与「病例工作区里的上架状态块」
 * 不可能给出两种说法：两边都读同一个 `pack.published`，都走同一个 mutation。
 *
 * 失败时如实转述后端的话：上架前的内容校验不过会返回 422 + 逐条 `problems[]`，
 * 这时**不能**说成"上架失败请重试"——是内容还不合格，作者要改内容。
 */
export function usePackPublish() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		mutationFn: ({ key, publish }: { key: string; publish: boolean }) =>
			publish ? publishAdminScenarioPack(key) : unpublishAdminScenarioPack(key),
		onSuccess: (data: ScenarioAdminPack, vars) => {
			toast.success(
				vars.publish
					? `${data.title}：已上架，学生现在能看到它了`
					: `${data.title}：已下架，学生列表里不再出现（已有的会话照常回看）`,
			);
			void queryClient.invalidateQueries({ queryKey: queryKeys.scenario.admin.all });
		},
		onError: (error, vars) => toast.error(getApiErrorDetail(error, vars.publish ? "上架失败" : "下架失败")),
	});

	return {
		mutate: mutation.mutate,
		isPending: mutation.isPending,
	};
}
