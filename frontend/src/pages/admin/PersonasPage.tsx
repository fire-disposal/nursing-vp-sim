import {
	Badge,
	Button,
	Checkbox,
	Code,
	Divider,
	Group,
	Loader,
	Modal,
	Paper,
	SimpleGrid,
	Stack,
	Text,
	ThemeIcon,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import {
	IconAlertTriangle,
	IconCheck,
	IconShield,
	IconUserSearch,
	IconUsers,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	getPersonas,
	getUserPersonas,
	type PersonaPreset,
	type PersonaScope,
	setUserPersonas,
} from "@/api/admin/personas";
import { getUsers } from "@/api/admin/users";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { PERMISSION_DEFS } from "@/config/permissions.gen";

/** 作用域的中英说明：这是本页最重要的信息——它决定「这个视角能看到哪些人的数据」。 */
const SCOPE_HINT: Record<
	PersonaScope,
	{ zh: string; en: string; color: string }
> = {
	tenant: { zh: "全校数据", en: "Tenant-wide", color: "red" },
	class: { zh: "所带班级", en: "Own classes", color: "blue" },
	self: { zh: "仅本人", en: "Self only", color: "gray" },
};

/**
 * 未知作用域（后端新增而前端未升级）按原值显示：兜底成「仅本人」会让人误以为
 * 这个视角看不到别人的数据，实际恰恰可能相反。取色也用不表态的 gray。
 */
const UNKNOWN_SCOPE = { zh: "未知作用域", en: "Unknown scope", color: "gray" };

/** 权限键 → 中文名。未知键原样显示（后端新增权限时前端不该把它吞成空白）。 */
const PERMISSION_LABELS = new Map(
	PERMISSION_DEFS.map((d) => [d.key as string, d.label]),
);

interface UserOption {
	id: number;
	username: string;
	display_name: string;
	student_id: string | null;
}

interface UserListResponse {
	items: UserOption[];
	total: number;
}

export default function PersonasPage() {
	const toast = useToast();

	// ── 预设（四张卡） ──
	const presetsQuery = useQuery({
		queryKey: queryKeys.admin.personas,
		queryFn: () => getPersonas().then((r) => r.data),
		staleTime: 30_000,
	});
	const presets = presetsQuery.data ?? [];

	// ── 用户搜索 ──
	const [searchInput, setSearchInput] = useState("");
	const [search, setSearch] = useState("");
	// 防抖：输入即反馈、250ms 后才进请求（与其它列表页一致）
	useEffect(() => {
		const timer = setTimeout(() => setSearch(searchInput.trim()), 250);
		return () => clearTimeout(timer);
	}, [searchInput]);

	const usersQuery = useQuery({
		queryKey: queryKeys.admin.personasUsers(search),
		queryFn: () =>
			getUsers({ search: search || undefined, limit: 20, offset: 0 }).then(
				(r) => r.data as unknown as UserListResponse,
			),
		staleTime: 30_000,
		enabled: search.length > 0,
	});

	// ── 授予弹窗 ──
	const [target, setTarget] = useState<UserOption | null>(null);
	const [draft, setDraft] = useState<string[]>([]);
	const [saving, setSaving] = useState(false);
	// 打开弹窗时拉取的当前授予；用于「未改动就不提交」与失败后回退
	const loaded = useRef<string[]>([]);

	const targetQuery = useQuery({
		queryKey: queryKeys.admin.personasUser(target?.id ?? ""),
		queryFn: () => getUserPersonas(target?.id as number).then((r) => r.data),
		enabled: target != null,
		staleTime: 0,
	});

	const openTarget = useCallback((user: UserOption) => {
		loaded.current = [];
		setDraft([]);
		setTarget(user);
	}, []);

	useEffect(() => {
		if (!target || !targetQuery.data) return;
		const current = targetQuery.data.personas ?? [];
		loaded.current = current;
		setDraft(current);
	}, [target, targetQuery.data]);

	const closeModal = useCallback(() => {
		setTarget(null);
		setDraft([]);
		loaded.current = [];
	}, []);

	const toggle = (key: string, checked: boolean) => {
		setDraft((prev) => {
			if (checked) return prev.includes(key) ? prev : [...prev, key];
			return prev.filter((p) => p !== key);
		});
	};

	const dirty = useMemo(() => {
		const a = [...loaded.current].sort();
		const b = [...draft].sort();
		return a.length !== b.length || a.some((v, i) => v !== b[i]);
	}, [draft]);

	const save = async () => {
		if (!target) return;
		setSaving(true);
		try {
			await setUserPersonas(target.id, draft);
			toast.success("视角已更新", {
				description: `${target.display_name}：${draft.length > 0 ? `${draft.length} 个视角` : "未授予任何视角"}`,
			});
			closeModal();
			// 授予变了 → 各预设的「已授予人数」不再成立，必须重算
			await presetsQuery.refetch();
		} catch (e: unknown) {
			toast.apiError(e, "保存失败");
		} finally {
			setSaving(false);
		}
	};

	const labelByKey = useMemo(
		() => new Map(presets.map((p) => [p.key, p.label])),
		[presets],
	);

	return (
		<Stack gap="xl">
			<PageHeader
				title="视角管理"
				subtitle="视角 = 权限预设 + 数据作用域；给账号授予视角，用户可在其中切换"
				icon={IconShield}
			/>

			{/* ── 预设卡 ── */}
			<Stack gap="sm">
				<Group justify="space-between" align="center">
					<Text size="sm" fw={600}>
						视角预设
					</Text>
					<Button
						variant="subtle"
						size="compact-xs"
						color="gray"
						onClick={() => void presetsQuery.refetch()}
						loading={presetsQuery.isFetching}
					>
						刷新
					</Button>
				</Group>

				{presetsQuery.isLoading ? (
					<LoadingSkeleton variant="stats" />
				) : presetsQuery.isError ? (
					<ErrorState
						title="视角预设加载失败"
						error={presetsQuery.error}
						onRetry={() => void presetsQuery.refetch()}
					/>
				) : presets.length === 0 ? (
					<EmptyState
						icon={IconShield}
						title="暂无视角预设"
						description="后端尚未定义任何视角，或当前账号无权查看"
					/>
				) : (
					<SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
						{presets.map((preset) => (
							<PersonaCard key={preset.key} preset={preset} />
						))}
					</SimpleGrid>
				)}
			</Stack>

			{/* ── 用户检索 + 授予 ── */}
			<Paper withBorder p="md" radius="md">
				<Stack gap="md">
					<Group justify="space-between" align="center" wrap="wrap">
						<Text size="sm" fw={600}>
							给用户授予视角
						</Text>
						<SearchInput
							value={searchInput}
							onChange={setSearchInput}
							placeholder="搜索用户名 / 姓名 / 学号…"
							aria-label="搜索用户"
						/>
					</Group>

					{search.length === 0 ? (
						<EmptyState
							icon={IconUserSearch}
							title="搜索用户"
							description="输入用户名、姓名或学号，找到账号后打开授予弹窗"
						/>
					) : usersQuery.isLoading ? (
						<Group justify="center" py="md">
							<Loader size="sm" />
						</Group>
					) : usersQuery.isError ? (
						<ErrorState
							title="用户查询失败"
							error={usersQuery.error}
							onRetry={() => void usersQuery.refetch()}
						/>
					) : (usersQuery.data?.items ?? []).length === 0 ? (
						<EmptyState
							icon={IconUserSearch}
							title="没有匹配的用户"
							description={`没有找到与「${search}」匹配的账号`}
						/>
					) : (
						<Stack gap="xs">
							{(usersQuery.data?.items ?? []).map((user) => (
								<Group
									key={user.id}
									justify="space-between"
									wrap="nowrap"
									gap="sm"
									p="xs"
									style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
								>
									<div style={{ minWidth: 0 }}>
										<Text size="sm" fw={500} truncate>
											{user.display_name}
										</Text>
										<Group gap={6} wrap="nowrap">
											<Code fz="xs">{user.username}</Code>
											{user.student_id && (
												<Text size="xs" c="dimmed">
													{user.student_id}
												</Text>
											)}
										</Group>
									</div>
									<Button size="compact-sm" variant="light" onClick={() => openTarget(user)}>
										管理视角
									</Button>
								</Group>
							))}
							<Text size="xs" c="dimmed">
								仅显示前 20 条，缩小关键词以精确查找
							</Text>
						</Stack>
					)}
				</Stack>
			</Paper>

			{/* ── 授予弹窗 ── */}
			<Modal
				opened={target != null}
				onClose={closeModal}
				title={target ? `授予视角 · ${target.display_name}` : "授予视角"}
				size="lg"
				centered
			>
				{targetQuery.isLoading ? (
					<LoadingSkeleton variant="text" message="加载当前视角…" />
				) : targetQuery.isError ? (
					<ErrorState
						title="无法读取该用户的视角"
						error={targetQuery.error}
						onRetry={() => void targetQuery.refetch()}
					/>
				) : (
					<Stack gap="md">
						<Text size="xs" c="dimmed">
							勾选后保存即**替换**该账号的全部视角。用户可以同时持有多个视角，并在顶部切换当前生效的那一个。
						</Text>

						{presets.length === 0 ? (
							<EmptyState
								icon={IconShield}
								title="没有可授予的视角"
								description="视角预设为空，或当前账号无权授予"
							/>
						) : (
							<Stack gap="xs">
								{presets.map((preset) => {
									const hint =
										SCOPE_HINT[preset.scope as PersonaScope] ?? UNKNOWN_SCOPE;
									const checked = draft.includes(preset.key);
									return (
										<Paper
											key={preset.key}
											withBorder
											p="sm"
											radius="sm"
											style={{ cursor: "pointer" }}
											onClick={() => toggle(preset.key, !checked)}
										>
											<Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
												<Group gap="sm" align="flex-start" wrap="nowrap" style={{ minWidth: 0 }}>
													<Checkbox
														checked={checked}
														onChange={(e) => toggle(preset.key, e.currentTarget.checked)}
														onClick={(e) => e.stopPropagation()}
														aria-label={`授予 ${preset.label} 视角`}
													/>
													<div style={{ minWidth: 0 }}>
														<Group gap={6} wrap="wrap">
															<Text size="sm" fw={600}>
																{preset.label}
															</Text>
															<Code fz="xs">{preset.key}</Code>
															<Badge size="xs" variant="light" color={hint.color}>
																{hint.zh} / {hint.en}
															</Badge>
														</Group>
														<Text size="xs" c="dimmed" mt={4} lh={1.5}>
															{preset.permissions
																.map((key) => PERMISSION_LABELS.get(key) ?? key)
																.join(" · ")}
														</Text>
													</div>
												</Group>
												{checked && (
													<ThemeIcon size="sm" radius="xl" variant="light" color="teal">
														<IconCheck size={12} />
													</ThemeIcon>
												)}
											</Group>
										</Paper>
									);
								})}
							</Stack>
						)}

						{draft.length === 0 && presets.length > 0 && (
							<Group gap={6} align="flex-start" wrap="nowrap">
								<IconAlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
								<Text size="xs" c="dimmed">
									不勾选任何视角 = 收回全部视角，该账号将退回按角色权限推断的旧口径。
								</Text>
							</Group>
						)}

						<Group justify="space-between" mt="xs">
							<Text size="xs" c="dimmed">
								{target && draft.length > 0
									? `将授予：${draft.map((k) => labelByKey.get(k) ?? k).join("、")}`
									: "未选择视角"}
							</Text>
							<Group gap="xs">
								<Button variant="default" onClick={closeModal} disabled={saving}>
									取消
								</Button>
								<Button onClick={() => void save()} loading={saving} disabled={!dirty}>
									保存
								</Button>
							</Group>
						</Group>
					</Stack>
				)}
			</Modal>
		</Stack>
	);
}

/** 预设卡：名称 + 作用域（中英）+ 只读权限清单 + 已授予人数。 */
function PersonaCard({ preset }: { preset: PersonaPreset }) {
	const hint = SCOPE_HINT[preset.scope as PersonaScope] ?? UNKNOWN_SCOPE;
	return (
		<Paper withBorder p="md" radius="md">
			<Stack gap="sm" h="100%">
				<Group justify="space-between" align="flex-start" wrap="nowrap">
					<div style={{ minWidth: 0 }}>
						<Text fw={600} size="sm">
							{preset.label}
						</Text>
						<Code fz="xs">{preset.key}</Code>
					</div>
					<Group gap={6} wrap="nowrap">
						<IconUsers size={14} opacity={0.5} />
						<Text size="xs" c="dimmed" className="tabular-nums">
							{preset.user_count} 人
						</Text>
					</Group>
				</Group>

				<div>
					<Badge size="xs" variant="light" color={hint.color}>
						{hint.zh}
					</Badge>
					<Text size="xs" c="dimmed" mt={4}>
						{hint.en}
					</Text>
				</div>

				<Divider />

				<Stack gap={4} style={{ flex: 1 }}>
					<Text size="xs" fw={500} c="dimmed">
						权限（{preset.permissions.length}）
					</Text>
					{preset.permissions.length === 0 ? (
						<Text size="xs" c="dimmed">
							无
						</Text>
					) : (
						preset.permissions.map((key) => (
							<Group key={key} gap={6} wrap="nowrap">
								<IconCheck size={12} opacity={0.4} />
								<Text size="xs">{PERMISSION_LABELS.get(key) ?? key}</Text>
							</Group>
						))
					)}
				</Stack>
			</Stack>
		</Paper>
	);
}
