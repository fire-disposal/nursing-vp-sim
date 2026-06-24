import Reveal from "../components/Reveal";
import SectionHeading from "../components/SectionHeading";
import { ENGINEERING } from "../data";

export default function EngineeringBand() {
	return (
		<section className="mx-auto max-w-7xl px-6 py-20">
			<SectionHeading eyebrow="工程化底座" title="可观测、可控、可部署" className="mb-10" />
			<Reveal>
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
					{ENGINEERING.map((c) => (
						<div
							key={c.label}
							className="rounded-2xl border border-border bg-card px-4 py-5 text-center text-sm font-medium text-foreground/80"
						>
							{c.label}
						</div>
					))}
				</div>
			</Reveal>
		</section>
	);
}
