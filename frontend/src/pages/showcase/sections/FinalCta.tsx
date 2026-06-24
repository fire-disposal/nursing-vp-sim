import { Link } from "react-router-dom";
import { CTA_HREF, CTA_LABEL, PRODUCT_NAME } from "../data";

export default function FinalCta() {
	return (
		<>
			<section className="relative overflow-hidden px-6 py-32 text-center">
				<div className="pointer-events-none absolute left-1/2 top-1/2 size-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl" />
				<div className="relative mx-auto flex max-w-2xl flex-col items-center gap-6">
					<h2 className="text-3xl font-bold tracking-tight md:text-5xl [font-family:'Geist_Variable',sans-serif]">
						开始一次虚拟患者训练
					</h2>
					<Link
						to={CTA_HREF}
						className="inline-flex h-12 items-center rounded-full bg-primary px-8 font-medium text-primary-foreground transition active:scale-[0.98] hover:-translate-y-px"
					>
						{CTA_LABEL}
					</Link>
				</div>
			</section>
			<footer className="border-t border-border/60 py-8 text-center text-sm text-muted-foreground">
				{PRODUCT_NAME} · 2026
			</footer>
		</>
	);
}
