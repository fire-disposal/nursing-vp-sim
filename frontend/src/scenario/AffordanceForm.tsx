import { useState } from "react";
import type { ScenarioActionInput, ScenarioAffordance } from "@/api/scenario";

/**
 * 自输入入口的固定文案。**由前端无条件提供**：pack/DM 被禁止提供同类选项
 * （后端 `_FREE_INPUT_LABELS` 会把 DM 给的"其他/自输入"整条丢掉并记账），
 * 所以"能不能自己写"不能依赖后端数据，只能在这里保证。
 */
export const OTHER_ENTRY_LABEL = "其他（自己输入）";

/**
 * 「其他」在选择型动作里的哨兵值：它**不进 `selected`**——列出的选项才是 `selected`，
 * 用户自己写的文本一律走 `custom_text`（后端判读 `accept_custom` 也只读 `custom_text`）。
 */
const OTHER = "\u0000scenario-other";

interface AffordanceFormProps {
	affordance: ScenarioAffordance;
	busy: boolean;
	onSubmit: (action: ScenarioActionInput) => void;
	onCancel: () => void;
}

/**
 * 选择型动作（`select: single|multi`）与记录表单（`type: document`）的展开形态。
 *
 * 入口：
 * 1. pack/DM 列出的选项（单选 / 多选）；
 * 2. `document` 的字段（`params.fields`）；
 * 3. **「其他（自己输入）」**——默认附加（平台保证，见 §九），
 *    只在作者显式写了 `free_input: false` 时收起，文本作为 `custom_text` 提交。
 *
 * 调用方按 `affordance.id` 挂 `key`，换动作即重置草稿（不靠 effect 清状态）。
 */
export default function AffordanceForm({
	affordance,
	busy,
	onSubmit,
	onCancel,
}: AffordanceFormProps) {
	const needsSingle = affordance.select === "single";
	const needsMulti = affordance.select === "multi";
	const isDocument = affordance.type === "document";
	// 自输入是平台保证的通道，但作者可以用 `free_input: false` 显式关掉（封闭文书类动作）；
	// 关掉时表单里就不出现「其他（自己输入）」——按钮与入口必须一致，不能只是不提交。
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

	const record = affordance.fields
		.map((field) => [field, (fieldValues[field] ?? "").trim()] as const)
		.filter(([, value]) => value.length > 0)
		.map(([field, value]) => `${field}：${value}`)
		.join("\n");

	const customText = otherText.trim();
	const canSubmit = needsSingle
		? choice !== "" && (choice !== OTHER || customText.length > 0)
		: needsMulti
			? checked.length > 0 || (otherOn && customText.length > 0)
			: record.length > 0 || customText.length > 0;

	const submit = () => {
		if (!canSubmit || busy) return;
		onSubmit({
			affordance_id: affordance.id,
			type: affordance.type,
			text: isDocument ? record || null : null,
			selected: needsSingle
				? choice !== OTHER
					? [choice]
					: []
				: needsMulti
					? checked
					: [],
			custom_text:
				(needsSingle ? choice === OTHER : otherOn) && customText ? customText : null,
		});
	};

	return (
		<div className="sc-form">
			<div className="sc-form-head">
				<span className="sc-form-title">{affordance.label}</span>
				<span className="sc-btn-tag">{affordance.type}</span>
			</div>

			{needsSingle && (
				<div className="sc-field">
					<span className="sc-field-label">选一项</span>
					{affordance.options.map((option) => (
						<label
							key={option}
							className="sc-choice"
							data-checked={choice === option}
						>
							<input
								type="radio"
								name={`scenario-single-${affordance.id}`}
								value={option}
								checked={choice === option}
								onChange={() => setChoice(option)}
							/>
							<span className="sc-choice-label">{option}</span>
						</label>
					))}
				</div>
			)}

			{needsMulti && (
				<div className="sc-field">
					<span className="sc-field-label">可多选</span>
					{affordance.options.map((option) => (
						<label
							key={option}
							className="sc-choice"
							data-checked={checked.includes(option)}
						>
							<input
								type="checkbox"
								value={option}
								checked={checked.includes(option)}
								onChange={() => toggleChecked(option)}
							/>
							<span className="sc-choice-label">{option}</span>
						</label>
					))}
				</div>
			)}

			{isDocument &&
				affordance.fields.map((field) => (
					<label key={field} className="sc-field">
						<span className="sc-field-label">{field}</span>
						<input
							className="sc-input"
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

			{allowCustom &&
				((needsSingle && choice === OTHER) || (!needsSingle && otherOn)) && (
					<label className="sc-field">
						<span className="sc-field-label">自己写（提交为自输入内容）</span>
						<textarea
							className="sc-textarea"
							rows={2}
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
