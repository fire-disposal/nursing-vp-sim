export type ItemType =
	| "input"
	| "textarea"
	| "select"
	| "radio"
	| "checkbox_group"
	| "vital_sign";

export interface BaseItem {
	key: string;
	type: ItemType;
	label: string;
	required?: boolean;
}

export interface InputItem extends BaseItem {
	type: "input";
	placeholder?: string;
	unit?: string;
}

export interface TextareaItem extends BaseItem {
	type: "textarea";
	placeholder?: string;
}

export interface SelectItem extends BaseItem {
	type: "select";
	options: string[];
	placeholder?: string;
}

export interface RadioItem extends BaseItem {
	type: "radio";
	options: string[];
}

export interface CheckboxOption {
	label: string;
	key: string;
	detail?: { type: "input"; placeholder: string };
}

export interface CheckboxGroupItem extends BaseItem {
	type: "checkbox_group";
	options: CheckboxOption[];
	columns?: number;
}

export interface VitalSignItem extends BaseItem {
	type: "vital_sign";
}

export type RecordSheetItem =
	| InputItem
	| TextareaItem
	| SelectItem
	| RadioItem
	| CheckboxGroupItem
	| VitalSignItem;

export interface RecordSheetSection {
	key: string;
	label: string;
	icon?: string;
	collapsible?: boolean;
	items: RecordSheetItem[];
}

export interface RecordSheetConfig {
	title: string;
	sections: RecordSheetSection[];
}

export interface ReadonlySheetValue {
	[sectionKey: string]: {
		[itemKey: string]: unknown;
	};
}
