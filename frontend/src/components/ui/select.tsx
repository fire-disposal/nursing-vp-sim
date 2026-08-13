import { Select as MantineSelect } from "@mantine/core";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * 兼容旧 shadcn 组合式 Select API：
 *   <Select value onValueChange><SelectTrigger/><SelectValue/><SelectContent>
 *     <SelectItem value>label</SelectItem>…</SelectContent></Select>
 *
 * 内部收集 children 中的占位符/选项，渲染为单个 Mantine Select。
 */

interface Item {
	value: string;
	label: ReactNode;
	disabled?: boolean;
}

type ChildElement = ReactElement<{
	value?: string;
	placeholder?: ReactNode;
	className?: string;
	size?: "sm" | "default";
	disabled?: boolean;
	children?: ReactNode;
}>;

function SelectItem(_props: { value: string; children?: ReactNode; disabled?: boolean }): null {
	return null;
}
function SelectTrigger(_props: { className?: string; size?: "sm" | "default"; children?: ReactNode }): null {
	return null;
}
function SelectValue(_props: { placeholder?: ReactNode }): null {
	return null;
}
function SelectContent(_props: { children?: ReactNode }): null {
	return null;
}

function collectItems(children: ReactNode): Item[] {
	const items: Item[] = [];
	for (const child of Children.toArray(children)) {
		if (!isValidElement(child) || child.type !== SelectItem) continue;
		const el = child as ChildElement;
		items.push({ value: el.props.value ?? "", label: el.props.children, disabled: el.props.disabled });
	}
	return items;
}

interface SelectProps2 {
	value?: string | null;
	onValueChange?: (value: string) => void;
	disabled?: boolean;
	children?: ReactNode;
}

function Select({ value, onValueChange, disabled, children }: SelectProps2) {
	let placeholder: ReactNode;
	let triggerClassName: string | undefined;
	let size: "sm" | "default" = "default";
	let items: Item[] = [];

	for (const child of Children.toArray(children)) {
		if (!isValidElement(child)) continue;
		const el = child as ChildElement;
		if (el.type === SelectValue) placeholder = el.props.placeholder;
		else if (el.type === SelectTrigger) {
			triggerClassName = el.props.className;
			size = el.props.size ?? "default";
		} else if (el.type === SelectContent) {
			items = collectItems(el.props.children);
		}
	}

	return (
		<MantineSelect
			data={items.map((i) => ({ value: i.value, label: i.label as string, disabled: i.disabled }))}
			value={value ?? null}
			onChange={(v) => onValueChange?.(v ?? "")}
			placeholder={placeholder as string}
			disabled={disabled}
			size={size === "sm" ? "xs" : "sm"}
			className={triggerClassName}
			allowDeselect={false}
		/>
	);
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
