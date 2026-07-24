import type { Dispatch } from "react";
import { useReducer } from "react";

// ── Types ─────────────────────────────────────────────────────────────────

export type CaseJsonValue =
	| string
	| number
	| boolean
	| null
	| CaseJsonValue[]
	| { [key: string]: CaseJsonValue };

export interface CaseEditorState {
	/** Canonical JSON being edited — the single source of truth. */
	json: Record<string, CaseJsonValue>;
	/** Track JSON.stringify(json) at load time for dirty comparison. */
	initialJson: string;
	isDirty: boolean;
	/** Which view mode is active. */
	mode: "form" | "json";
}

// ── Actions ───────────────────────────────────────────────────────────────

type Action =
	| { type: "SET_FIELD"; path: string; value: unknown }
	| { type: "SET_JSON"; json: Record<string, CaseJsonValue> }
	| { type: "LOAD_CASE"; json: Record<string, CaseJsonValue> }
	| { type: "SWITCH_MODE"; mode: "form" | "json" }
	| { type: "MARK_CLEAN" };

// ── JSON path helpers ─────────────────────────────────────────────────────

function getByPath(obj: Record<string, unknown>, path: string): unknown {
	const keys = path.split(".");
	let current: unknown = obj;
	for (const k of keys) {
		if (current == null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[k];
	}
	return current;
}

function setByPath(
	obj: Record<string, unknown>,
	path: string,
	value: unknown,
): Record<string, unknown> {
	const keys = path.split(".");
	if (keys.length === 0) return obj;
	const result = { ...obj };
	let current: Record<string, unknown> = result;
	for (let i = 0; i < keys.length - 1; i++) {
		const k = keys[i];
		const next = current[k];
		if (next == null || typeof next !== "object" || Array.isArray(next)) {
			const fresh: Record<string, unknown> = {};
			current[k] = fresh;
			current = fresh;
		} else {
			current[k] = { ...(next as Record<string, unknown>) };
			current = current[k] as Record<string, unknown>;
		}
	}
	current[keys[keys.length - 1]] = value;
	return result;
}

// ── Default state ─────────────────────────────────────────────────────────

const DEFAULT_CASE_JSON: Record<string, CaseJsonValue> = {
	name: "",
	difficulty: 1,
	time_limit: 20,
	description: "",
	training_type: "history_taking",
	is_open: false,
	patient_info: {
		name: "",
		age: 0,
		gender: "男",
		visible_symptoms: [],
		expression: "neutral",
	},
	chief_complaint: "",
	opening_line: "",
	personality: {
		health_literacy: "normal",
		verbosity: "normal",
		anxiety_trait: "normal",
		patience: "normal",
		mood: "neutral",
		compliance: "normal",
	},
	communication_style: "",
	present_illness: "",
	past_history: "",
	medication_history: "",
	allergy_history: "",
	family_history: "",
	social_history: "",
	voice_type: "",
	capabilities: {},
	required_inquiries: [],
	hidden_info: "",
};

export function getDefaultCaseJson(): Record<string, CaseJsonValue> {
	return JSON.parse(JSON.stringify(DEFAULT_CASE_JSON));
}

// ── Reducer ───────────────────────────────────────────────────────────────

function reducer(state: CaseEditorState, action: Action): CaseEditorState {
	switch (action.type) {
		case "SET_FIELD": {
			const newJson = setByPath(
				state.json as unknown as Record<string, unknown>,
				action.path,
				action.value,
			) as unknown as Record<string, CaseJsonValue>;
			return { ...state, json: newJson, isDirty: true };
		}
		case "SET_JSON":
			return { ...state, json: action.json, isDirty: true };
		case "LOAD_CASE":
			return {
				json: action.json,
				initialJson: JSON.stringify(action.json),
				isDirty: false,
				mode: "form",
			};
		case "SWITCH_MODE":
			return { ...state, mode: action.mode };
		case "MARK_CLEAN":
			return {
				...state,
				initialJson: JSON.stringify(state.json),
				isDirty: false,
			};
	}
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useCaseEditor(initial?: Record<string, CaseJsonValue>) {
	const [state, dispatch] = useReducer(reducer, {
		json: initial ?? getDefaultCaseJson(),
		initialJson: JSON.stringify(initial ?? getDefaultCaseJson()),
		isDirty: false,
		mode: "form",
	});

	return { state, dispatch };
}

// ── Field accessor ────────────────────────────────────────────────────────

export function field(
	state: CaseEditorState,
	path: string,
	defaultValue: CaseJsonValue = "",
): CaseJsonValue {
	return (getByPath(state.json as unknown as Record<string, unknown>, path) as CaseJsonValue) ?? defaultValue;
}

export function stringField(state: CaseEditorState, path: string, def = ""): string {
	return String(field(state, path, def));
}

export function numField(state: CaseEditorState, path: string, def = 0): number {
	return Number(field(state, path, def));
}

export function boolField(state: CaseEditorState, path: string, def = false): boolean {
	return Boolean(field(state, path, def));
}

export function arrayField(state: CaseEditorState, path: string, def: CaseJsonValue[] = []): CaseJsonValue[] {
	const v = field(state, path, def);
	return Array.isArray(v) ? v : def;
}

export function objField(state: CaseEditorState, path: string, def: Record<string, CaseJsonValue> = {}): Record<string, CaseJsonValue> {
	const v = field(state, path, def);
	return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, CaseJsonValue>) : def;
}

export type CaseDispatch = Dispatch<Action>;

export { getByPath };
