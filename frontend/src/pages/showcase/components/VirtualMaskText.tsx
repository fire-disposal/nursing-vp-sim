import { useId } from "react";

interface VirtualMaskTextProps {
	text: string;
	className?: string;
	viewBoxWidth?: number;
	viewBoxHeight?: number;
	fontSize?: number;
	textWidth?: string;
}

export default function VirtualMaskText({
	text,
	className,
	viewBoxWidth = 300,
	viewBoxHeight = 150,
	fontSize = 116,
	textWidth = "2.45em",
}: VirtualMaskTextProps) {
	const maskId = useId();

	return (
		<svg
			viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
			aria-hidden="true"
			className={`inline-block h-[1.14em] align-baseline ${className ?? ""}`}
			style={{ width: textWidth }}
		>
			<defs>
				<mask id={maskId}>
					<rect width="100%" height="100%" fill="black" />
					<text
						x="0"
						y="116"
						fill="white"
						fontSize={fontSize}
						fontWeight="900"
						fontFamily="Geist Variable, Inter, system-ui, sans-serif"
						letterSpacing="-8"
					>
						{text}
					</text>
				</mask>
			</defs>

			<g mask={`url(#${maskId})`}>
				<rect width="100%" height="100%" fill="var(--primary)" fillOpacity="0.10" />
				<g>
					<g>
						<text x="0" y="28" fill="var(--primary)" fillOpacity="0.55" fontSize="13" fontWeight="800" letterSpacing="1.6">
							LLM · RAG · Prompt · SSE
						</text>
						<text x="0" y="52" fill="var(--primary)" fillOpacity="0.4" fontSize="13" fontWeight="800" letterSpacing="1.6">
							TTS · ASR · Emotion · Memory
						</text>
						<text x="0" y="76" fill="var(--primary)" fillOpacity="0.45" fontSize="13" fontWeight="800" letterSpacing="1.6">
							Guard · Context · Explainable
						</text>
						<text x="0" y="100" fill="var(--primary)" fillOpacity="0.35" fontSize="13" fontWeight="800" letterSpacing="1.6">
							Flow · State · Feedback
						</text>
					</g>
					<g transform="translate(0 104)">
						<text x="0" y="28" fill="var(--primary)" fillOpacity="0.55" fontSize="13" fontWeight="800" letterSpacing="1.6">
							LLM · RAG · Prompt · SSE
						</text>
						<text x="0" y="52" fill="var(--primary)" fillOpacity="0.4" fontSize="13" fontWeight="800" letterSpacing="1.6">
							TTS · ASR · Emotion · Memory
						</text>
						<text x="0" y="76" fill="var(--primary)" fillOpacity="0.45" fontSize="13" fontWeight="800" letterSpacing="1.6">
							Guard · Context · Explainable
						</text>
						<text x="0" y="100" fill="var(--primary)" fillOpacity="0.35" fontSize="13" fontWeight="800" letterSpacing="1.6">
							Flow · State · Feedback
						</text>
					</g>
					<animateTransform
						attributeName="transform"
						type="translate"
						from="0 0"
					to="0 -104"
					dur="18s"
						repeatCount="indefinite"
					/>
				</g>
			</g>

			<text
				x="0"
				y="116"
				fill="transparent"
				stroke="var(--primary)"
				strokeWidth="1.5"
				fontSize={fontSize}
				fontWeight="900"
				fontFamily="Geist Variable, Inter, system-ui, sans-serif"
				letterSpacing="-8"
			>
				{text}
			</text>
		</svg>
	);
}