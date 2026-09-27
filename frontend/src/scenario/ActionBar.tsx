import { IconHandGrab } from "@tabler/icons-react";
import { type KeyboardEvent, useEffect, useRef } from "react";
import type {
	ScenarioActionInput,
	ScenarioAffordance,
	ScenarioOption,
	ScenarioView,
} from "@/api/scenario";
import AffordanceForm from "./AffordanceForm";
import { PRESENCE_HINT, presenceInteractive } from "./actors";

/**
 * 学生**先声明、再说话**：这一句是"对某个在场者说"还是"我要做一件事"。
 *
 * 声明是发送的前提（未选不能发送）：平台因此知道这句是"对谁说"还是"要做什么"，
 * 引擎不再一律记成自由发问，DM 也知道该以对话还是以行动后果回应。
 */
export type ScenarioIntent = { kind: "say"; actorId: string } | { kind: "act" };

export interface ActionBarProps {
	view: ScenarioView;
	busy: boolean;
	/** 自由表达的文本由页面持有：点在场者 chip 时要能把焦点送回来。 */
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
	/** 本回合的声明；`null` = 还没选（发送停着）。由页面持有，随会话重置。 */
	intent: ScenarioIntent | null;
	onIntentChange: (intent: ScenarioIntent) => void;
}

/**
 * 输入上限：与后端 `ActionRequest.text/custom_text` 的 2000 字符一致
 * （沿用仓库既有约定，见 `components/training/ChatBubble.tsx`）。
 * 不设上限的话，粘贴一段病程记录就会换来一个 422。
 */
const MAX_INPUT = 2000;

/** DM 提示最多显示几条：人不是预编程机器人，三条提示足够点一下思路，多了就成了菜单。 */
const MAX_OPTIONS = 3;

/** 「自定义行动」= 不针对某个人的一件事（沿用用户给的叫法，不自创套话）。 */
export const CUSTOM_ACTION_LABEL = "自定义行动";

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
 * 底部动作区：**先声明这一句是对谁说的（或要做一件事），再写内容**。
 *
 * - chip 是**单选**：在场者（可搭话的人）与「自定义行动」；没选 → 发送停着（不是灰着好看，
 *   是真的发不出去：引擎要按声明记这一回合）；
 * - 输入框、chip 与发送是**一组控件**：同一个容器、同一套边框与底色，1px 分隔；
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
	intent,
	onIntentChange,
}: ActionBarProps) {
	const freeAreaRef = useRef<HTMLTextAreaElement>(null);

	// 自由表达由 pack 的 `view.free_input` 决定（后端默认 true）；显式关掉的是封闭文书型情境。
	const freeEnabled = view.free_input !== false;
	// chip 只列**搭得上话**的人：`inaccessible`（看得见、碰不着）沿用既有过滤逻辑，不在这排里。
	const talkable = view.actors.filter((actor) => presenceInteractive(actor.presence));
	const target =
		intent?.kind === "say"
			? (talkable.find((actor) => actor.id === intent.actorId) ?? null)
			: null;
	const declarationMade = intent !== null && (intent.kind === "act" || target !== null);
	const canSend = !busy && declarationMade && freeText.trim().length > 0;

	// 输入区按内容长高（一行起步，上限由 CSS 的 `max-height` 定在 4 行，再多自己滚）：
	// 高度只由内容决定，不靠固定 min-height 占位。
	useEffect(() => {
		const area = freeAreaRef.current;
		if (!area) return;
		area.style.height = "auto";
		area.style.height = `${area.scrollHeight}px`;
	}, [freeText, focusToken]);

	useEffect(() => {
		if (focusToken === 0 || !freeEnabled) return;
		freeAreaRef.current?.focus();
	}, [focusToken, freeEnabled]);

	const submitFree = () => {
		const text = freeText.trim().slice(0, MAX_INPUT);
		if (!text || !canSend || intent === null) return;
		// 声明与内容一起交给后端：对在场者说话带收信人，自定义行动不带。
		if (intent.kind === "say" && target !== null) {
			onSubmit({ type: "say", text, target_actor_id: target.id });
			return;
		}
		onSubmit({ type: "act", text });
	};

	// Enter 发送、Shift+Enter 换行（组合键不拦，交给浏览器插入换行）。
	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key !== "Enter" || event.shiftKey) return;
		event.preventDefault();
		submitFree();
	};

	/** 选 chip = 选声明，并把焦点送进输入框（下一步就是写内容）。 */
	const chooseIntent = (next: ScenarioIntent) => {
		onIntentChange(next);
		freeAreaRef.current?.focus();
	};

	const placeholder =
		intent === null
			? `先选：对谁说 / ${CUSTOM_ACTION_LABEL}`
			: target !== null
				? `对${target.role}说`
				: "要做的事";

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
				<div className="sc-composer" data-busy={busy ? "true" : undefined}>
					{/* 单选组：在场者（对谁说）+「自定义行动」。fieldset 是单选组该有的元素（a11y）。 */}
					<fieldset
						className="sc-intents"
						aria-label="这句话是对谁说的"
					>
						{talkable.map((actor) => {
							const hint = PRESENCE_HINT[actor.presence] ?? actor.presence;
							return (
								<button
									key={actor.id}
									type="button"
									className="sc-intent"
									data-presence={actor.presence}
									aria-pressed={
										intent?.kind === "say" && intent.actorId === actor.id
									}
									disabled={busy}
									onClick={() =>
										chooseIntent({ kind: "say", actorId: actor.id })
									}
								>
									<span className="sc-intent-dot" aria-hidden="true" />
									<span>{actor.role}</span>
									{hint !== "" && (
										<span className="sc-intent-hint">{hint}</span>
									)}
								</button>
							);
						})}
						<button
							type="button"
							className="sc-intent"
							aria-pressed={intent?.kind === "act"}
							disabled={busy}
							onClick={() => chooseIntent({ kind: "act" })}
						>
							<IconHandGrab size={12} aria-hidden="true" />
							<span>{CUSTOM_ACTION_LABEL}</span>
						</button>
					</fieldset>

					<div className="sc-composer-input">
						<textarea
							ref={freeAreaRef}
							className="sc-textarea"
							rows={1}
							maxLength={MAX_INPUT}
							aria-label="你要做什么"
							placeholder={placeholder}
							value={freeText}
							disabled={busy}
							onChange={(event) =>
								onFreeTextChange(event.currentTarget.value)
							}
							onKeyDown={onKeyDown}
						/>
						<button
							type="button"
							className="sc-btn sc-send"
							disabled={!canSend}
							onClick={submitFree}
						>
							发送
						</button>
					</div>
				</div>
			)}
		</section>
	);
}
