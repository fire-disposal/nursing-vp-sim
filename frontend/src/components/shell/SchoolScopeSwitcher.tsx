import { Select } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { SchoolItem } from "@/api/admin/schools";
import { useSchoolsQuery } from "@/hooks/useSchools";
import useAuthStore from "@/stores/authStore";
import { type ScopedSchool, schoolLogoUrl, useSchoolScopeStore } from "@/stores/schoolScopeStore";

/** 「全部院校」选项值：与数值 id 不会撞车。 */
const ALL_SCHOOLS = "all";

/** 院徽（无院徽时不渲染任何东西，不占位）。 */
export function SchoolLogo({ school, size = 18 }: { school: ScopedSchool | null; size?: number }) {
	if (!school?.hasLogo) return null;
	return (
		<img
			src={schoolLogoUrl(school)}
			alt=""
			width={size}
			height={size}
			style={{ borderRadius: 4, objectFit: "contain", display: "block" }}
		/>
	);
}

function toScoped(school: SchoolItem): ScopedSchool {
	return {
		id: school.id,
		name: school.name,
		themeColor: school.theme_color ?? null,
		hasLogo: !!school.has_logo,
		logoUpdatedAt: school.logo_updated_at ?? null,
	};
}

/**
 * 「当前院校」切换器 —— 只对平台角色渲染（`school_manage`）。
 *
 * 选择即作用域：列表/统计/新建都跟随，同时主题色与院徽跟着换（易于识别当前在谁的语境里）。
 * 「全部院校」= 平台视角（不发送 `X-School-Scope`）。
 *
 * 快照会与院校列表对齐：改名/换色/换院徽就地更新；院校被删则退回全部院校并让缓存重取。
 */
export function SchoolScopeSwitcher({ width = 200 }: { width?: number | string }) {
	const isPlatform = useAuthStore((s) => s.permissions.includes("school_manage"));
	const { data: schools = [] } = useSchoolsQuery({ enabled: isPlatform });
	const scoped = useSchoolScopeStore((s) => s.school);
	const setSchool = useSchoolScopeStore((s) => s.setSchool);
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!isPlatform || schools.length === 0 || !scoped) return;
		const current = schools.find((s) => s.id === scoped.id);
		if (!current) {
			setSchool(null);
			void queryClient.invalidateQueries();
			return;
		}
		const next = toScoped(current);
		if (
			next.name !== scoped.name ||
			next.themeColor !== scoped.themeColor ||
			next.hasLogo !== scoped.hasLogo ||
			next.logoUpdatedAt !== scoped.logoUpdatedAt
		) {
			setSchool(next);
		}
	}, [isPlatform, schools, scoped, setSchool, queryClient]);

	if (!isPlatform) return null;

	return (
		<Select
			aria-label="当前院校"
			title="切换当前院校：列表、统计与新建都会跟随，主题色随之变化"
			size="xs"
			w={width}
			allowDeselect={false}
			searchable={schools.length > 8}
			value={scoped ? String(scoped.id) : ALL_SCHOOLS}
			leftSection={scoped ? <SchoolLogo school={scoped} size={16} /> : undefined}
			data={[
				{ value: ALL_SCHOOLS, label: "全部院校" },
				...schools.map((school) => ({ value: String(school.id), label: school.name })),
			]}
			onChange={(value) => {
				if (!value) return;
				const next = value === ALL_SCHOOLS ? null : schools.find((s) => String(s.id) === value);
				setSchool(next ? toScoped(next) : null);
				// 作用域换了：所有院校维度的缓存都不再成立，让活动查询整体重取一次
				void queryClient.invalidateQueries();
			}}
			styles={{ input: { fontWeight: 600 } }}
		/>
	);
}
