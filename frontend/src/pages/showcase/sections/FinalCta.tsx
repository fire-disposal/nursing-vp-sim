import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { CTA_HREF, CTA_LABEL, PRODUCT_NAME } from "../data";

export default function FinalCta() {
	return (
		<>
			<section className="px-6 py-24 text-center md:py-28">
				<div className="mx-auto flex max-w-2xl flex-col items-center gap-6">
					<h2 className="text-3xl font-bold tracking-tight md:text-4xl lg:text-5xl [font-family:'Geist_Variable',sans-serif]">
						开始一次虚拟患者训练
					</h2>
					<Link to={CTA_HREF} className={buttonVariants({ size: "lg" })}>
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
