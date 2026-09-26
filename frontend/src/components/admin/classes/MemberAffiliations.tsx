import { useQuery } from "@tanstack/react-query";
import { Anchor, Loader } from "@mantine/core";
import { useState } from "react";
import { getUsers } from "@/api/admin/users";
import { queryKeys } from "@/api/query-keys";
import type { UserMembershipItem } from "@/types/store";
import MembershipTags from "../users/MembershipTags";

interface MemberAffiliationsProps {
	userId: number;
	username: string;
	/** 当前班级：从展示中剔除，只列「其他」班级归属。 */
	currentClassId: number;
}

/**
 * 花名册里的「其他班级归属」。成员列表接口只带本班角色，因此按需拉取该用户的
 * 完整 memberships（按 username 精确定位），展开时才请求，不做整表 N+1。
 */
export default function MemberAffiliations({
	userId,
	username,
	currentClassId,
}: MemberAffiliationsProps) {
	const [expanded, setExpanded] = useState(false);

	const { data, isLoading } = useQuery({
		queryKey: queryKeys.admin.users.list({ search: username, limit: 20 }),
		queryFn: () => getUsers({ search: username, limit: 20 }).then((r) => r.data),
		enabled: expanded,
		staleTime: 5 * 60_000,
	});

	if (!expanded) {
		return (
			<Anchor
				component="button"
				type="button"
				size="xs"
				onClick={() => setExpanded(true)}
			>
				其他班级
			</Anchor>
		);
	}

	if (isLoading) {
		return <Loader size={12} color="gray" />;
	}

	const user = data?.items.find((u) => u.id === userId);
	const others: UserMembershipItem[] = (user?.memberships ?? []).filter(
		(m) => m.class_id !== currentClassId,
	);

	return (
		<MembershipTags
			memberships={others}
			emptyText="无其他班级"
			size="xs"
		/>
	);
}
