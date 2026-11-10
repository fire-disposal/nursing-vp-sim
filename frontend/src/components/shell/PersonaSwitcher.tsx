import { Badge, Menu, SegmentedControl, Text, UnstyledButton } from "@mantine/core";
import { IconCheck, IconChevronDown, IconUserShield } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/components/Toast";
import { useSchoolsQuery } from "@/hooks/useSchools";
import useAuthStore from "@/stores/authStore";
import { usePersonaStore } from "@/stores/personaStore";
import {
	SCHOOL_MENU_REQUEST_EVENT,
	toScopedSchool,
	useSchoolScopeStore,
} from "@/stores/schoolScopeStore";
import {
	isPersonaId,
	isPlatformOnlyPersona,
	personaLabel,
	sortPersonas,
} from "@/utils/personas";

/**
 * 视角切换器 —— 只有被授予**多个**视角时才渲染（单视角用户看到一个只有一项的选择器
 * 只是噪声；`available` 为空 = 旧后端 / 未登录，同样不渲染）。
 *
 * 切换即换权限口径：`queryClient.clear()` 清掉全部缓存（保留请求中的查询无意义，
 * 它们的响应是旧视角下算的权限与数据）。这里不 `invalidateQueries`——换视角后旧
 * 查询键的内容整片失效，重取的开销一样，但残留的旧数据会先闪一下。
 */
export function PersonaSwitcher({ variant = "auto" }: { variant?: "auto" | "compact" | "segmented" }) {
	const available = usePersonaStore((s) => s.available);
	const active = usePersonaStore((s) => s.active);
	const setActive = usePersonaStore((s) => s.setActive);
	// 宿主必须是带 `QueryClientProvider` 的应用外壳（App.tsx 里恒有）。
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const toast = useToast();
	const isPlatform = useAuthStore((s) => s.user?.is_platform === true);
	// 只有一个院校时切视角可直接替用户选上；多个时由 ShellContextSwitchers 把菜单打开。
	const { data: schools = [] } = useSchoolsQuery({ enabled: isPlatform });

	if (available.length <= 1 || !active) return null;

	const onChange = async (next: string) => {
		if (next === active) return;
		// 平台账号的非 platform 视角必须有具体学校：不允许对“全部院校”行使教师/学生/管理数据面。
		// 只有一所院校 → 直接替用户选上（绝大多数部署都是单校，别让人多点一步）；
		// 多所 → 把院校菜单打开，下一步就是选择，而不是只弹一句提示。
		if (isPlatform && isPlatformOnlyPersona(next)) {
			// 平台 / 运维视角跨全部院校：残留的选校既不会收窄页面，也会让人误读当前范围。
			useSchoolScopeStore.getState().setSchool(null);
		} else if (isPlatform && !useSchoolScopeStore.getState().school) {
			// 其他视角必须有具体学校：不允许对“全部院校”行使教师/学生/管理数据面。
			if (schools.length === 1) {
				useSchoolScopeStore.getState().setSchool(toScopedSchool(schools[0]));
			} else {
				window.dispatchEvent(new Event(SCHOOL_MENU_REQUEST_EVENT));
				toast.warning("请先选择一所院校，再切换到该视角");
				return;
			}
		}
		setActive(next);
		// 换视角 = 换了权限口径：所有查询结果都不再成立
		queryClient.clear();
		// 权限集合是**按视角算的**：必须等 `/auth/me` 回话再决定落地页，
		// 否则 `/home` 仍按旧视角重定向（从平台切到管理会落到学生训练页）。
		// refreshUser 内部只清 401 会话，网络错误保留现有会话。
		await useAuthStore.getState().refreshUser();
		// 平台工作视图只在具备 `school_manage` 的视角里成立。切到院校视角后若继续带
		// `X-School-Scope`，会被后端静默收窄到某校，但顶栏已不再显示院校切换器——
		// 用户会以为在看全局。这里清掉，作用域与新视角的口径保持一致。
		// 平台账号的院校工作视图跨视角保留（A 校管理员 → B 校教师靠“先选校、再换视角”
		// 模拟）；普通账号只有一个院校，作用域本就不该存在。
		if (!useAuthStore.getState().user?.is_platform) {
			useSchoolScopeStore.getState().setSchool(null);
		}
		// 当前页可能在新视角下没有权限（如从 admin 切到 student 还停在 /admin/users）：
		// 回到首页，让路由门禁/导航从新口径重新决定去哪。
		navigate("/home", { replace: true });
	};

	const label = personaLabel(active) ?? active;
	const ordered = sortPersonas(available);

	if (variant === "segmented" || (variant === "auto" && available.length <= 3)) {
		return (
			<SegmentedControl
				size="xs"
				value={active}
				onChange={onChange}
				data={ordered.map((id) => ({ value: id, label: personaLabel(id) ?? id }))}
				aria-label="当前视角"
			/>
		);
	}

	return (
		<Menu position="bottom-start" width={180} withinPortal>
			<Menu.Target>
				<UnstyledButton aria-label="切换视角" title="切换视角（权限按视角生效）">
					<Badge
						variant="light"
						color="brand"
						size="sm"
						leftSection={<IconUserShield size={12} />}
						rightSection={<IconChevronDown size={11} />}
						style={{ textTransform: "none", cursor: "pointer" }}
					>
						{label}
					</Badge>
				</UnstyledButton>
			</Menu.Target>
			<Menu.Dropdown>
				<Menu.Label>当前视角</Menu.Label>
				{ordered.map((id) => {
					const itemLabel = personaLabel(id) ?? id;
					return (
						<Menu.Item
							key={id}
							onClick={() => onChange(id)}
							leftSection={
								id === active ? (
									<IconCheck size={14} />
								) : (
									<Text span size="xs" c="dimmed" style={{ width: 14, display: "inline-block" }} />
								)
							}
							rightSection={
								isPersonaId(id) ? undefined : (
									<Text size="xs" c="dimmed">
										自定义
									</Text>
								)
							}
						>
							{itemLabel}
						</Menu.Item>
					);
				})}
			</Menu.Dropdown>
		</Menu>
	);
}

export default PersonaSwitcher;
