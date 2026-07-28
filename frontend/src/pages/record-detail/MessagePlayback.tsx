import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MessageData {
	id: number;
	role: string;
	content: string;
}

interface Props {
	messages: MessageData[];
}

export default function MessagePlayback({ messages }: Props) {
	return (
		<div className="rounded-xl border border-border bg-card p-5 sm:p-6">
			<h3 className="flex items-center gap-2 text-sm font-semibold mb-4">
				<MessageCircle size={18} />
				对话回放 ({messages.length}条消息)
			</h3>
			<div className="rounded-lg bg-muted/50 p-4 sm:p-6 max-h-[400px] overflow-y-auto space-y-2">
				{messages.map((msg) => (
					<div key={msg.id} className="text-sm leading-relaxed">
						<span
							className={cn(
								"font-semibold mr-2",
								msg.role === "student"
									? "text-primary"
									: "text-info-foreground",
							)}
						>
							{msg.role === "student" ? "学生：" : "患者："}
						</span>
						<span className="text-foreground/80">{msg.content}</span>
					</div>
				))}
			</div>
		</div>
	);
}
