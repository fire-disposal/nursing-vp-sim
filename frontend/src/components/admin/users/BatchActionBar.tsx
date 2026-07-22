import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BatchActionBarProps {
	selectedCount: number;
	onClearSelection: () => void;
	onBulkAssignClass: () => void;
	onBulkResetPassword: () => void;
}

export default function BatchActionBar({
	selectedCount,
	onClearSelection,
	onBulkAssignClass,
	onBulkResetPassword,
}: BatchActionBarProps) {
	if (selectedCount === 0) return null;

	return (
		<div
			className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 rounded-xl border bg-card px-4 py-3 shadow-e3 flex items-center gap-3"
			style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}
		>
			<span className="text-sm font-medium whitespace-nowrap">
				已选 {selectedCount} 人
			</span>
			<Button size="sm" onClick={onBulkAssignClass}>
				批量分配班级
			</Button>
			<Button size="sm" variant="secondary" onClick={onBulkResetPassword}>
				批量重置密码
			</Button>
			<Button
				size="icon-sm"
				variant="ghost"
				onClick={onClearSelection}
				title="取消选择"
			>
				<X size={16} />
			</Button>
		</div>
	);
}
