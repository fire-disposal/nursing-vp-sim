import {
	Bar,
	CartesianGrid,
	ComposedChart,
	Legend,
	Line,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import { useBarColors, useChartTheme } from "@/hooks/useChartTheme";

export interface TrendPoint {
	date: string;
	sessions: number;
	avg_score?: number | null;
}

interface Props {
	data: TrendPoint[];
	/** 右轴（得分）范围：学生详情看满分区间，教学看板看及格线附近的分布 */
	scoreDomain: [number, number];
}

/**
 * 双轴骨架：左轴「次数」、右轴按调用方给的单位与范围。
 * 教学看板的两张图与学生详情图共用它，避免轴标签/刻度各写一遍。
 */
export function TrendAxes({ rightLabel, rightDomain }: { rightLabel: string; rightDomain?: [number, number] }) {
	const chartTheme = useChartTheme();
	return (
		<>
			<CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
			<XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(v: string) => v.slice(5)} />
			<YAxis
				yAxisId="left"
				tick={{ fontSize: 12 }}
				label={{ value: "次数", position: "insideLeft", offset: -5, style: { fontSize: 12 } }}
			/>
			<YAxis
				yAxisId="right"
				orientation="right"
				domain={rightDomain}
				tick={{ fontSize: 12 }}
				label={{ value: rightLabel, position: "insideRight", offset: -5, style: { fontSize: 12 } }}
			/>
		</>
	);
}

/**
 * 「训练次数」柱 + 「平均得分」线：学生详情页与教学看板共用这一份图定义
 * （坐标标签、单位、颜色、提示框此前各写了一遍，容易改一处漏一处）。
 */
export function TrainingTrendChart({ data, scoreDomain }: Props) {
	const barColors = useBarColors();

	return (
		<ResponsiveContainer width="100%" height={280}>
			<ComposedChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
				<TrendAxes rightLabel="得分" rightDomain={scoreDomain} />
				<Tooltip content={<ChartTooltip />} />
				<Legend />
				<Bar
					yAxisId="left"
					dataKey="sessions"
					name="训练次数"
					fill={barColors.sessions}
					radius={[4, 4, 0, 0]}
					barSize={28}
				/>
				<Line
					yAxisId="right"
					type="monotone"
					dataKey="avg_score"
					name="平均得分"
					stroke={barColors.score}
					strokeWidth={2.5}
					dot={{ r: 4, fill: barColors.score }}
					connectNulls
				/>
			</ComposedChart>
		</ResponsiveContainer>
	);
}
