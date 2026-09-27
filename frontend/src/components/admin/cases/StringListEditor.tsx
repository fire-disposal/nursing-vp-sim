import { IconPlus, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { ActionIcon, Badge, Group, Stack, TextInput } from "@mantine/core";

interface Props {
	value: string[];
	onChange: (v: string[]) => void;
	placeholder: string;
	disabled?: boolean;
	/** 图标按钮的无障碍名：同一张表单里有多组清单，测试与读屏都要能区分。 */
	removeAriaLabel?: string;
	addAriaLabel?: string;
	/** 输入框的无障碍名（清单同名时 `getByLabelText` 才能定位到具体那一组）。 */
	inputAriaLabel?: string;
}

/**
 * 字符串清单编辑器：回车或 + 追加一条，徽章展示，点 × 删除。
 *
 * 隐藏信息 / 必询要点（AiFieldsSection）与教学蓝图的七组清单共用同一实现 ——
 * 蓝图有七组同形状清单，各写一份会让「回车即提交」这类细节各自漂移。
 */
export function StringListEditor({
	value,
	onChange,
	placeholder,
	disabled,
	removeAriaLabel = "移除条目",
	addAriaLabel = "添加条目",
	inputAriaLabel,
}: Props) {
	const [input, setInput] = useState("");

	const add = () => {
		const t = input.trim();
		if (!t) return;
		onChange([...value, t]);
		setInput("");
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			add();
		}
	};

	const remove = (idx: number) => {
		onChange(value.filter((_, i) => i !== idx));
	};

	return (
		<Stack gap={8}>
			{value.length > 0 && (
				<Group gap={4} wrap="wrap">
					{value.map((t, i) => (
						<Badge
							key={i}
							variant="secondary"
							rightSection={
								!disabled ? (
									<ActionIcon size="xs" variant="transparent" color="gray" onClick={() => remove(i)} aria-label={removeAriaLabel}>
										<IconX size={10} />
									</ActionIcon>
								) : undefined
							}
						>
							{t}
						</Badge>
					))}
				</Group>
			)}
			{!disabled && (
				<Group gap={8}>
					<TextInput
						value={input}
						onChange={(e) => setInput(e.currentTarget.value)}
						onKeyDown={onKeyDown}
						placeholder={placeholder}
						aria-label={inputAriaLabel}
						style={{ flex: 1 }}
					/>
					<ActionIcon variant="light" color="blue" onClick={add} aria-label={addAriaLabel}>
						<IconPlus size={14} />
					</ActionIcon>
				</Group>
			)}
		</Stack>
	);
}
