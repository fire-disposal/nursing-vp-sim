import { Search } from "lucide-react";

interface SearchInputProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
}

export function SearchInput({ value, onChange, placeholder = "搜索..." }: SearchInputProps) {
	return (
		<div className="relative">
			<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
			<input
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm bg-muted focus:outline-none focus:border-blue-500 focus:bg-card transition-colors"
			/>
		</div>
	);
}
