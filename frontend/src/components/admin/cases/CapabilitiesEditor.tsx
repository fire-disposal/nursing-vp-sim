import type { CaseDispatch, CaseJsonValue } from "./CaseEditorState";
import { boolField } from "./CaseEditorState";
import type { CaseEditorState } from "./CaseEditorState";

const CAP_LIST: { key: string; label: string; desc: string }[] = [
	{ key: "physical_exam", label: "体格检查", desc: "学生可进行虚拟体格检查" },
	{ key: "nursing_record", label: "护理记录", desc: "生成结构化护理记录" },
	{ key: "emotion", label: "情绪反馈", desc: "显示患者情绪状态面板" },
	{ key: "initiative", label: "主动追问", desc: "患者根据情绪主动追问学生" },
	{ key: "portrait", label: "患者画像", desc: "展示患者背景画像侧栏" },
	{ key: "questionnaire", label: "问卷触发", desc: "训练前后弹出评估问卷" },
];

interface Props {
	state: CaseEditorState;
	dispatch: CaseDispatch;
}

export default function CapabilitiesEditor({ state, dispatch }: Props) {
	const caps = state.json.capabilities as Record<string, CaseJsonValue> | undefined;

	function toggle(key: string) {
		const current = { ...(caps ?? {}) };
		current[key] = !current[key];
		dispatch({ type: "SET_FIELD", path: "capabilities", value: current });
	}

	return (
		<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
			{CAP_LIST.map((c) => {
				const enabled = boolField(state, `capabilities.${c.key}`);
				return (
					<label
						key={c.key}
						className="flex items-center gap-2 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors"
					>
						<input
							type="checkbox"
							checked={enabled}
							onChange={() => toggle(c.key)}
							className="size-3.5 shrink-0"
						/>
						<div className="min-w-0">
							<div className="text-xs font-medium">{c.label}</div>
							<div className="text-[10px] text-muted-foreground leading-tight">{c.desc}</div>
						</div>
					</label>
				);
			})}
		</div>
	);
}
