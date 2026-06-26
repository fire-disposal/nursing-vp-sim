import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface CollapsibleSectionProps {
	icon: ReactNode;
	title: string;
	expanded: boolean;
	onToggle: () => void;
	children: ReactNode;
}

export default function CollapsibleSection({
	icon,
	title,
	expanded,
	onToggle,
	children,
}: CollapsibleSectionProps) {
	return (
		<div className="pt-2 border-t border-border">
			<button
				onClick={onToggle}
				className="flex items-center justify-between w-full py-2"
			>
				<h4 className="flex items-center gap-2 text-sm font-semibold">
					{icon}
					{title}
				</h4>
				<ChevronDown
					size={16}
					className={cn(
						"transition-transform",
						expanded && "rotate-180",
					)}
				/>
			</button>
			{expanded && children}
		</div>
	);
}
