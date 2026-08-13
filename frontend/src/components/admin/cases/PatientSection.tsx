import type { CaseDispatch, CaseEditorState } from "./CaseEditorState";
import { numField, stringField } from "./CaseEditorState";
import { Group, NumberInput, Paper, Select, Text, TextInput } from "@mantine/core";

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
		<Paper withBorder p="md" radius="md">
			<Text size="sm" fw={600} mb="md">患者信息</Text>
			<Group gap="sm" grow wrap="wrap">
				<div style={{ flexGrow: 2 }}>
					<Text size="xs" fw={600} c="dimmed" mb={4}>姓名<Text component="span" c="red">*</Text></Text>
					<TextInput value={name} onChange={(e) => set("patient_info.name", e.currentTarget.value)} disabled={disabled} />
				</div>
				<div>
					<Text size="xs" fw={600} c="dimmed" mb={4}>年龄<Text component="span" c="red">*</Text></Text>
					<NumberInput min={0} max={120} value={age} onChange={(v) => set("patient_info.age", Number(v))} disabled={disabled} />
				</div>
				<div>
					<Text size="xs" fw={600} c="dimmed" mb={4}>性别<Text component="span" c="red">*</Text></Text>
					<Select
						data={[{ value: "男", label: "男" }, { value: "女", label: "女" }]}
						value={gender}
						onChange={(v) => set("patient_info.gender", v ?? "男")}
						disabled={disabled}
					/>
				</div>
			</Group>
		</Paper>
	);
}
