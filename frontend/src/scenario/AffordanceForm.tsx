import { useState } from "react";
import type {
	ScenarioActionInput,
	ScenarioAffordance,
	ScenarioTarget,
} from "@/api/scenario";
import { timeCost } from "./stream";

/**
 * 自输入入口的固定文案。**由前端无条件提供**：pack/DM 被禁止提供同类选项
 * （后端 `_FREE_INPUT_LABELS` 会把 DM 给的"其他/自输入"整条丢掉并记账），
 * 所以"能不能自己写"不能依赖后端数据，只能在这里保证。
 */
export const OTHER_ENTRY_LABEL = "其他";

/**
 * 动作分类的中文名：`type` 是内部键，学生面只出现中文（未知类型一律归"其他"）。
 * 表单抬头用这一份；要给学生看到分类的地方都该走它，别再各写一份。
 */
const AFFORDANCE_TYPE_LABELS: Record<string, string> = {
	act: "处置",
	observe: "观察",
	measure: "测量",
	document: "记录",
	summon: "呼叫",
	ask: "询问",
	other: "其他",
};

/**
 * 「其他」在选择型动作里的内部哨兵：它**不进 `selection`**——列出的选项才是 `selection`，
 * 学生自己写的字一律进 `text`（后端不解析 JSON，判读的 `accept_custom` 也从 `text` 读词）。
 */
const OTHER = "\u0000scenario-other";

/** 与后端 `ScenarioTurnRequest.text` 的 2000 字符上限一致（同理见 `ActionBar`）。 */
const MAX_INPUT = 2000;

interface AffordanceFormProps {
	affordance: ScenarioAffordance;
	busy: boolean;
	/** 这次动作的对象（表单里要**一直看得见**，不能被表单盖住）。 */
	target: ScenarioTarget | null;
	targetLabel: string;
	onSubmit: (action: ScenarioActionInput) => void;
	onCancel: () => void;
}

/**
 * 选择型动作（`select: single|multi`）与记录表单（`type: document`）的展开形态。
 *
 * 提交形状（后端契约）：`selection` 只放**声明过的选项 id**；学生打的字（「其他」的自写内容、
 * document 各字段的记录）按行拼成纯文本进 `text`——服务端不解析 JSON，也不做
 * "把学生的临床表达纠正成标准操作"。
 *
 * 调用方按 `affordance.id` 挂 `key`，换动作即重置草稿（不靠 effect 清状态）。
 */
