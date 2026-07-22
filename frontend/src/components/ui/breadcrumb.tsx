import { ChevronRight, Home } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/utils/cn";

export interface BreadcrumbItem {
	label: string;
	to?: string;
}

interface BreadcrumbProps {
	items: BreadcrumbItem[];
	className?: string;
}

export default function Breadcrumb({ items, className }: BreadcrumbProps) {
	return (
		<nav className={cn("flex items-center gap-1 text-sm", className)}>
			<Link
				to="/admin"
				className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
			>
				<Home size={14} />
			</Link>
			{items.map((item, index) => {
				const isLast = index === items.length - 1;
				return (
					<span key={`${item.label}-${index}`} className="flex items-center gap-1">
						<ChevronRight size={14} className="text-muted-foreground/50" />
						{isLast ? (
							<span className="font-semibold text-foreground">{item.label}</span>
						) : item.to ? (
							<Link
								to={item.to}
								className="text-muted-foreground hover:text-foreground transition-colors"
							>
								{item.label}
							</Link>
						) : (
							<span className="text-muted-foreground">{item.label}</span>
						)}
					</span>
				);
			})}
		</nav>
	);
}
