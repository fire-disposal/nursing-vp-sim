import {
	Badge,
	Button,
	Checkbox,
	Group,
	Loader,
	Paper,
	ScrollArea,
	Stack,
	Text,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { getClassMembers } from "@/api/classes";
import { queryKeys } from "@/api/query-keys";
import { SearchInput } from "@/components/ui/search-input";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";

interface AudienceSelectorProps {
	classId: number;
	value: number[];
	onChange: (userIds: number[]) => void;
	disabled?: boolean;
}

/**
 * 指定学生受众选择器：数据源是「该班学生成员」（与学生名单/统计同一口径），
 * 支持服务端搜索过滤。已选集合独立于当前搜索结果保留，避免翻查时丢选。
 */
export default function AudienceSelector({
	classId,
	value,
	onChange,
	disabled,
}: AudienceSelectorProps) {
	const { searchInput, debouncedValue, handleSearchChange } = useDebouncedSearch();
	const selected = new Set(value);

	const { data, isLoading } = useQuery({
		queryKey: queryKeys.classes.members(classId, {
			role: "student",
			search: debouncedValue,
			limit: 200,
		}),
		queryFn: () =>
			getClassMembers(classId, {
				role: "student",
				search: debouncedValue || undefined,
				limit: 200,
			}).then((r) => r.data),
		enabled: classId > 0,
		staleTime: 60_000,
	});

	const members = data?.items ?? [];
	const total = data?.total ?? 0;

	const commit = (next: Set<number>) => {
		onChange([...next].sort((a, b) => a - b));
	};

	const toggle = (userId: number, checked: boolean) => {
		const next = new Set(value);
		if (checked) next.add(userId);
		else next.delete(userId);
		commit(next);
	};

	return (
		<Stack gap={8}>
			<Group gap={8} wrap="wrap">
				<Text size="xs" c="dimmed">
					已选 {selected.size} 名学生
				</Text>
				<Button
					size="compact-xs"
					variant="subtle"
					disabled={disabled || members.length === 0}
					onClick={() => {
						const next = new Set(selected);
						for (const m of members) next.add(m.user_id);
						commit(next);
					}}
				>
					全选当前结果
				</Button>
				<Button
					size="compact-xs"
					variant="subtle"
					color="gray"
					disabled={disabled || selected.size === 0}
					onClick={() => commit(new Set())}
				>
					清空
				</Button>
			</Group>
			<SearchInput
				value={searchInput}
				onChange={handleSearchChange}
				placeholder="搜索姓名、用户名或学号..."
			/>
			<Paper withBorder radius="sm" p="xs">
				<ScrollArea h={220}>
					{isLoading ? (
						<Group justify="center" py="lg">
							<Loader size="sm" />
						</Group>
					) : members.length === 0 ? (
						<Text size="sm" c="dimmed" ta="center" py="lg">
							{debouncedValue ? "没有匹配的学生" : "该班暂无学生成员"}
						</Text>
					) : (
						<Stack gap={6}>
							{members.map((m) => (
								<Group key={m.user_id} gap={8} wrap="nowrap">
									<Checkbox
										checked={selected.has(m.user_id)}
										disabled={disabled}
										onChange={(e) => toggle(m.user_id, e.currentTarget.checked)}
										aria-label={`选择 ${m.display_name}`}
									/>
									<Text size="sm" truncate style={{ flex: 1 }}>
										{m.display_name}
										<Text component="span" size="xs" c="dimmed" ml={6}>
											{m.username}
											{m.student_id ? ` · ${m.student_id}` : ""}
										</Text>
									</Text>
								</Group>
							))}
						</Stack>
					)}
				</ScrollArea>
			</Paper>
			<Group gap={8}>
				<Text size="xs" c="dimmed">
					该班学生成员共 {total} 人
				</Text>
				<Badge size="xs" variant="light" color="blue">
					已选 {selected.size}
				</Badge>
			</Group>
		</Stack>
	);
}
