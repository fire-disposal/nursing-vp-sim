import { Badge, Menu, SegmentedControl, Text, UnstyledButton } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { IconCheck, IconUserShield } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import useAuthStore from "@/stores/authStore";
import { usePersonaStore } from "@/stores/personaStore";
import { isPersonaId, personaLabel, sortPersonas } from "@/utils/personas";

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

	if (available.length <= 1 || !active) return null;

	const onChange = (next: string) => {
		if (next === active) return;
		setActive(next);
		// 换视角 = 换了权限口径：所有查询结果都不再成立
		queryClient.clear();
		// 权限集合是**按视角算的**：不重取 `/auth/me` 的话，路由门禁仍在用旧视角的
		// `permissions`（从 admin 切到 student 后 `user_manage` 还挂着，或反过来被挡）。
		// 失败不动会话（refreshUser 内部只在 401 时清会话）。
		void useAuthStore.getState().refreshUser();
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
