import { useId } from "react";

type MaskWordProps = {
	text: string;
	maskId: string;
	viewBoxWidth: number;
	viewBoxHeight: number;
	fontSize: number;
	textWidth: string;
	letterSpacing: string;
	lineY: [number, number, number, number];
	lineTexts: [string, string, string, string];
	lineOpacity: [string, string, string, string];
	lineFontSize: number;
	shiftY: number;
	duration: string;
	className?: string;
};

function MaskWord({
	text,
	maskId,
	viewBoxWidth,
	viewBoxHeight,
	fontSize,
	textWidth,
	letterSpacing,
	lineY,
	lineTexts,
	lineOpacity,
	lineFontSize,
	shiftY,
	duration,
	className,
}: MaskWordProps) {
	return (
		<svg
			viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
			aria-hidden="true"
			className={`block align-middle translate-y-[0.08em] ${className ?? ""}`}
			style={{ width: textWidth, height: "1.3em" }}
		>
			<defs>
				<mask id={maskId}>
					<rect width="100%" height="100%" fill="black" />
					<text
						x="0"
							y={Math.round(viewBoxHeight * 0.88)}
						fill="white"
						fontSize={fontSize}
						fontWeight="900"
						fontFamily="Geist Variable, Inter, system-ui, sans-serif"
						letterSpacing={letterSpacing}
					>
						{text}
					</text>
				</mask>
			</defs>

			<g mask={`url(#${maskId})`}>
				<rect width="100%" height="100%" fill="var(--primary)" fillOpacity="0.10" />
				<g>
					<g>
						<text x="0" y={lineY[0]} fill="var(--primary)" fillOpacity={lineOpacity[0]} fontSize={lineFontSize} fontWeight="800" letterSpacing="1.6">
							{lineTexts[0]}
						</text>
						<text x="0" y={lineY[1]} fill="var(--primary)" fillOpacity={lineOpacity[1]} fontSize={lineFontSize} fontWeight="800" letterSpacing="1.6">
							{lineTexts[1]}
						</text>
						<text x="0" y={lineY[2]} fill="var(--primary)" fillOpacity={lineOpacity[2]} fontSize={lineFontSize} fontWeight="800" letterSpacing="1.6">
							{lineTexts[2]}
						</text>
						<text x="0" y={lineY[3]} fill="var(--primary)" fillOpacity={lineOpacity[3]} fontSize={lineFontSize} fontWeight="800" letterSpacing="1.6">
							{lineTexts[3]}
						</text>
					</g>
					<g transform={`translate(0 ${shiftY})`}>
						<text x="0" y={lineY[0]} fill="var(--primary)" fillOpacity={lineOpacity[0]} fontSize={lineFontSize} fontWeight="800" letterSpacing="1.6">
							{lineTexts[0]}
						</text>
						<text x="0" y={lineY[1]} fill="var(--primary)" fillOpacity={lineOpacity[1]} fontSize={lineFontSize} fontWeight="800" letterSpacing="1.6">
							{lineTexts[1]}
						</text>
						<text x="0" y={lineY[2]} fill="var(--primary)" fillOpacity={lineOpacity[2]} fontSize={lineFontSize} fontWeight="800" letterSpacing="1.6">
							{lineTexts[2]}
						</text>
						<text x="0" y={lineY[3]} fill="var(--primary)" fillOpacity={lineOpacity[3]} fontSize={lineFontSize} fontWeight="800" letterSpacing="1.6">
							{lineTexts[3]}
						</text>
					</g>
					<animateTransform
						attributeName="transform"
						type="translate"
						from="0 0"
						to={`0 ${-shiftY}`}
						dur={duration}
						repeatCount="indefinite"
					/>
				</g>
			</g>

			<text
				x="0"
				y={Math.round(viewBoxHeight * 0.88)}
				fill="transparent"
				stroke="var(--primary)"
				strokeWidth="1.45"
				fontSize={fontSize}
				fontWeight="900"
				fontFamily="Geist Variable, Inter, system-ui, sans-serif"
					letterSpacing={letterSpacing}
			>
				{text}
			</text>
		</svg>
	);
}

export default function VirtualPatientMaskText() {
	const virtualMaskId = useId();
	const patientMaskId = useId();

	return (
		<span className="inline-flex items-center gap-0 align-middle leading-none whitespace-nowrap">
			<MaskWord
				text="虚拟"
				maskId={virtualMaskId}
				viewBoxWidth={340}
				viewBoxHeight={200}
				fontSize={180}
				textWidth="2.72em"
 				letterSpacing="-4"
				lineFontSize={13}
				lineY={[30, 56, 82, 108]}
				lineTexts={[
					"LLM · RAG · Prompt · SSE",
					"TTS · Emotion · Memory",
					"Guard · Context · Explainable",
					"Flow · State · Feedback",
				]}
				lineOpacity={["0.56", "0.38", "0.45", "0.34"]}
				shiftY={108}
				duration="18s"
			/>
			<MaskWord
				text="患者"
				maskId={patientMaskId}
				viewBoxWidth={340}
				viewBoxHeight={200}
				fontSize={180}
				textWidth="2.72em"
				letterSpacing="-6"
				lineFontSize={13}
				className="-ml-[0.36em]"
				lineY={[30, 56, 82, 108]}
				lineTexts={[
					"Evidence · Explainable · Review",
					"Scenario · Checkpoint · Trace",
					"Assessment · Notes · Context",
					"Dialogue · Status · Score",
				]}
				lineOpacity={["0.52", "0.4", "0.46", "0.36"]}
				shiftY={108}
				duration="22s"
			/>
		</span>
	);
}