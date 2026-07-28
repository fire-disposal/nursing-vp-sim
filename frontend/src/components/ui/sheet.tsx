import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SheetProps {
	open: boolean;
	onClose: () => void;
	side?: "left" | "right" | "bottom";
	size?: "sm" | "md" | "lg";
	children: ReactNode;
}

const WIDTH_MAP: Record<string, string> = {
	sm: "w-[85vw] max-w-xs",
	md: "w-80",
	lg: "w-96",
};

const HEIGHT_MAP: Record<string, string> = {
	sm: "h-[40vh]",
	md: "h-[65vh]",
	lg: "h-[85vh]",
};

const SIDE_CLASSES: Record<string, string> = {
	left: "inset-y-0 left-0 data-closed:-translate-x-full",
	right: "inset-y-0 right-0 data-closed:translate-x-full",
	bottom: "inset-x-0 bottom-0 rounded-t-2xl data-closed:translate-y-full",
};

export function Sheet({
	open,
	onClose,
	side = "right",
	size = "md",
	children,
}: SheetProps) {
	const dimension = side === "bottom" ? HEIGHT_MAP[size] : WIDTH_MAP[size];

	return (
		<DialogPrimitive.Root
			open={open}
			onOpenChange={(o) => {
				if (!o) onClose();
			}}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Backdrop
					className="fixed inset-0 z-50 bg-black/30 backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
				/>
				<DialogPrimitive.Popup
					className={cn(
						"fixed z-50 bg-card shadow-e3 overflow-y-auto overscroll-contain outline-none duration-200 ease-out data-open:animate-in data-closed:animate-out",
						dimension,
						SIDE_CLASSES[side],
					)}
				>
					<DialogPrimitive.Close
						className="absolute top-3 right-3 size-9 rounded-lg hover:bg-muted inline-flex items-center justify-center"
						aria-label="关闭面板"
					>
						<XIcon size={20} />
					</DialogPrimitive.Close>
					{children}
				</DialogPrimitive.Popup>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