export default function AffordanceForm({
	affordance,
	busy,
	target,
	targetLabel,
	onSubmit,
	onCancel,
}: AffordanceFormProps) {
	const options = affordance.options ?? [];
	const fields = affordance.fields ?? [];
	const needsSingle = affordance.select === "single";
	const needsMulti = affordance.select === "multi";
	const isDocument = affordance.type === "document";
	// 自输入是平台保证的通道，但作者可以用 `free_input: false` 显式关掉（封闭文书类动作）；
	// 关掉时表单里就不出现「其他」——按钮与入口必须一致，不能只是不提交。
	const allowCustom = affordance.free_input !== false;

	const [choice, setChoice] = useState("");
	const [checked, setChecked] = useState<string[]>([]);
	const [otherOn, setOtherOn] = useState(false);
	const [otherText, setOtherText] = useState("");
	const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

	const toggleChecked = (option: string) => {
		setChecked((prev) =>
			prev.includes(option)
				? prev.filter((item) => item !== option)
				: [...prev, option],
		);
	};

	const record = fields
		.map((field) => [field, (fieldValues[field] ?? "").trim()] as const)
		.filter(([, value]) => value.length > 0)
		.map(([field, value]) => `${field}：${value}`)
		.join("\n")
		.slice(0, MAX_INPUT);

	const customText = otherText.trim().slice(0, MAX_INPUT);
	const wantsCustom = needsSingle ? choice === OTHER : otherOn;
	const canSubmit = needsSingle
		? choice !== "" && (choice !== OTHER || customText.length > 0)
		: needsMulti
			? checked.length > 0 || (otherOn && customText.length > 0)
			: record.length > 0 || (otherOn && customText.length > 0);

	const submit = () => {
		if (!canSubmit || busy) return;
		// 记录内容（document）与「其他」自写内容都进同一个纯文本字段，按行拼接。
		const text = [isDocument ? record : "", wantsCustom ? customText : ""]
			.filter((part) => part.length > 0)
			.join("\n")
			.slice(0, MAX_INPUT);
		onSubmit({
			kind: "action",
			target,
			affordance_id: affordance.id,
			selection: needsSingle
				? choice !== "" && choice !== OTHER
					? [choice]
					: []
				: needsMulti
					? checked
					: [],
			text: text.length > 0 ? text : null,
		});
	};

	return (
		<div className="sc-form">
			<div className="sc-form-head">
				<span className="sc-form-title">{affordance.label}</span>
				<span className="sc-btn-tag">
					{AFFORDANCE_TYPE_LABELS[affordance.type] ?? AFFORDANCE_TYPE_LABELS.other}
				</span>
			</div>
			<div className="sc-form-target">
				对象：{targetLabel !== "" ? targetLabel : "当前场景"}
				{timeCost(affordance) > 0 && <span className="sc-time-cost">耗时</span>}
			</div>

			{needsSingle && options.length > 0 && (
				<div className="sc-field">
					<span className="sc-field-label">选一项</span>
					{options.map((option) => (
						<label
							key={option.id}
							className="sc-choice"
							data-checked={choice === option.id}
						>
							<input
								type="radio"
								name={`scenario-single-${affordance.id}`}
								value={option.id}
								checked={choice === option.id}
								onChange={() => setChoice(option.id)}
							/>
							<span className="sc-choice-label">{option.label || option.id}</span>
						</label>
					))}
				</div>
			)}

			{needsMulti && options.length > 0 && (
				<div className="sc-field">
					<span className="sc-field-label">可多选</span>
					{options.map((option) => (
						<label
							key={option.id}
							className="sc-choice"
							data-checked={checked.includes(option.id)}
						>
							<input
								type="checkbox"
								value={option.id}
								checked={checked.includes(option.id)}
								onChange={() => toggleChecked(option.id)}
							/>
							<span className="sc-choice-label">{option.label || option.id}</span>
						</label>
					))}
				</div>
			)}

			{isDocument &&
				fields.map((field) => (
					<label key={field} className="sc-field">
						<span className="sc-field-label">{field}</span>
						<input
							className="sc-input"
							maxLength={MAX_INPUT}
							value={fieldValues[field] ?? ""}
							onChange={(event) => {
								const value = event.currentTarget.value;
								setFieldValues((prev) => ({ ...prev, [field]: value }));
							}}
						/>
					</label>
				))}

			{allowCustom &&
				(needsSingle ? (
					<label
						className="sc-choice"
						data-other="true"
						data-checked={choice === OTHER}
					>
						<input
							type="radio"
							name={`scenario-single-${affordance.id}`}
							value={OTHER}
							checked={choice === OTHER}
							onChange={() => setChoice(OTHER)}
						/>
						<span className="sc-choice-label">{OTHER_ENTRY_LABEL}</span>
					</label>
				) : (
					<label className="sc-choice" data-other="true" data-checked={otherOn}>
						<input
							type="checkbox"
							checked={otherOn}
							onChange={(event) => setOtherOn(event.currentTarget.checked)}
						/>
						<span className="sc-choice-label">{OTHER_ENTRY_LABEL}</span>
					</label>
				))}

			{allowCustom && wantsCustom && (
				<label className="sc-field">
					<span className="sc-field-label">自己写</span>
					<textarea
						className="sc-textarea"
						rows={2}
						maxLength={MAX_INPUT}
						value={otherText}
						onChange={(event) => setOtherText(event.currentTarget.value)}
					/>
				</label>
			)}

			<div className="sc-form-actions">
				<button
					type="button"
					className="sc-btn"
					disabled={!canSubmit || busy}
					onClick={submit}
				>
					就做这件事
				</button>
				<button type="button" className="sc-ghost-btn" onClick={onCancel}>
					收起
				</button>
			</div>
		</div>
	);
}
