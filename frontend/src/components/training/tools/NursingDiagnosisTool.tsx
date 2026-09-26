// Save（lucide）在 tabler 无同名图标，语义上取 IconDeviceFloppy（软盘保存）。
import { IconArrowDown, IconArrowUp, IconDeviceFloppy, IconPlus, IconTrash } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActionIcon, Box, Button, Group, Text } from "@mantine/core";
import type { ActivityPanelProps } from "@/components/training/workspace/contract";

interface Diagnosis {
	id: string;
	problem: string;
	related_factors: string[];
	defining_characteristics: string[];
	priority: number;
}

/** 服务端只持久化诊断内容：保存时本地 id 被剥离（见 doSave），回读时需补回稳定 id。 */
type PersistedDiagnosis = Omit<Diagnosis, "id"> & { id?: string };

export default function NursingDiagnosisTool({ activity, bus, recordId }: ActivityPanelProps) {
	/** 命令命名空间来自 manifest 的 activity 定义 */
	const command = activity.id;
	const rid = Number(recordId);
	const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
	const [stems, setStems] = useState<string[]>([]);
	const [factorOpts, setFactorOpts] = useState<string[]>([]);
	const [charOpts, setCharOpts] = useState<string[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [editId, setEditId] = useState<string | null>(null);
	const idCounter = useRef(0);

	// ── Load ──
	const loadedRef = useRef(false);
	useEffect(() => {
		if (loadedRef.current) return;
		loadedRef.current = true;
		bus.emit("tool:invoke", { tool: command, action: "load", params: {}, recordId: rid });
	}, [rid, bus, command]);

	useEffect(() => {
		// `tool:result` 载荷没有 type 字段（见 useToolBridge）：事件名已由 bus 过滤，
		// 这里只按 tool/action 收敛，避免误吞其他工具或动作的结果。
		const handler = (payload: {
			tool?: string;
			action?: string;
			ok?: boolean;
			data?: {
				diagnoses?: PersistedDiagnosis[];
				stems?: string[];
				factor_options?: string[];
				characteristic_options?: string[];
			};
		}) => {
			if (payload.tool !== command || payload.action !== "load") return;
			if (payload.ok && payload.data) {
				// 回读补 id：列表 key、编辑定位与删除都以 id 为准。
				const rows = Array.isArray(payload.data.diagnoses) ? payload.data.diagnoses : [];
				setDiagnoses(rows.map((d, i) => ({ ...d, id: d.id || `srv-${i + 1}` })));
				setStems(payload.data.stems ?? []);
				setFactorOpts(payload.data.factor_options ?? []);
				setCharOpts(payload.data.characteristic_options ?? []);
				idCounter.current = rows.length;
			}
			setLoading(false);
		};
		bus.on("tool:result", handler);
		return () => { bus.off("tool:result", handler); };
	}, [bus, command]);

	// ── Save ──
	const doSave = useCallback(() => {
		setSaving(true);
		bus.emit("tool:invoke", {
			tool: command, action: "save",
			params: { diagnoses: diagnoses.map(({ id, ...rest }) => rest) },
			recordId: rid,
		});
		setTimeout(() => setSaving(false), 800);
	}, [bus, command, rid, diagnoses]);

	// ── Edit form state ──
	const emptyForm = { problem: "", related_factors: [] as string[], defining_characteristics: [] as string[] };
	const [form, setForm] = useState(emptyForm);

	const openNew = () => { setForm(emptyForm); setEditId("__new__"); };
	const openEdit = (d: Diagnosis) => {
		setForm({ problem: d.problem, related_factors: [...d.related_factors], defining_characteristics: [...d.defining_characteristics] });
		setEditId(d.id);
	};

	const saveForm = () => {
		if (!form.problem.trim()) return;
		if (editId === "__new__") {
			const id = String(++idCounter.current);
			setDiagnoses(prev => [...prev, { id, ...form, priority: prev.length }]);
		} else {
			setDiagnoses(prev => prev.map(d => d.id === editId ? { ...d, ...form } : d));
		}
		setEditId(null);
	};

	const deleteDiag = (id: string) => setDiagnoses(prev => prev.filter(d => d.id !== id));

	const move = (idx: number, dir: -1 | 1) => {
		setDiagnoses(prev => {
			const next = [...prev];
			const target = idx + dir;
			if (target < 0 || target >= next.length) return prev;
			[next[idx], next[target]] = [next[target], next[idx]];
			return next.map((d, i) => ({ ...d, priority: i }));
		});
	};

	const toggleItem = (list: string[], item: string) =>
		list.includes(item) ? list.filter(i => i !== item) : [...list, item];

	// ── Render ──
	if (loading) {
		return <Box style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 80 }}><Text size="xs" c="dimmed">加载中…</Text></Box>;
	}
	return (
		<Box style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--mantine-color-body)" }}>
			<Group
				justify="space-between"
				wrap="nowrap"
				px="sm"
				py={10}
				style={{ borderBottom: "1px solid var(--mantine-color-default-border)", flexShrink: 0 }}
			>
				<Text size="xs" fw={600}>护理诊断</Text>
				<Group gap={4} wrap="nowrap">
					<Text size="xs" c="dimmed">{diagnoses.length} 条</Text>
					<ActionIcon variant="subtle" color="gray" size="sm" onClick={openNew} aria-label="添加护理诊断">
						<IconPlus size={14} />
					</ActionIcon>
				</Group>
			</Group>

			<Box style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
				{diagnoses.length === 0 && !editId && (
					<Text size="xs" c="dimmed" ta="center" py={32}>
						点击 + 添加护理诊断，按优先级排序
					</Text>
				)}

				{diagnoses.map((d, i) => (
					<Box
						key={d.id}
						p="sm"
						style={{
							borderRadius: 12,
							border: "1px solid var(--mantine-color-default-border)",
							background: "var(--mantine-color-body)",
						}}
					>
						<Group align="flex-start" gap={8} wrap="nowrap">
							<Box style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, flexShrink: 0, marginTop: 2 }}>
								<ActionIcon variant="subtle" color="gray" size="xs" onClick={() => move(i, -1)} disabled={i === 0}>
									<IconArrowUp size={12} />
								</ActionIcon>
								<Text size="xs" fw={700} c="dimmed" w={16} ta="center">{i + 1}</Text>
								<ActionIcon variant="subtle" color="gray" size="xs" onClick={() => move(i, 1)} disabled={i === diagnoses.length - 1}>
									<IconArrowDown size={12} />
								</ActionIcon>
							</Box>
							<Box style={{ flex: 1, minWidth: 0 }}>
								<Box component="button" type="button" onClick={() => openEdit(d)} style={{ textAlign: "left", width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
									<Text size="sm" fw={500} truncate>{d.problem}</Text>
									<Group gap={4} mt={6} wrap="wrap">
										{d.related_factors.map(f => (
											<Box key={f} px={6} py={2} style={{ fontSize: 10, borderRadius: 4, background: "var(--mantine-color-blue-0)", color: "var(--mantine-color-blue-9)" }}>
												{f}
											</Box>
										))}
										{d.defining_characteristics.map(c => (
											<Box key={c} px={6} py={2} style={{ fontSize: 10, borderRadius: 4, background: "var(--mantine-color-yellow-0)", color: "var(--mantine-color-yellow-9)" }}>
												{c}
											</Box>
										))}
									</Group>
								</Box>
							</Box>
							<ActionIcon variant="subtle" color="gray" size="sm" onClick={() => deleteDiag(d.id)} aria-label="删除护理诊断" style={{ color: "var(--mantine-color-gray-5)" }}>
								<IconTrash size={12} />
							</ActionIcon>
						</Group>
					</Box>
				))}
			</Box>

			{/* Edit panel */}
			{editId && (
				<Box
					p="sm"
					style={{
						borderTop: "1px solid var(--mantine-color-default-border)",
						background: "var(--mantine-color-body)",
						display: "flex",
						flexDirection: "column",
						gap: 12,
						flexShrink: 0,
					}}
				>
					<input
						value={form.problem}
						onChange={e => setForm(p => ({ ...p, problem: e.target.value }))}
						placeholder="护理问题（如：清理呼吸道无效）"
						list="diag-stems"
						style={{
							width: "100%",
							fontSize: 14,
							padding: "8px 12px",
							borderRadius: 8,
							border: "1px solid var(--mantine-color-default-border)",
							background: "var(--mantine-color-body)",
							color: "var(--mantine-color-text)",
							fontFamily: "inherit",
						}}
					/>
					<datalist id="diag-stems">{stems.map(s => <option key={s} value={s} />)}</datalist>

					<Box>
						<Text size="xs" c="dimmed" mb={6} fw={600}>相关因素</Text>
						<Group gap={4} wrap="wrap">
							{factorOpts.map(f => (
								<Box
									key={f}
									component="button"
									type="button"
									onClick={() => setForm(p => ({ ...p, related_factors: toggleItem(p.related_factors, f) }))}
									px={8}
									py={2}
									style={{
										fontSize: 10,
										borderRadius: 999,
										border: "1px solid var(--mantine-color-default-border)",
										cursor: "pointer",
										background: form.related_factors.includes(f) ? "var(--mantine-color-blue-0)" : "transparent",
										color: form.related_factors.includes(f) ? "var(--mantine-color-blue-9)" : "var(--mantine-color-dimmed)",
										borderColor: form.related_factors.includes(f) ? "var(--mantine-color-blue-3)" : undefined,
									}}
								>
									{f}
								</Box>
							))}
						</Group>
					</Box>

					<Box>
						<Text size="xs" c="dimmed" mb={6} fw={600}>定义特征</Text>
						<Group gap={4} wrap="wrap">
							{charOpts.map(c => (
								<Box
									key={c}
									component="button"
									type="button"
									onClick={() => setForm(p => ({ ...p, defining_characteristics: toggleItem(p.defining_characteristics, c) }))}
									px={8}
									py={2}
									style={{
										fontSize: 10,
										borderRadius: 999,
										border: "1px solid var(--mantine-color-default-border)",
										cursor: "pointer",
										background: form.defining_characteristics.includes(c) ? "var(--mantine-color-yellow-0)" : "transparent",
										color: form.defining_characteristics.includes(c) ? "var(--mantine-color-yellow-9)" : "var(--mantine-color-dimmed)",
										borderColor: form.defining_characteristics.includes(c) ? "var(--mantine-color-yellow-4)" : undefined,
									}}
								>
									{c}
								</Box>
							))}
						</Group>
					</Box>

					<Group gap={8} wrap="nowrap">
						<Button variant="outline" size="xs" fullWidth onClick={() => setEditId(null)}>
							取消
						</Button>
						<Button variant="default" size="xs" fullWidth onClick={saveForm}>
							保存
						</Button>
					</Group>
				</Box>
			)}

			{diagnoses.length > 0 && !editId && (
				<Box style={{ borderTop: "1px solid var(--mantine-color-default-border)", padding: "8px 12px", flexShrink: 0 }}>
					<Button variant="light" color="gray" size="xs" fullWidth onClick={doSave} disabled={saving} leftSection={<IconDeviceFloppy size={12} />}>
						{saving ? "已保存" : "保存到服务器"}
					</Button>
				</Box>
			)}
		</Box>
	);
}
