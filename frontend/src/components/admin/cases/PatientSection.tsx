import type { PatientInfo } from "./caseFormTypes";
import { inputClass } from "@/utils/styles";

interface Props {
	value: PatientInfo;
	onChange: (v: PatientInfo) => void;
	disabled?: boolean;
}

export function PatientSection({ value, onChange, disabled }: Props) {
	const set = (k: keyof PatientInfo, v: unknown) => onChange({ ...value, [k]: v });

	return (
		<fieldset className="border border-border rounded-lg p-4">
			<legend className="text-sm font-semibold text-foreground px-1">患者信息</legend>
			<div className="flex gap-3 flex-wrap">
				<div className="flex-[2] min-w-[200px]">
					<label className="block text-xs font-semibold text-muted-foreground mb-1">姓名<span className="text-destructive ml-0.5">*</span></label>
					<input value={value.name} onChange={(e) => set("name", e.target.value)} className={inputClass} disabled={disabled} />
				</div>
				<div className="flex-1 min-w-[120px]">
					<label className="block text-xs font-semibold text-muted-foreground mb-1">年龄<span className="text-destructive ml-0.5">*</span></label>
					<input type="number" min={0} max={120} value={value.age} onChange={(e) => set("age", Number(e.target.value))} className={inputClass} disabled={disabled} />
				</div>
				<div className="flex-1 min-w-[120px]">
					<label className="block text-xs font-semibold text-muted-foreground mb-1">性别<span className="text-destructive ml-0.5">*</span></label>
					<select value={value.gender} onChange={(e) => set("gender", e.target.value)} className={inputClass} disabled={disabled}>
						<option value="男">男</option>
						<option value="女">女</option>
					</select>
				</div>
			</div>
		</fieldset>
	);
}
