import type { CaseDispatch, CaseJsonValue } from "./CaseEditorState";
import { boolField } from "./CaseEditorState";
import type { CaseEditorState } from "./CaseEditorState";

const TOOL_LIST: { key: string; label: string; desc: string }[] = [
	{ key: "physical_exam", label: "护理查体", desc: "学生可进行虚拟体格检查" },
	{ key: "nursing_diagnosis", label: "护理诊断", desc: "NANDA 护理诊断制定与排序" },
	{ key: "nursing_record", label: "护理记录", desc: "生成结构化 ADPIE 护理记录" },
	{ key: "quiz", label: "引导题目", desc: "训练中弹出选择题/判断题" },
];

interface Props {
	state: CaseEditorState;
	dispatch: CaseDispatch;
}

export default function CapabilitiesEditor({ state, dispatch }: Props) {
	const tools = (state.json.tools as Record<string, CaseJsonValue> | undefined) ?? {};

	function toggle(key: string) {
		const current = { ...tools };
		current[key] = !current[key];
		dispatch({ type: "SET_FIELD", path: "tools", value: current });
	}

	return (
		<div>
			<div className="text-xs font-medium text-muted-foreground mb-2">训练工具</div>
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
				{TOOL_LIST.map((c) => {
					const enabled = boolField(state, `tools.${c.key}`);
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
		</div>
	);
}
