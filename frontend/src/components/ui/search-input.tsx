import { TextInput } from "@mantine/core";
import { IconSearch, IconX } from "@tabler/icons-react";
import { useCallback, useState } from "react";

interface SearchInputProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	size?: "xs" | "sm" | "md";
}

/**
 * SearchInput — 统一搜索框。
 * 带清除按钮（clearable）、sm 默认尺寸，贴合管理端表格密度。
 */
export function SearchInput({
	value,
	onChange,
	placeholder = "搜索...",
	size = "sm",
}: SearchInputProps) {
	const [focused, setFocused] = useState(false);
	const handleClear = useCallback(() => onChange(""), [onChange]);

	return (
		<TextInput
			value={value}
			onChange={(e) => onChange(e.currentTarget.value)}
			placeholder={placeholder}
			leftSection={<IconSearch size={15} />}
			rightSection={
				value ? (
					<button
						type="button"
						onClick={handleClear}
						aria-label="清除搜索"
						style={{
							border: "none",
							background: "transparent",
							cursor: "pointer",
							display: "inline-flex",
							alignItems: "center",
							color: "var(--mantine-color-dimmed)",
							padding: 4,
							borderRadius: "var(--mantine-radius-sm)",
						}}
					>
						<IconX size={14} aria-hidden="true" />
					</button>
				) : undefined
			}
			size={size}
			styles={{
				input: {
					boxShadow: focused ? "0 0 0 2px var(--mantine-color-brand-2)" : undefined,
					borderColor: focused ? "var(--mantine-color-brand-5)" : undefined,
					transition: "border-color 150ms ease, box-shadow 150ms ease",
				},
			}}
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
		/>
	);
}
