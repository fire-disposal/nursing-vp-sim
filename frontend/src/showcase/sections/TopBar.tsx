import { Stethoscope } from "lucide-react";
import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { CTA_HREF, CTA_LABEL, PRODUCT_NAME } from "../data";

export default function TopBar() {
	return (
		<header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/60 backdrop-blur-xl transition-all">
			<div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:h-[4.5rem]">
				<div className="flex items-center gap-3">
					<div className="group relative">
						<div className="absolute -inset-1 rounded-xl bg-gradient-to-tr from-primary to-blue-500 opacity-20 blur group-hover:opacity-40" />
						<div className="relative flex size-9 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/20 lg:size-10">
							<Stethoscope size={20} strokeWidth={1.5} className="text-primary-foreground lg:size-[22px]" />
						</div>
					</div>
					<div className="flex flex-col leading-none">
						<span className="text-base font-bold tracking-tight lg:text-lg">{PRODUCT_NAME}</span>
						<span className="text-[10px] font-medium uppercase tracking-[0.24em] text-muted-foreground">Training System</span>
					</div>
				</div>
				<Link 
					to={CTA_HREF} 
					className={buttonVariants({ 
						size: "sm",
						className: "rounded-full px-5 text-sm font-semibold"
					})}
				>
					{CTA_LABEL}
				</Link>
			</div>
		</header>
	);
}
