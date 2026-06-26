interface SectionHeadingProps {
	eyebrow?: string;
	title: string;
	className?: string;
}

export default function SectionHeading({
	eyebrow,
	title,
	className,
}: SectionHeadingProps) {
	return (
		<div className={`flex flex-col gap-2 ${className ?? ""}`}>
			{eyebrow ? (
				<span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/90">
					{eyebrow}
				</span>
			) : null}
			<h2 className="text-3xl font-bold tracking-tight md:text-[2.6rem] lg:text-5xl [font-family:'Geist_Variable',sans-serif]">
				{title}
			</h2>
		</div>
	);
}
