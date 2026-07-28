import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TrainingToolProps } from "@/engine/TrainingTool";
import { cn } from "@/lib/utils";

interface Diagnosis {
	id: string;
	problem: string;
	related_factors: string[];
	defining_characteristics: string[];
	priority: number;
}

export default function NursingDiagnosisTool({ bus, recordId }: TrainingToolProps) {
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
		bus.emit("tool:invoke", { tool: "nursing_diagnosis", action: "load", params: {}, recordId: rid });
	}, [rid, bus]);

	useEffect(() => {
		const handler = (msg: unknown) => {
			const m = msg as { type: string; tool?: string; action?: string; ok?: boolean; data?: {
				diagnoses?: Diagnosis[];
				stems?: string[];
				factor_options?: string[];
				characteristic_options?: string[];
			} };
			if (m.type !== "tool:result" || m.tool !== "nursing_diagnosis" || m.action !== "load") return;
			if (m.ok && m.data) {
				setDiagnoses(m.data.diagnoses ?? []);
				setStems(m.data.stems ?? []);
				setFactorOpts(m.data.factor_options ?? []);
				setCharOpts(m.data.characteristic_options ?? []);
				idCounter.current = (m.data.diagnoses?.length ?? 0);
			}
			setLoading(false);
		};
		bus.on("tool:result", handler);
		return () => { bus.off("tool:result", handler); };
	}, [bus]);

	// ── Save ──
	const doSave = useCallback(() => {
		setSaving(true);
		bus.emit("tool:invoke", {
			tool: "nursing_diagnosis", action: "save",
			params: { diagnoses: diagnoses.map(({ id, ...rest }) => rest) },
			recordId: rid,
		});
		setTimeout(() => setSaving(false), 800);
	}, [bus, rid, diagnoses]);

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
		return <div className="flex items-center justify-center h-20 text-xs text-muted-foreground">加载中…</div>;
	}
	return (
		<div className="flex flex-col h-full bg-background">
			<div className="px-3 py-2.5 border-b border-border shrink-0 flex items-center justify-between">
				<span className="text-xs font-semibold text-foreground">护理诊断</span>
				<div className="flex items-center gap-1">
					<span className="text-[10px] text-muted-foreground">{diagnoses.length} 条</span>
					<button onClick={openNew} className="size-6 rounded flex items-center justify-center hover:bg-muted text-muted-foreground">
						<Plus size={14} />
					</button>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto p-3 space-y-3">
				{diagnoses.length === 0 && !editId && (
					<div className="text-xs text-muted-foreground/60 text-center py-8">
						点击 + 添加护理诊断，按优先级排序
					</div>
				)}

				{diagnoses.map((d, i) => (
					<div key={d.id} className={cn(
						"rounded-xl border p-3 transition-colors",
						"border-border bg-card hover:border-primary/30",
					)}>
						<div className="flex items-start gap-2">
							<div className="flex flex-col items-center gap-0.5 shrink-0 mt-0.5">
								<button onClick={() => move(i, -1)} disabled={i === 0}
									className="text-muted-foreground hover:text-foreground disabled:opacity-20">
									<ArrowUp size={12} />
								</button>
								<span className="text-[10px] font-bold text-muted-foreground w-4 text-center">{i + 1}</span>
								<button onClick={() => move(i, 1)} disabled={i === diagnoses.length - 1}
									className="text-muted-foreground hover:text-foreground disabled:opacity-20">
									<ArrowDown size={12} />
								</button>
							</div>
							<div className="flex-1 min-w-0">
								<button onClick={() => openEdit(d)} className="text-left w-full">
									<p className="text-sm font-medium text-foreground truncate">{d.problem}</p>
									<div className="flex flex-wrap gap-1 mt-1.5">
										{d.related_factors.map(f => (
											<span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">{f}</span>
										))}
										{d.defining_characteristics.map(c => (
											<span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">{c}</span>
										))}
									</div>
								</button>
							</div>
							<button onClick={() => deleteDiag(d.id)}
								className="text-muted-foreground/40 hover:text-red-500 shrink-0">
								<Trash2 size={12} />
							</button>
						</div>
					</div>
				))}
			</div>

			{/* Edit panel */}
			{editId && (
				<div className="border-t border-border bg-card p-3 space-y-3 shrink-0">
					<input
						value={form.problem}
						onChange={e => setForm(p => ({ ...p, problem: e.target.value }))}
						placeholder="护理问题（如：清理呼吸道无效）"
						className="w-full text-sm px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:border-primary"
						list="diag-stems"
					/>
					<datalist id="diag-stems">{stems.map(s => <option key={s} value={s} />)}</datalist>

					<div>
						<p className="text-[10px] text-muted-foreground mb-1.5 font-semibold">相关因素</p>
						<div className="flex flex-wrap gap-1">
							{factorOpts.map(f => (
								<button key={f} onClick={() => setForm(p => ({ ...p, related_factors: toggleItem(p.related_factors, f) }))}
									className={cn("text-[10px] px-2 py-0.5 rounded-full border transition-colors",
										form.related_factors.includes(f) ? "border-blue-500/40 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" : "border-border text-muted-foreground hover:border-blue-500/30")}>
									{f}
								</button>
							))}
						</div>
					</div>

					<div>
						<p className="text-[10px] text-muted-foreground mb-1.5 font-semibold">定义特征</p>
						<div className="flex flex-wrap gap-1">
							{charOpts.map(c => (
								<button key={c} onClick={() => setForm(p => ({ ...p, defining_characteristics: toggleItem(p.defining_characteristics, c) }))}
									className={cn("text-[10px] px-2 py-0.5 rounded-full border transition-colors",
										form.defining_characteristics.includes(c) ? "border-amber-500/40 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" : "border-border text-muted-foreground hover:border-amber-500/30")}>
									{c}
								</button>
							))}
						</div>
					</div>

					<div className="flex gap-2">
						<button onClick={() => setEditId(null)}
							className="flex-1 text-xs py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted">
							取消
						</button>
						<button onClick={saveForm}
							className="flex-1 text-xs py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
							保存
						</button>
					</div>
				</div>
			)}

			{diagnoses.length > 0 && !editId && (
				<div className="border-t border-border px-3 py-2 shrink-0">
					<button onClick={doSave} disabled={saving}
						className="w-full flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-foreground transition-colors">
						<Save size={12} /> {saving ? "已保存" : "保存到服务器"}
					</button>
				</div>
			)}
		</div>
	);
}
