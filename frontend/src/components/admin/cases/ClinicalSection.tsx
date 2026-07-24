import type { CaseDispatch, CaseEditorState } from "./CaseEditorState";
import { stringField } from "./CaseEditorState";
import { inputClass } from "@/utils/styles";

const VOICE_OPTIONS = [
	{ value: "", label: "默认（按人口匹配）" },
	{ value: "zh_female_qingxin", label: "女声-清新" },
	{ value: "zh_female_wenrou", label: "女声-温柔" },
	{ value: "zh_male_qingse", label: "男声-青涩" },
	{ value: "zh_male_wennuan", label: "男声-温暖" },
];

const HISTORY_FIELDS: { key: string; label: string; height: string }[] = [
	{ key: "present_illness", label: "现病史", height: "h-24" },
	{ key: "past_history", label: "既往史", height: "h-16" },
	{ key: "medication_history", label: "用药史", height: "h-16" },
	{ key: "allergy_history", label: "过敏史", height: "h-12" },
	{ key: "family_history", label: "家族史", height: "h-16" },
	{ key: "social_history", label: "生活史", height: "h-16" },
];

interface Props {
	state: CaseEditorState;
	dispatch: CaseDispatch;
	disabled?: boolean;
}

export function ClinicalSection({ state, dispatch, disabled }: Props) {
	const voiceType = stringField(state, "voice_type");
	const voiceOverride = stringField(state, "voice_override");
	const chiefComplaint = stringField(state, "chief_complaint");
	const openingLine = stringField(state, "opening_line");

	function set(path: string, value: unknown) {
		dispatch({ type: "SET_FIELD", path, value });
	}

	return (
		<fieldset className="border border-border rounded-lg p-4">
			<legend className="text-sm font-semibold text-foreground px-1">临床信息</legend>

			{/* ── Voice ── */}
			<div className="flex gap-3 flex-wrap mb-3 pb-3 border-b border-border/50">
				<div className="flex-1 min-w-[180px]">
					<label className="block text-xs font-semibold text-muted-foreground mb-1">预设音色</label>
					<select value={voiceType} onChange={(e) => set("voice_type", e.target.value)} className={inputClass} disabled={disabled}>
						{VOICE_OPTIONS.map((o) => (
							<option key={o.value} value={o.value}>{o.label}</option>
						))}
					</select>
				</div>
				<div className="flex-1 min-w-[200px]">
					<label className="block text-xs font-semibold text-muted-foreground mb-1">自定义音色 ID（覆盖人口匹配）</label>
					<input
						value={voiceOverride}
						onChange={(e) => set("voice_override", e.target.value)}
						placeholder="zh_male_wennuan_bigtts"
						className={`${inputClass} font-mono text-xs`}
						disabled={disabled}
					/>
				</div>
			</div>

			{/* ── Chief complaint ── */}
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
				<div>
					<label className="block text-xs font-semibold text-muted-foreground mb-1">主诉<span className="text-destructive ml-0.5">*</span></label>
					<input value={chiefComplaint} onChange={(e) => set("chief_complaint", e.target.value)} className={inputClass} disabled={disabled} />
				</div>
				<div>
					<label className="block text-xs font-semibold text-muted-foreground mb-1">开场问候</label>
					<input value={openingLine} onChange={(e) => set("opening_line", e.target.value)} className={inputClass} disabled={disabled} />
				</div>
			</div>

			{/* ── History fields ── */}
			<div className="grid grid-cols-1 gap-3">
				{HISTORY_FIELDS.map(({ key, label, height }) => (
					<div key={key}>
						<label className="block text-xs font-semibold text-muted-foreground mb-1">{label}</label>
						<textarea
							value={stringField(state, key)}
							onChange={(e) => set(key, e.target.value)}
							className={`${inputClass} ${height} resize-y`}
							disabled={disabled}
						/>
					</div>
				))}
			</div>
		</fieldset>
	);
}
