import { TextInput } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";

interface SearchInputProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
}

export function SearchInput({ value, onChange, placeholder = "搜索..." }: SearchInputProps) {
	return (
		<TextInput
			value={value}
			onChange={(e) => onChange(e.currentTarget.value)}
			placeholder={placeholder}
			leftSection={<IconSearch size={16} />}
		/>
	);
}
