/**
 * 时间点定位：页面给了 `onLocateTurn` 就是按钮，没给就是纯文本（信息一样在）。
 *
 * 线索板 / 设备面 / 时间线三处呈现同一条"时间单位 N"，只写这一份——
 * 可点性不是三块各自的排版细节，而是同一个"变化可追溯到来源时间点"的承诺。
 */
export default function TurnLocator({
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
