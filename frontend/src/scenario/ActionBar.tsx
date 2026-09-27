import { type KeyboardEvent, useEffect, useRef } from "react";
import type {
	ScenarioActionInput,
	ScenarioAffordance,
	ScenarioOption,
	ScenarioView,
} from "@/api/scenario";
import AffordanceForm from "./AffordanceForm";

export interface ActionBarProps {
	view: ScenarioView;
	busy: boolean;
	/** 自由表达的文本由页面持有：点在场者要能预填。 */
	freeText: string;
	onFreeTextChange: (text: string) => void;
	onSubmit: (action: ScenarioActionInput) => void;
	errorMessage?: string | null;
	/** 每次变化 = "把焦点送回输入框"（回合落地后由页面递增）。 */
	focusToken?: number;
	/** DM 提示指向的表单型动作；由页面持有（选项条与页面共用同一份流程状态）。 */
	openAffordance?: ScenarioAffordance | null;
	/** 表单的「收起」；提交后的清空也由页面做。 */
	onCloseForm: () => void;
}

/**
 * 输入上限：与后端 `ActionRequest.text/custom_text` 的 2000 字符一致
 * （沿用仓库既有约定，见 `components/training/ChatBubble.tsx`）。
 * 不设上限的话，粘贴一段病程记录就会换来一个 422。
 */
const MAX_INPUT = 2000;

/** DM 提示最多显示几条：人不是预编程机器人，三条提示足够点一下思路，多了就成了菜单。 */
const MAX_OPTIONS = 3;

/**
 * 气泡流里的 DM 提示条：跟着最新一条消息，随消息一起滚走。
 *
 * 纯展示：点哪条由页面决定（提示可能落在表单型动作上，页面知道该展开表单还是直接提交）。
 * 没有提示就返回 `null`——不给空容器留出占位的白。
 */
export function ScenarioOptionStrip({
	options,
	busy,
	onChoose,
}: {
	options: ScenarioOption[];
	busy: boolean;
	onChoose: (option: ScenarioOption) => void;
}) {
	if (options.length === 0) return null;

	return (
		<div className="sc-options">
			{options.slice(0, MAX_OPTIONS).map((option, index) => (
				<button
					key={`${option.label}-${index}`}
					type="button"
					className="sc-option"
					disabled={busy}
					onClick={() => onChoose(option)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

/**
 * 底部动作区：**自由表达是主控件**，DM 的提示是配角。
 *
 * - 输入框常驻（多行、可增长），Enter 发送、Shift+Enter 换行；
 * - `openAffordance`：DM 提示落在选择型 / 记录表单上时就地展开，状态由页面持有；
 * - pack 的 `affordances` 列表**不出现在界面上**：那是"理论上可做的事"，
 *   一次性摊开会把学生教成点菜单的人。要做什么，自己写。
 */
export default function ActionBar({
	view,
	busy,
	freeText,
	onFreeTextChange,
	onSubmit,
	errorMessage,
	focusToken = 0,
	openAffordance = null,
	onCloseForm,
}: ActionBarProps) {
	const freeAreaRef = useRef<HTMLTextAreaElement>(null);

	// 自由表达由 pack 的 `view.free_input` 决定（后端默认 true）；显式关掉的是封闭文书型情境。
	const freeEnabled = view.free_input !== false;

	useEffect(() => {
		if (focusToken === 0 || !freeEnabled) return;
		freeAreaRef.current?.focus();
	}, [focusToken, freeEnabled]);

	const submitFree = () => {
		const text = freeText.trim().slice(0, MAX_INPUT);
		if (!text || busy) return;
		onSubmit({ type: "ask", text });
	};

	// Enter 发送、Shift+Enter 换行（组合键不拦，交给浏览器插入换行）。
	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key !== "Enter" || event.shiftKey) return;
		event.preventDefault();
		submitFree();
	};

	return (
		<section className="sc-actions" aria-label="动作区">
			{openAffordance && (
				<AffordanceForm
					key={openAffordance.id}
					affordance={openAffordance}
					busy={busy}
					onSubmit={onSubmit}
					onCancel={onCloseForm}
				/>
			)}

			{errorMessage && (
				<div className="sc-error" role="alert">
					{errorMessage}
				</div>
			)}

			{freeEnabled && (
				<div className="sc-actions-row">
					<textarea
						ref={freeAreaRef}
						className="sc-textarea"
						rows={2}
						maxLength={MAX_INPUT}
						aria-label="你要做什么"
						placeholder="你要做什么？"
						value={freeText}
						disabled={busy}
						onChange={(event) => onFreeTextChange(event.currentTarget.value)}
						onKeyDown={onKeyDown}
					/>
					<button
						type="button"
						className="sc-btn"
						data-kind="send"
						disabled={busy || freeText.trim().length === 0}
						onClick={submitFree}
					>
						发送
					</button>
				</div>
			)}
		</section>
	);
}
