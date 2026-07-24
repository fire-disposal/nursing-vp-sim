import type { CaseDispatch, CaseEditorState } from "./CaseEditorState";
import { numField, objField, stringField } from "./CaseEditorState";
import { inputClass } from "@/utils/styles";

const ARRIVAL_OPTIONS = [
	{ value: "walk", label: "步行" },
	{ value: "wheelchair", label: "轮椅" },
	{ value: "stretcher", label: "平车" },
	{ value: "ambulance", label: "救护车" },
];

const CONSCIOUSNESS_OPTIONS = [
	{ value: "alert", label: "清醒" },
	{ value: "lethargic", label: "嗜睡" },
	{ value: "confused", label: "意识模糊" },
	{ value: "unresponsive", label: "无反应" },
];

const VITAL_KEYS = ["hr", "rr", "spo2", "bp_sys", "bp_dia", "temp"] as const;

interface Props {
	state: CaseEditorState;
	dispatch: CaseDispatch;
	disabled?: boolean;
}

export function TriageSection({ state, dispatch, disabled }: Props) {
	const chiefComplaint = stringField(state, "chief_complaint");
	const openingLine = stringField(state, "opening_line");
	const arrivalMode = stringField(state, "arrival_mode", "walk");
	const consciousness = stringField(state, "consciousness", "alert");
	const vitals = objField(state, "vitals");
	const mewsScore = numField(state, "mews_score");
	const triageCategory = stringField(state, "triage_category");

	function set(path: string, value: unknown) {
		dispatch({ type: "SET_FIELD", path, value });
	}

	function setVital(key: string, value: number) {
		set("vitals", { ...vitals, [key]: value });
	}

	return (
		<fieldset className="border border-border rounded-lg p-4">
			<legend className="text-sm font-semibold text-foreground px-1">分诊信息</legend>
			<div className="grid grid-cols-2 gap-3">
				<div className="col-span-2">
					<label className="block text-xs font-semibold text-muted-foreground mb-1">主诉<span className="text-destructive ml-0.5">*</span></label>
					<textarea value={chiefComplaint} onChange={(e) => set("chief_complaint", e.target.value)} className={`${inputClass} h-16 resize-y`} disabled={disabled} />
				</div>
				<div className="col-span-2">
					<label className="block text-xs font-semibold text-muted-foreground mb-1">开场白</label>
					<input value={openingLine} onChange={(e) => set("opening_line", e.target.value)} className={inputClass} disabled={disabled} />
				</div>
				<div>
					<label className="block text-xs font-semibold text-muted-foreground mb-1">来院方式</label>
					<select value={arrivalMode} onChange={(e) => set("arrival_mode", e.target.value)} className={inputClass} disabled={disabled}>
						{ARRIVAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
					</select>
				</div>
				<div>
					<label className="block text-xs font-semibold text-muted-foreground mb-1">意识状态</label>
					<select value={consciousness} onChange={(e) => set("consciousness", e.target.value)} className={inputClass} disabled={disabled}>
						{CONSCIOUSNESS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
					</select>
				</div>
			</div>
			<div className="mt-3">
				<label className="block text-xs font-semibold text-muted-foreground mb-1">生命体征</label>
				<div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
					{VITAL_KEYS.map((k) => (
						<div key={k}>
							<span className="text-[10px] text-muted-foreground">{k}</span>
							<input
								type="number"
								value={Number(vitals[k] ?? 0)}
								onChange={(e) => setVital(k, Number(e.target.value))}
								className={`${inputClass} h-8 text-xs`}
								disabled={disabled}
							/>
						</div>
					))}
				</div>
			</div>
			<div className="mt-2 grid grid-cols-2 gap-3">
				<div>
					<label className="block text-xs font-semibold text-muted-foreground mb-1">MEWS 评分</label>
					<input type="number" value={mewsScore} onChange={(e) => set("mews_score", Number(e.target.value))} className={inputClass} disabled={disabled} />
				</div>
				<div>
					<label className="block text-xs font-semibold text-muted-foreground mb-1">分诊等级</label>
					<input value={triageCategory} onChange={(e) => set("triage_category", e.target.value)} className={inputClass} disabled={disabled} placeholder="红/橙/黄/绿/蓝" />
				</div>
			</div>
		</fieldset>
	);
}
