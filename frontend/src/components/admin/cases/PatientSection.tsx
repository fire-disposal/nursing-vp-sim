import type { CaseDispatch, CaseEditorState } from "./CaseEditorState";
import { numField, stringField } from "./CaseEditorState";
import { inputClass } from "@/utils/styles";

interface Props {
	state: CaseEditorState;
	dispatch: CaseDispatch;
	disabled?: boolean;
}

export function PatientSection({ state, dispatch, disabled }: Props) {
	const name = stringField(state, "patient_info.name");
	const age = numField(state, "patient_info.age");
	const gender = stringField(state, "patient_info.gender", "男");

	function set(path: string, value: unknown) {
		dispatch({ type: "SET_FIELD", path, value });
	}

	return (
		<fieldset className="border border-border rounded-lg p-4">
			<legend className="text-sm font-semibold text-foreground px-1">患者信息</legend>
			<div className="flex gap-3 flex-wrap">
				<div className="flex-[2] min-w-[200px]">
					<label className="block text-xs font-semibold text-muted-foreground mb-1">姓名<span className="text-destructive ml-0.5">*</span></label>
					<input value={name} onChange={(e) => set("patient_info.name", e.target.value)} className={inputClass} disabled={disabled} />
				</div>
				<div className="flex-1 min-w-[120px]">
					<label className="block text-xs font-semibold text-muted-foreground mb-1">年龄<span className="text-destructive ml-0.5">*</span></label>
					<input type="number" min={0} max={120} value={age} onChange={(e) => set("patient_info.age", Number(e.target.value))} className={inputClass} disabled={disabled} />
				</div>
				<div className="flex-1 min-w-[120px]">
					<label className="block text-xs font-semibold text-muted-foreground mb-1">性别<span className="text-destructive ml-0.5">*</span></label>
					<select value={gender} onChange={(e) => set("patient_info.gender", e.target.value)} className={inputClass} disabled={disabled}>
						<option value="男">男</option>
						<option value="女">女</option>
					</select>
				</div>
			</div>
		</fieldset>
	);
}
