import { getUserAvatar } from "@/utils/avatar";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { RoleBadge } from "@/components/ui/role-badge";
import type { UserBrief } from "./types";

interface UserCardProps {
	user: UserBrief;
	selected: boolean;
	onSelect: (id: number, selected: boolean) => void;
	onClick: (user: UserBrief) => void;
}

export default function UserCard({
	user,
	selected,
	onSelect,
	onClick,
}: UserCardProps) {
	return (
		<Card
			size="sm"
			className={cn(
				"cursor-pointer transition-shadow hover:shadow-md",
				selected && "ring-2 ring-primary",
			)}
			onClick={() => onClick(user)}
		>
			<CardContent>
				<div className="flex items-start gap-3">
					<label
						className="shrink-0 pt-0.5 cursor-pointer"
						onClick={(e) => e.stopPropagation()}
					>
						<input
							type="checkbox"
							className="size-4 cursor-pointer accent-primary"
							checked={selected}
							onChange={(e) => onSelect(user.id, e.target.checked)}
						/>
					</label>
					<img
						src={getUserAvatar(user.gender)}
						alt=""
						className="size-10 rounded-full object-cover shrink-0"
					/>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-1.5">
							<span className="font-medium text-sm truncate">
								{user.display_name}
							</span>
							<RoleBadge
								role={user.role}
								label={user.role_display_name || user.role}
							/>
						</div>
						<div className="text-xs text-muted-foreground mt-0.5 truncate">
							{user.username}
						</div>
						{(user.grade_name || user.class_name) && (
							<div className="text-xs text-muted-foreground mt-0.5">
								{user.grade_name && user.class_name
									? `${user.grade_name} ${user.class_name}`
									: user.class_name || user.grade_name}
								{user.student_id && (
									<span className="ml-2">学号: {user.student_id}</span>
								)}
							</div>
						)}
						<div className="text-xs text-muted-foreground mt-1">
							{new Date(user.created_at).toLocaleDateString("zh-CN")}
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
