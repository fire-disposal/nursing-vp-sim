export type ItemType =
	| "input"
	| "textarea"
	| "select"
	| "radio"
	| "checkbox_group"
	| "vital_sign"
	| "compound"
	| "repeater";

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

export interface CompoundItem extends BaseItem {
	type: "compound";
	trigger: SelectItem | RadioItem;
	branches: Record<string, RecordSheetItem[]>;
}

export interface RepeaterField {
	key: string;
	type: ItemType;
	label: string;
	unit?: string;
	placeholder?: string;
	options?: string[] | CheckboxOption[];
	showWhen?: Record<string, string>;
}

export interface RepeaterRow {
	key: string;
	label: string;
}

export interface RepeaterItem extends BaseItem {
	type: "repeater";
	rows: RepeaterRow[];
	fields: RepeaterField[];
}

export type RecordSheetItem =
	| InputItem
	| TextareaItem
	| SelectItem
	| RadioItem
	| CheckboxGroupItem
	| VitalSignItem
	| CompoundItem
	| RepeaterItem;

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
