import { useMediaQuery } from "@/hooks/useMediaQuery";

export default function LoginIllustration() {
	const visible = useMediaQuery("(min-width: 1024px)");

	if (!visible) return null;

	return (
		<div className="hidden lg:flex lg:w-1/2 items-center justify-center">
			<svg
				viewBox="0 0 400 320"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				role="img"
				aria-label="护理病史采集技能训练"
				className="w-full max-w-md"
			>
				{/* Decorative background circle */}
				<circle cx="200" cy="160" r="130" fill="var(--accent, #f0fdfa)" />
				<circle cx="200" cy="160" r="100" fill="var(--accent, #ccfbf1)" opacity="0.5" />

				{/* Medical cross icon */}
				<rect x="188" y="100" width="24" height="70" rx="4" fill="var(--primary, #0f766e)" />
				<rect x="165" y="128" width="70" height="24" rx="4" fill="var(--primary, #0f766e)" />

				{/* Stethoscope decorative elements */}
				<circle cx="200" cy="230" r="16" stroke="var(--primary, #0f766e)" strokeWidth="2.5" fill="none" />
				<line x1="200" y1="246" x2="200" y2="260" stroke="var(--primary, #0f766e)" strokeWidth="2.5" strokeLinecap="round" />
				<line x1="192" y1="256" x2="208" y2="256" stroke="var(--primary, #0f766e)" strokeWidth="2" strokeLinecap="round" />
				<path d="M200 260 Q200 272 190 276" stroke="var(--primary, #0f766e)" strokeWidth="2" fill="none" strokeLinecap="round" />

				{/* Small floating decorative dots */}
				<circle cx="120" cy="90" r="4" fill="var(--primary, #0f766e)" opacity="0.15" />
				<circle cx="290" cy="100" r="3" fill="var(--primary, #0f766e)" opacity="0.12" />
				<circle cx="310" cy="220" r="5" fill="var(--primary, #0f766e)" opacity="0.10" />
				<circle cx="90" cy="210" r="3" fill="var(--primary, #0f766e)" opacity="0.12" />
				<circle cx="140" cy="270" r="2.5" fill="var(--primary, #0f766e)" opacity="0.10" />
				<circle cx="270" cy="270" r="3.5" fill="var(--primary, #0f766e)" opacity="0.10" />

				{/* Heartbeat line */}
				<polyline
					points="100,170 125,170 135,130 150,190 160,165 175,175 185,150 200,180 215,145 225,170 240,160 250,185 265,130 275,170 300,170"
					stroke="var(--primary, #0f766e)"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					opacity="0.25"
					fill="none"
				/>

				{/* Bottom label decoration */}
				<text
					x="200"
					y="300"
					textAnchor="middle"
					fill="var(--muted-foreground, #64748b)"
					fontSize="11"
					fontFamily="system-ui, sans-serif"
					opacity="0.5"
				>
					护理病史采集技能训练
				</text>
			</svg>
		</div>
	);
}
