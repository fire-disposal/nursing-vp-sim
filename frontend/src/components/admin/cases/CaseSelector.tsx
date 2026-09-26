import { IconCheck, IconSearch, IconSelector } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Box, Divider, Group, Loader, Mark, Paper, ScrollArea, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import { caseStatusLabel } from "./caseStatus";

export interface CaseOption {
	id: number;
	name: string;
	difficulty?: number;
	/** 生命周期：只应传入 published；非 published 会渲染为不可用提示。 */
	status?: string;
}

interface CaseSelectorProps {
	cases: CaseOption[];
	value: number;
	onChange: (id: number) => void;
	loading?: boolean;
	/** 无可选病例时的说明文案。 */
	emptyHint?: string;
}

const DIFFICULTY_LABELS: Record<number, string> = {
	1: "初级",
	2: "中级",
	3: "高级",
};

const DIFFICULTY_COLORS: Record<number, "success" | "warning" | "danger"> = {
	1: "success",
	2: "warning",
	3: "danger",
};

/** 生命周期徽章只在不可用时出现（已发布是常态，不必重复标注）。 */
function UnavailableStatusBadge({ status }: { status?: string }) {
	if (!status || status === "published") return null;
	return (
		<Badge variant="light" color="orange" size="xs">
			{caseStatusLabel(status)}·不可用
		</Badge>
	);
}

function highlightMatch(text: string, query: string) {
	if (!query.trim()) return <>{text}</>;
	const q = query.toLowerCase();
	const idx = text.toLowerCase().indexOf(q);
	if (idx === -1) return <>{text}</>;
	const before = text.slice(0, idx);
	const match = text.slice(idx, idx + q.length);
	const after = text.slice(idx + q.length);
	return (
		<>
			{before}
			<Mark color="yellow">{match}</Mark>
			{after}
		</>
	);
}

export default function CaseSelector({ cases, value, onChange, loading, emptyHint }: CaseSelectorProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const containerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const selected = useMemo(() => cases.find((c) => c.id === value), [cases, value]);

	const filtered = useMemo(() => {
		if (!search.trim()) return cases;
		const q = search.toLowerCase();
		return cases.filter((c) => {
			if (c.name.toLowerCase().includes(q)) return true;
			if (c.status && caseStatusLabel(c.status).toLowerCase().includes(q)) return true;
			if (c.difficulty != null) {
				const label = DIFFICULTY_LABELS[c.difficulty] || String(c.difficulty);
				if (label.toLowerCase().includes(q)) return true;
			}
			return false;
		});
	}, [cases, search]);

	useEffect(() => {
		setActiveIndex(0);
	}, [search]);

	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		if (open) {
			document.addEventListener("mousedown", handleClick);
			return () => document.removeEventListener("mousedown", handleClick);
		}
	}, [open]);

	useEffect(() => {
		if (open) {
			const timer = setTimeout(() => inputRef.current?.focus(), 0);
			return () => clearTimeout(timer);
		}
	}, [open]);

	useEffect(() => {
		if (!open || filtered.length === 0) return;
		const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
		el?.scrollIntoView({ block: "nearest" });
	}, [activeIndex, open, filtered.length]);

	const selectItem = useCallback(
		(id: number) => {
			onChange(id);
			setOpen(false);
			setSearch("");
		},
		[onChange],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (!open) return;
			switch (e.key) {
				case "ArrowDown":
					e.preventDefault();
					setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
					break;
				case "ArrowUp":
					e.preventDefault();
					setActiveIndex((i) => Math.max(i - 1, 0));
					break;
				case "Enter":
					e.preventDefault();
					if (filtered[activeIndex]) {
						selectItem(filtered[activeIndex].id);
					}
					break;
				case "Escape":
					e.preventDefault();
					setOpen(false);
					break;
			}
		},
		[open, filtered, activeIndex, selectItem],
	);

	const toggle = () => {
		if (open) {
			setOpen(false);
		} else {
			setSearch("");
			setActiveIndex(0);
			setOpen(true);
		}
	};

	return (
		<Box ref={containerRef} style={{ position: "relative" }}>
			<UnstyledButton
				onClick={toggle}
				w="100%"
				px="sm"
				py={6}
				style={{
					border: "1px solid var(--mantine-color-gray-4)",
					borderRadius: "var(--mantine-radius-sm)",
					background: "var(--mantine-color-body)",
				}}
			>
				<Group justify="space-between" gap={8} wrap="nowrap">
					<Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
						{selected ? (
							<>
								<Text size="sm" fw={500} truncate style={{ maxWidth: 220 }}>
									{selected.name}
								</Text>
								{selected.difficulty != null && (
									<Badge variant={DIFFICULTY_COLORS[selected.difficulty] ?? "neutral"} size="xs">
										{DIFFICULTY_LABELS[selected.difficulty] ?? selected.difficulty}
									</Badge>
								)}
								<UnavailableStatusBadge status={selected.status} />
							</>
						) : (
							<Text size="sm" c="dimmed">选择病例...</Text>
						)}
					</Group>
					<IconSelector size={14} style={{ flexShrink: 0, color: "var(--mantine-color-dimmed)" }} />
				</Group>
			</UnstyledButton>

			{open && (
				<Paper withBorder shadow="md" style={{ position: "absolute", zIndex: 50, marginTop: 4, width: "100%" }}>
					<TextInput
						ref={inputRef}
						variant="unstyled"
						placeholder="输入关键词搜索病例..."
						value={search}
						onChange={(e) => setSearch(e.currentTarget.value)}
						onKeyDown={handleKeyDown}
						leftSection={<IconSearch size={14} />}
						px="sm"
						py="xs"
					/>
					<Divider />
					<ScrollArea.Autosize mah={280}>
						{loading ? (
							<Group justify="center" gap={8} px="md" py="lg">
								<Loader size={14} />
								<Text size="sm" c="dimmed">加载中...</Text>
							</Group>
						) : filtered.length === 0 ? (
							<Text size="sm" c="dimmed" ta="center" px="md" py="lg">
								{search ? "无匹配病例" : emptyHint ?? "暂无可选病例"}
							</Text>
						) : (
							<Stack ref={listRef} gap={0} py={4}>
								{filtered.map((c, idx) => (
									<UnstyledButton
										key={c.id}
										onClick={() => selectItem(c.id)}
										onMouseEnter={() => setActiveIndex(idx)}
										display="block"
										w="100%"
										px="sm"
										py="xs"
										bg={
											idx === activeIndex
												? "var(--mantine-color-gray-1)"
												: c.id === value
													? "var(--mantine-color-blue-0)"
													: undefined
										}
									>
										<Group gap={8} wrap="nowrap">
											<IconCheck
												size={14}
												style={{
													flexShrink: 0,
													opacity: c.id === value ? 1 : 0,
													color: "var(--mantine-color-blue-6)",
												}}
											/>
											<Text size="sm" fw={500} truncate style={{ flex: 1 }}>
												{highlightMatch(c.name, search)}
											</Text>
											{c.difficulty != null && (
												<Badge variant={DIFFICULTY_COLORS[c.difficulty] ?? "neutral"} size="xs">
													{DIFFICULTY_LABELS[c.difficulty] ?? c.difficulty}
												</Badge>
											)}
											<UnavailableStatusBadge status={c.status} />
										</Group>
									</UnstyledButton>
								))}
							</Stack>
						)}
					</ScrollArea.Autosize>
				</Paper>
			)}
		</Box>
	);
}
