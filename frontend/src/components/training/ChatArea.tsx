import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, MessageBus, PatientData } from "@/engine/types";
import type { TrainingRecordDetail } from "@/engine/TrainingContext";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { computeCovered } from "./tools/inquiryProgress";
import { ChatDisplay } from "./ChatDisplay";
import { ChatInput } from "./ChatInput";
import { EmotionIndicator } from "./EmotionIndicator";
import { InquiryProgressChip } from "./InquiryProgressChip";
import SceneToolbar from "./SceneToolbar";
import { WelcomeScreen } from "./WelcomeScreen";

interface ChatAreaProps {
	messages: ChatMessage[];
	patient: PatientData;
	sending: boolean;
	trainingEnded?: boolean;
	onSend: (text: string) => void;
	bus: MessageBus;
	capabilities: Record<string, boolean>;
	recordId: number;
	hasHistory?: boolean;
	recordDetail: TrainingRecordDetail | null;
	endTraining: () => Promise<void>;
}

export function ChatArea({
	messages,
	patient,
	sending,
	trainingEnded = false,
	onSend,
	bus,
	capabilities,
	recordId,
	hasHistory,
	recordDetail,
	endTraining,
}: ChatAreaProps) {
  const hasMessages = messages.length > 0;
  const [initiativeMsgs, setInitiativeMsgs] = useState<Set<string>>(new Set());
  const [inquiryModalOpen, setInquiryModalOpen] = useState(false);
  const shownRef = useRef(false);
  const layout = useLayoutMode();
  const isCompact = layout === "phone";

  const inquiriesComplete = useMemo(() => {
    const cd = (recordDetail?.case_data as Record<string, unknown>) ?? {};
    const inquiries = (cd.required_inquiries as string[]) ?? [];
    if (inquiries.length === 0) return false;
    const studentText = messages
      .filter((m) => m.role === "student")
      .map((m) => String(m.content ?? ""))
      .join("");
    return computeCovered(inquiries, studentText).size === inquiries.length;
  }, [messages, recordDetail]);

  useEffect(() => {
    if (inquiriesComplete && !shownRef.current && !trainingEnded) {
      shownRef.current = true;
      setInquiryModalOpen(true);
    }
  }, [inquiriesComplete, trainingEnded]);

  useEffect(() => {
    if (messages.length === 0) {
      setInitiativeMsgs(new Set());
      shownRef.current = false;
    }
  }, [messages.length]);

  useEffect(() => {
    const MAX_INITIATIVE = 200;
    const unsub = bus.on(
      "initiative:triggered",
      (data: { content: string }) => {
        setInitiativeMsgs((prev) => {
          const next = new Set(prev).add(data.content);
          if (next.size <= MAX_INITIATIVE) return next;
          const arr = [...next];
          return new Set(arr.slice(arr.length - MAX_INITIATIVE));
        });
      },
    );
    return unsub;
  }, [bus]);

	return (
		<div className="flex flex-col h-full pt-10 sm:pt-12">
			<AnimatePresence mode="wait">
				{!hasMessages && !hasHistory ? (
					<motion.div
						key="welcome"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0, y: -16 }}
						transition={{ duration: 0.2 }}
					>
						<WelcomeScreen
							patient={patient}
							onQuickPrompt={onSend}
							capabilities={capabilities}
						/>
					</motion.div>
				) : (
					<motion.div
						key="chat"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ duration: 0.2 }}
						className="flex-1 flex flex-col min-h-0"
					>
						{isCompact ? (
							<EmotionIndicator bus={bus} capabilities={capabilities} recordId={recordId} compact trailing={<InquiryProgressChip />} />
						) : (
							<EmotionIndicator bus={bus} capabilities={capabilities} recordId={recordId} trailing={<InquiryProgressChip />} />
						)}
						<div className="flex-1 overflow-y-auto overscroll-contain">
							<ChatDisplay
								messages={messages}
								patient={patient}
								bus={bus}
								initiativeMsgs={initiativeMsgs}
								hasStreaming={sending}
							/>
						</div>
						<SceneToolbar />
						<ChatInput onSend={onSend} disabled={sending || trainingEnded} loading={sending} trainingEnded={trainingEnded} />
					</motion.div>
				)}
			</AnimatePresence>

			<Dialog open={inquiryModalOpen} onOpenChange={(o) => { if (!o) setInquiryModalOpen(false); }}>
				<DialogContent title="问诊内容全部覆盖" maxWidth={360}>
					<p className="text-sm text-muted-foreground">
						你已成功采集了该病例的全部关键病史信息。是否结束本次训练并生成评分？
					</p>
					<div className="flex justify-end gap-2 mt-5">
						<Button variant="outline" size="sm" onClick={() => setInquiryModalOpen(false)}>
							继续交流
						</Button>
						<Button variant="default" size="sm" onClick={() => { setInquiryModalOpen(false); endTraining(); }}>
							立即结算
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
