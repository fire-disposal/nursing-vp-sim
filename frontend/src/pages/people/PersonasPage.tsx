import {
	ActionBar,
	Badge,
	Button,
	Checkbox,
	Code,
	Divider,
	Grid,
	Group,
	Loader,
	Modal,
	Paper,
	SimpleGrid,
	Stack,
	Text,
	ThemeIcon,
	UnstyledButton,
} from "@mantine/core";
import {
	IconAlertTriangle,
	IconCheck,
	IconShield,
	IconUserSearch,
	IconUsers,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
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
import useAuthStore from "@/stores/authStore";

/** 作用域说明：这是本页最重要的信息——它决定「这个视角能看到哪些人的数据」。 */
const SCOPE_HINT: Record<PersonaScope, { zh: string; color: string }> = {
	platform: { zh: "平台级（跨院校）", color: "grape" },
	tenant: { zh: "全校数据", color: "blue" },
	self: { zh: "仅本人", color: "gray" },
};

/**
 * 未知作用域（后端新增而前端未升级）按原值显示：兜底成「仅本人」会让人误以为
 * 这个视角看不到别人的数据，实际恰恰可能相反。取色也用不表态的 gray。
 */
const UNKNOWN_SCOPE = { zh: "未知作用域", color: "gray" };

/** 作用域的一句话解释（详情面板里用，避免用户从"全校数据"自行推断边界）。 */
const SCOPE_SUMMARY: Record<PersonaScope, string> = {
	platform: "跨院校的平台级页面：院校管理、密钥、审计、成本与运维。",
	tenant: "本校范围的数据；班级只是校内分组与筛选，不改变可见边界。",
	self: "只访问自己的数据；看不到其他学生。",
};

/** 权限键 → 中文名。未知键原样显示（后端新增权限时前端不该把它吞成空白）。 */
const PERMISSION_LABELS = new Map(
	PERMISSION_DEFS.map((d) => [d.key as string, d.label]),
);

interface UserOption {
	id: number;
	username: string;
	display_name: string;
	student_id: string | null;
	/** 平台账号的视角由代码派生（全视角），不落授予行，因此不可编辑。 */
	is_platform?: boolean;
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
	// 平台视角只能授予平台账号：非平台操作者不展示它（后端同样拒绝）
	const isPlatformActor = useAuthStore((s) => s.user?.is_platform ?? false);
	const visiblePresets = isPlatformActor ? presets : presets.filter((p) => p.key !== "platform");
	// 主从布局：左侧选一个预设，右侧看它的完整权限（一次只占用一屏，避免长列表堆叠）。
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const selectedPreset =
		visiblePresets.find((p) => p.key === selectedKey) ?? visiblePresets[0] ?? null;

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
	const resultUsers = usersQuery.data?.items ?? [];
	const selectableUsers = resultUsers.filter((user) => !user.is_platform);
	const [selectedUsers, setSelectedUsers] = useState<Map<number, UserOption>>(new Map());
	const [batchOpen, setBatchOpen] = useState(false);
	const [batchDraft, setBatchDraft] = useState<string[]>([]);
	const [batchSaving, setBatchSaving] = useState(false);
	const allResultsSelected =
		selectableUsers.length > 0 && selectableUsers.every((user) => selectedUsers.has(user.id));
	const someResultsSelected =
		selectableUsers.some((user) => selectedUsers.has(user.id)) && !allResultsSelected;

	const toggleUser = (user: UserOption, selected: boolean) => {
		setSelectedUsers((prev) => {
			const next = new Map(prev);
			if (selected) next.set(user.id, user);
			else next.delete(user.id);
			return next;
		});
	};
	const toggleAllResults = (selected: boolean) => {
		setSelectedUsers((prev) => {
			const next = new Map(prev);
			for (const user of selectableUsers) {
				if (selected) next.set(user.id, user);
				else next.delete(user.id);
			}
			return next;
		});
	};

	const toggleBatch = (key: string, checked: boolean) => {
		setBatchDraft((prev) => {
			if (checked) return prev.includes(key) ? prev : [...prev, key];
			return prev.filter((item) => item !== key);
		});
	};

	// 批量授予 = 在每人现有视角上追加（不收回已有授予）；逐人读当前授予再写回。
	const saveBatch = async () => {
		if (batchDraft.length === 0) return;
		setBatchSaving(true);
		const targets = [...selectedUsers.values()];
		const results = await Promise.allSettled(
			targets.map(async (user) => {
				const { data: current } = await getUserPersonas(user.id);
				const next = [...new Set([...(current.personas ?? []), ...batchDraft])];
				await setUserPersonas(user.id, next);
			}),
		);
		const failed = results.filter((result) => result.status === "rejected").length;
		setBatchSaving(false);
		if (failed > 0) {
			toast.error(`批量授予完成，但 ${failed} 个账号失败`);
		} else {
			toast.success(`已为 ${targets.length} 个账号追加视角`, {
				description: batchDraft
					.map((key) => presets.find((preset) => preset.key === key)?.label ?? key)
					.join("、"),
			});
			setSelectedUsers(new Map());
			setBatchOpen(false);
			setBatchDraft([]);
			await presetsQuery.refetch();
		}
	};

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

	// 平台视角跨院校，只能授予平台账号（后端同样拒绝）。目标不是平台账号时，
	// 这张卡在弹窗里没有可执行意义，直接不展示。
	const grantOptions = visiblePresets.filter(
		(preset) => target?.is_platform || preset.key !== "platform",
	);

	return (
		<Stack gap="xl">
			<PageHeader
				title="视角管理"
				subtitle="视角 = 权限预设 + 数据作用域；给账号授予视角，用户可在其中切换"
				icon={IconShield}
			/>

			{/* ── 预设：左列表 / 右详情（主从布局，权限清单一次只展开一个） ── */}
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
					<Grid gap="md" align="stretch">
						<Grid.Col span={{ base: 12, md: 4, lg: 3 }} style={{ display: "flex" }}>
							<Paper withBorder radius="md" p={4} style={{ flex: 1 }}>
								<Stack gap={2}>
									{visiblePresets.map((preset) => (
										<PresetRow
											key={preset.key}
											preset={preset}
											active={preset.key === selectedPreset?.key}
											onClick={() => setSelectedKey(preset.key)}
										/>
									))}
								</Stack>
							</Paper>
						</Grid.Col>
						<Grid.Col span={{ base: 12, md: 8, lg: 9 }} style={{ display: "flex" }}>
							{selectedPreset ? (
								<PresetDetail preset={selectedPreset} />
							) : (
								<EmptyState icon={IconShield} title="选择一个视角" description="左侧选择要查看的视角预设" />
							)}
						</Grid.Col>
					</Grid>
				)}
			</Stack>

			{/* ── 用户检索 + 授予 ── */}
			<Paper withBorder p="md" radius="md">
				<Stack gap="md">
					<Group justify="space-between" align="center" wrap="wrap">
						<Text size="sm" fw={600}>
							给用户授予视角
						</Text>
						<Group gap="sm" wrap="nowrap">
							<Checkbox
								size="xs"
								label="全选结果"
								checked={allResultsSelected}
								indeterminate={someResultsSelected}
								disabled={selectableUsers.length === 0}
								onChange={(e) => toggleAllResults(e.currentTarget.checked)}
							/>
							<SearchInput
								value={searchInput}
								onChange={setSearchInput}
								placeholder="搜索用户名 / 姓名 / 学号…"
								aria-label="搜索用户"
							/>
						</Group>
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
									<Checkbox
										checked={selectedUsers.has(user.id)}
										disabled={user.is_platform}
										onChange={(e) => toggleUser(user, e.currentTarget.checked)}
										aria-label={`选择 ${user.display_name}`}
									/>
									<div style={{ minWidth: 0, flex: 1 }}>
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
									{user.is_platform ? (
										<Text size="xs" c="dimmed">
											平台账号 · 派生全部视角，不可编辑
										</Text>
									) : (
										<Button size="compact-sm" variant="light" onClick={() => openTarget(user)}>
											管理视角
										</Button>
									)}
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
							保存会替换该账号在本校的全部视角。账号可以同时持有多个视角，并在顶部切换当前生效的那一个。
						</Text>

						{grantOptions.length === 0 ? (
							<EmptyState
								icon={IconShield}
								title="没有可授予的视角"
								description="视角预设为空，或当前账号无权授予"
							/>
						) : (
							<Stack gap="xs">
								{grantOptions.map((preset) => {
									const hint =
										SCOPE_HINT[preset.scope as PersonaScope] ?? UNKNOWN_SCOPE;
									const checked = draft.includes(preset.key);
									const disabled = !preset.grantable;
									return (
										<Paper
											key={preset.key}
											withBorder
											p="sm"
											radius="sm"
											style={{
												cursor: disabled ? "not-allowed" : "pointer",
												opacity: disabled ? 0.55 : 1,
											}}
											onClick={() => {
												if (!disabled) toggle(preset.key, !checked);
											}}
										>
											<Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
												<Group gap="sm" align="flex-start" wrap="nowrap" style={{ minWidth: 0 }}>
													<Checkbox
														checked={checked}
														disabled={disabled}
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
																{hint.zh}
															</Badge>
														</Group>
														<Text size="xs" c="dimmed" mt={4} lh={1.5}>
															{preset.permissions
																.map((key) => PERMISSION_LABELS.get(key) ?? key)
																.join(" · ")}
														</Text>
														{disabled && (
															<Text size="xs" c="orange" mt={4}>
																超出你当前视角的权限，不能授予
															</Text>
														)}
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

						{draft.length === 0 && grantOptions.length > 0 && (
							<Group gap={6} align="flex-start" wrap="nowrap">
								<IconAlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
								<Text size="xs" c="dimmed">
									不勾选任何视角 = 收回该账号在本校的全部授予；没有视角的账号登录后只能看到个人资料。
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

			<ActionBar
				opened={selectedUsers.size > 0}
				onClose={() => setSelectedUsers(new Map())}
				shadow="md"
			>
				<Text size="sm" fw={500}>
					已选 {selectedUsers.size} 人
				</Text>
				<ActionBar.Divider />
				<Button
					size="compact-sm"
					onClick={() => {
						setBatchDraft([]);
						setBatchOpen(true);
					}}
				>
					批量授予视角
				</Button>
				<ActionBar.CloseButton />
			</ActionBar>

			<Modal
				opened={batchOpen}
				onClose={() => setBatchOpen(false)}
				title="批量授予视角"
				size="lg"
				centered
			>
				<Stack gap="md">
					<Text size="xs" c="dimmed">
						为已选的 {selectedUsers.size} 个账号追加视角；不会收回任何已有授予。
					</Text>
					<Stack gap="xs">
						{grantOptions.map((preset) => {
							const hint = SCOPE_HINT[preset.scope as PersonaScope] ?? UNKNOWN_SCOPE;
							const checked = batchDraft.includes(preset.key);
							const disabled = !preset.grantable;
							return (
								<Paper
									key={preset.key}
									withBorder
									p="sm"
									radius="sm"
									style={{ opacity: disabled ? 0.55 : 1 }}
								>
									<Group justify="space-between" wrap="nowrap" gap="sm">
										<Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
											<Checkbox
												checked={checked}
												disabled={disabled}
												onChange={(e) => toggleBatch(preset.key, e.currentTarget.checked)}
												aria-label={`批量授予 ${preset.label}`}
											/>
											<div style={{ minWidth: 0 }}>
												<Group gap={6} wrap="wrap">
													<Text size="sm" fw={500}>
														{preset.label}
													</Text>
													<Badge size="xs" variant="light" color={hint.color}>
														{hint.zh}
													</Badge>
													<Text size="xs" c="dimmed">
														{preset.permissions.length} 项权限
													</Text>
												</Group>
												{disabled && (
													<Text size="xs" c="orange" mt={2}>
														超出你当前视角的权限，不能授予
													</Text>
												)}
											</div>
										</Group>
									</Group>
								</Paper>
							);
						})}
					</Stack>
					<Group justify="space-between" mt="xs">
						<Text size="xs" c="dimmed">
							{batchDraft.length > 0
								? `将追加：${batchDraft
										.map((key) => presets.find((preset) => preset.key === key)?.label ?? key)
										.join("、")}`
								: "未选择视角"}
						</Text>
						<Group gap="xs">
							<Button variant="default" onClick={() => setBatchOpen(false)} disabled={batchSaving}>
								取消
							</Button>
							<Button
								onClick={() => void saveBatch()}
								loading={batchSaving}
								disabled={batchDraft.length === 0}
							>
								保存
							</Button>
						</Group>
					</Group>
				</Stack>
			</Modal>
		</Stack>
	);
}

/** 左侧预设行：名称、作用域、已授予人数；选中态由行背景表达。 */
function PresetRow({
	preset,
	active,
	onClick,
}: {
	preset: PersonaPreset;
	active: boolean;
	onClick: () => void;
}) {
	const hint = SCOPE_HINT[preset.scope as PersonaScope] ?? UNKNOWN_SCOPE;
	return (
		<UnstyledButton
			onClick={onClick}
			aria-pressed={active}
			style={{
				width: "100%",
				padding: "8px 10px",
				borderRadius: "var(--mantine-radius-sm)",
				background: active ? "var(--mantine-color-brand-light)" : undefined,
			}}
		>
			<Group justify="space-between" wrap="nowrap" gap="xs">
				<div style={{ minWidth: 0 }}>
					<Group gap={6} wrap="nowrap">
						<Text size="sm" fw={active ? 600 : 500} truncate>
							{preset.label}
						</Text>
						<Code fz="xs">{preset.key}</Code>
					</Group>
					<Group gap={8} mt={4} wrap="nowrap">
						<Badge size="xs" variant="light" color={hint.color}>
							{hint.zh}
						</Badge>
						<Group gap={3} wrap="nowrap">
							<IconUsers size={12} opacity={0.5} />
							<Text size="xs" c="dimmed" className="tabular-nums">
								{preset.user_count} 人
							</Text>
						</Group>
					</Group>
				</div>
			</Group>
		</UnstyledButton>
	);
}

/** 右侧详情：一次只展开一个预设的完整权限，宽屏下权限清单双列。 */
function PresetDetail({ preset }: { preset: PersonaPreset }) {
	const hint = SCOPE_HINT[preset.scope as PersonaScope] ?? UNKNOWN_SCOPE;
	const summary = SCOPE_SUMMARY[preset.scope as PersonaScope];
	return (
		<Paper withBorder radius="md" p="lg" h="100%">
			<Stack gap="md">
				<Group justify="space-between" align="flex-start" wrap="nowrap">
					<div style={{ minWidth: 0 }}>
						<Group gap={8} wrap="wrap">
							<Text size="lg" fw={600}>
								{preset.label}
							</Text>
							<Code fz="xs">{preset.key}</Code>
						</Group>
						<Group gap={6} mt={6} wrap="wrap">
							<Badge variant="light" color={hint.color}>
								{hint.zh}
							</Badge>
							{!preset.grantable && (
								<Badge variant="outline" color="gray">
									当前视角无权授予
								</Badge>
							)}
						</Group>
					</div>
					<Group gap={5} wrap="nowrap">
						<IconUsers size={15} opacity={0.5} />
						<Text size="sm" c="dimmed" className="tabular-nums">
							{preset.user_count} 人持有
						</Text>
					</Group>
				</Group>

				{summary && (
					<Text size="sm" c="dimmed">
						{summary}
					</Text>
				)}

				<Divider />

				<Group justify="space-between">
					<Text size="sm" fw={600}>
						权限
					</Text>
					<Text size="xs" c="dimmed">
						{preset.permissions.length} 项
					</Text>
				</Group>

				{preset.permissions.length === 0 ? (
					<Text size="sm" c="dimmed">
						无
					</Text>
				) : (
					<SimpleGrid cols={{ base: 1, sm: 2 }} spacing={6}>
						{preset.permissions.map((key) => (
							<Group key={key} gap={8} wrap="nowrap">
								<ThemeIcon size={18} radius="xl" variant="light" color="gray">
									<IconCheck size={11} />
								</ThemeIcon>
								<Text size="sm">{PERMISSION_LABELS.get(key) ?? key}</Text>
							</Group>
						))}
					</SimpleGrid>
				)}
			</Stack>
		</Paper>
	);
}
