import { Stethoscope } from "lucide-react";
import { Link } from "react-router-dom";
import { CTA_HREF, CTA_LABEL, PRODUCT_NAME } from "../data";

export default function TopBar() {
	return (
		<header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
			<div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
				<div className="flex items-center gap-2.5">
					<div className="flex size-9 items-center justify-center rounded-xl bg-primary">
						<Stethoscope size={20} strokeWidth={1.5} className="text-primary-foreground" />
					</div>
					<span className="font-semibold tracking-tight">{PRODUCT_NAME}</span>
				</div>
				<Link
					to={CTA_HREF}
					className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition active:scale-[0.98]"
				>
					{CTA_LABEL}
				</Link>
			</div>
		</header>
	);
}
