import { useState } from "react";
import type {
	ScenarioActionInput,
	ScenarioAffordance,
	ScenarioOption,
	ScenarioView,
} from "@/api/scenario";
import { useConfirm } from "@/components/ui/confirm";
import AffordanceForm from "./AffordanceForm";

interface ActionBarProps {
	view: ScenarioView;
	busy: boolean;
	/** 自由通道的文本与展开态由页面持有：点在场者要能预填并展开它。 */
	freeText: string;
	freeOpen: boolean;
	onFreeTextChange: (text: string) => void;
	onFreeOpenChange: (open: boolean) => void;
	onSubmit: (action: ScenarioActionInput) => void;
	errorMessage?: string | null;
}

/**
 * 动作区：按钮是主角，输入框是配角。
 *
 * - `options`：DM 建议的下一步（按钮 = affordance 的可见形态，随情境变化）；
 * - `affordances`：本情境此刻可做的事（含选择型 / 记录表单，展开后带自输入入口）；
 * - 自由通道：始终存在的"自己写一句"，默认收成一行，展开即自由发问。
 */
export default function ActionBar({
	view,
	busy,
	freeText,
	freeOpen,
	onFreeTextChange,
	onFreeOpenChange,
	onSubmit,
	errorMessage,
}: ActionBarProps) {
	const { confirm } = useConfirm();
	const [openId, setOpenId] = useState<string | null>(null);
	const openAffordance =
		view.affordances.find((item) => item.id === openId) ?? null;
	// 自由通道由 pack 的 `view.free_input` 决定（后端默认 true）；显式关掉时才收起。
	const freeEnabled = view.free_input !== false;

	/** `confirm: true` 的动作都要二次确认——直接执行的和表单提交的都一样。 */
	const submitConfirmed = async (
		action: ScenarioActionInput,
		label: string,
		needsConfirm: boolean,
	) => {
		if (needsConfirm) {
			const ok = await confirm({
				title: label,
				message: "这个动作可能不可逆，确定要做吗？",
				confirmLabel: "就做这件事",
				danger: true,
			});
			if (!ok) return;
		}
		onSubmit(action);
	};

	const runAffordance = async (affordance: ScenarioAffordance) => {
		// 选择型（single/multi）与记录表单（document）要展开表单，其余一键即做
		if (affordance.select !== "none" || affordance.type === "document") {
			setOpenId(affordance.id);
			return;
		}
		await submitConfirmed(
			{ affordance_id: affordance.id, type: affordance.type },
			affordance.label,
			affordance.confirm,
		);
	};

	const runOption = (option: ScenarioOption) => {
		const linked = option.affordance_id
			? view.affordances.find((item) => item.id === option.affordance_id)
			: undefined;
		// DM 的选项若落在选择型/表单动作上，展开表单而不是替学生把选项定死
		if (
			linked &&
			(linked.select !== "none" || linked.type === "document")
		) {
			setOpenId(linked.id);
			return;
		}
		// 建议按钮与动作按钮是同一个动作的两种入口：危险动作从哪进都要问一次
		submitConfirmed(
			{
				affordance_id: option.affordance_id ?? null,
				type: option.type ?? "ask",
				text: option.label ?? null,
			},
			option.label ?? linked?.label ?? "这个动作",
			linked?.confirm === true,
		);
	};

	const submitFree = () => {
		const text = freeText.trim();
		if (!text || busy) return;
		onSubmit({ type: "ask", text });
	};

	return (
		<section className="sc-actions" aria-label="动作区">
			{view.options.length > 0 && (
				<>
					<span className="sc-actions-title">此刻值得做的</span>
					<div className="sc-buttons">
						{view.options.map((option, index) => (
							<button
								key={`${option.label}-${index}`}
								type="button"
								className="sc-btn"
								data-kind="option"
								disabled={busy}
								onClick={() => runOption(option)}
							>
								{option.label}
							</button>
						))}
					</div>
				</>
			)}

			{view.affordances.length > 0 && (
				<>
					<span className="sc-actions-title">这里能做的事</span>
					<div className="sc-buttons">
						{view.affordances.map((affordance) => (
							<button
								key={affordance.id}
								type="button"
								className="sc-btn"
								data-kind="affordance"
								data-open={openId === affordance.id}
								disabled={busy}
								onClick={() => runAffordance(affordance)}
							>
								{affordance.label}
								<span className="sc-btn-tag">
									{affordance.type}
									{affordance.select !== "none" ? "·选择" : ""}
								</span>
							</button>
						))}
					</div>
				</>
			)}

			{openAffordance && (
				<AffordanceForm
					key={openAffordance.id}
					affordance={openAffordance}
					busy={busy}
					onSubmit={(action) => {
						setOpenId(null);
						submitConfirmed(
							action,
							openAffordance.label,
							openAffordance.confirm,
						);
					}}
					onCancel={() => setOpenId(null)}
				/>
			)}

			{errorMessage && <div className="sc-error">{errorMessage}</div>}

			{freeEnabled && (
				<div className="sc-free">
					<span className="sc-actions-title">自由通道</span>
					{freeOpen ? (
						<div className="sc-free-row">
							<textarea
								className="sc-textarea"
								rows={2}
								autoFocus
								aria-label="自己写一句"
								placeholder="想说什么、想做什么，直接写下来。"
								value={freeText}
								onChange={(event) => onFreeTextChange(event.currentTarget.value)}
							/>
							<button
								type="button"
								className="sc-btn"
								disabled={busy || freeText.trim().length === 0}
								onClick={submitFree}
							>
								发送
							</button>
							<button
								type="button"
								className="sc-ghost-btn"
								onClick={() => onFreeOpenChange(false)}
							>
								收起
							</button>
						</div>
					) : (
						<input
							className="sc-input"
							aria-label="自己写一句"
							placeholder="或者，自己写一句…"
							value={freeText}
							onFocus={() => onFreeOpenChange(true)}
							onChange={(event) => onFreeTextChange(event.currentTarget.value)}
						/>
					)}
				</div>
			)}
		</section>
	);
}
