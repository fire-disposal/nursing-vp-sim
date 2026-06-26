import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/utils/cn";

interface FormFieldProps {
	label?: string;
	required?: boolean;
	error?: string;
	help?: string;
	children?: ReactNode;
	style?: CSSProperties;
	className?: string;
}

export default function FormField({
	label,
	required,
	error,
	help,
	children,
	style,
	className,
}: FormFieldProps) {
	return (
		<div className={cn("mb-4", className)} style={style}>
			{label && (
				<label className="mb-1 block text-sm font-semibold text-muted-foreground">
					{label}
					{required && <span className="ml-0.5 text-destructive">*</span>}
				</label>
			)}
			{children}
			{help && <p className="mt-1 text-xs text-muted-foreground/70">{help}</p>}
			{error && <p className="mt-1 text-xs text-destructive">{error}</p>}
		</div>
	);
}

export { Input } from "@/components/ui/input";

export function Select({
	options,
	placeholder,
	className,
	...props
}: {
	options: { value: string; label: string }[];
	placeholder?: string;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
	return (
		<select
			className={cn(
				"flex h-8 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-ring disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer",
				className,
			)}
			{...props}
		>
			{placeholder && <option value="">{placeholder}</option>}
			{options.map((opt) => (
				<option key={opt.value} value={opt.value}>
					{opt.label}
				</option>
			))}
		</select>
	);
}

export function Textarea(
	props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
	return (
		<textarea
			className="flex min-h-[60px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-ring disabled:cursor-not-allowed disabled:opacity-50 resize-y"
			{...props}
		/>
	);
}
