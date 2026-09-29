import { useState } from "react";
import type {
	ScenarioBoard,
	ScenarioBoardEntry,
	ScenarioBoardSection,
} from "@/api/scenario";
import { sourceLabel } from "./stream";

/**
 * 线索板（白板）——**只读、按需具现**的事实区。
 *
 * 硬要求（本次改造）：
 * - 板内**没有任何输入控件/编辑按钮**：学生只能通过"做了什么事"让它长出来；这里只用
 *   `<span>`/`<div>` 呈现，连"新建"之类的假入口都不给。
 * - **单行**：`text` 已由后端压成一行并限长，前端不再截断、不再补全、不再展开成段落。
 * - 空版块不渲染；整块全空时只给一句空态。
 * - 版块与条目都由后端的触发条件投影决定：此刻没有的版块**就是还没有**，
 *   前端不缓存旧视图、不自己补位（`view.board` 每次响应重算）。
 * - 事实的**发生时间点**（`entry.turn`，时间单位，不是"第几次提交"）与**来源引用**（`entry.ref`）如实标出；
 *   时间点可点：由页面把它滚进视野（`onLocateTurn`，页面不传时退化为纯文本）。
 */

/** 版块超出这个条数才在客户端折叠（后端每版块上限 20；阈值低一档是为了"默认收起"）。 */
const COLLAPSE_AT = 8;

/** 类别的中文名（只用于色点的 `title`；版块标题本身已经说了这一组是什么）。 */
const KIND_TITLE: Record<string, string> = {
	cue: "现场看到",
	state: "读数",
	noticed: "你注意到的",
	fact: "已确认",
	action: "已处置",
};

/** 时间点定位：页面给了 `onLocateTurn` 就是按钮，没给就是纯文本（信息一样在）。 */
function TurnLocator({
	turn,
	onLocateTurn,
}: {
	turn: number;
	onLocateTurn?: (turn: number) => void;
}) {
	if (onLocateTurn === undefined) {
		return <span className="sc-locate">时间单位 {turn}</span>;
	}
	return (
		<button
			type="button"
			className="sc-locate"
			onClick={() => onLocateTurn(turn)}
		>
			时间单位 {turn}
		</button>
	);
}

function BoardEntry({
	entry,
	onLocateTurn,
}: {
	entry: ScenarioBoardEntry;
	onLocateTurn?: (turn: number) => void;
}) {
	// 已处置的条目后端已把次数写进文案（「某动作 ×3」），这里只在文案没写时才补徽章，
	// 免得同一件事说两遍。
	const count = entry.count ?? 0;
	const showCount = count > 1 && !entry.text.includes(`×${count}`);
	const turn = entry.turn ?? null;
	const ref = entry.ref ?? null;
	return (
		<div
			className="sc-board-entry"
			data-entry-id={entry.id}
			data-board-kind={entry.kind}
			title={KIND_TITLE[entry.kind] ?? entry.kind}
		>
			<div className="sc-board-main">
				<div className="sc-board-text">
					<span className="sc-board-line">{entry.text}</span>
					{showCount && <span className="sc-board-count">×{count}</span>}
				</div>
				{entry.evidence && (
					<div className="sc-board-evidence">「{entry.evidence}」</div>
				)}
				{(ref !== null || turn !== null) && (
					<div className="sc-board-meta">
						{ref !== null && (
							<span className="sc-board-source">{sourceLabel(ref)}</span>
						)}
						{turn !== null && (
							<TurnLocator turn={turn} onLocateTurn={onLocateTurn} />
						)}
					</div>
				)}
			</div>
		</div>
	);
}

function BoardSection({
	section,
	onLocateTurn,
}: {
	section: ScenarioBoardSection;
	onLocateTurn?: (turn: number) => void;
}) {
	const [open, setOpen] = useState(false);
	const entries = section.entries ?? [];
	const collapsible = entries.length > COLLAPSE_AT;
	const shown = collapsible && !open ? entries.slice(0, COLLAPSE_AT) : entries;
	const hidden = entries.length - shown.length;

	return (
		<section
			className="sc-board-section"
			data-board-section={section.id}
			aria-label={section.title}
		>
			<div className="sc-board-section-head">
				<span className="sc-board-section-title">{section.title}</span>
			</div>
			{shown.map((entry) => (
				<BoardEntry key={entry.id} entry={entry} onLocateTurn={onLocateTurn} />
			))}
			{collapsible && (
				<button
					type="button"
					className="sc-board-more"
					aria-expanded={open}
					onClick={() => setOpen((value) => !value)}
				>
					{open ? "收起" : `展开其余 ${hidden} 条`}
				</button>
			)}
			{/* 后端只给"被截掉的条数"，没给那些条目本身 → 这里只能如实给个数量 */}
			{section.more > 0 && (
				<div className="sc-board-more-hint">还有 {section.more} 条</div>
			)}
		</section>
	);
}

export default function BoardPanel({
	board,
	onLocateTurn,
}: {
	board: ScenarioBoard;
	/** 点事实的来源时间点 → 页面把它滚进视野（不传则不渲染可点时间点）。 */
	onLocateTurn?: (turn: number) => void;
}) {
	// 空版块不渲染：新会话里 `noticed` 之类常常一条都没有。
	const sections = (board.sections ?? []).filter(
		(section) => (section.entries ?? []).length > 0,
	);

	if (sections.length === 0) {
		return (
			<div className="sc-board" data-empty="true">
				<div className="sc-empty">还没有线索。</div>
			</div>
		);
	}

	return (
		<div className="sc-board">
			{sections.map((section) => (
				<BoardSection
					key={section.id}
					section={section}
					onLocateTurn={onLocateTurn}
				/>
			))}
		</div>
	);
}
