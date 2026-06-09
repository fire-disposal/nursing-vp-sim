import type { TrainingPlugin } from "@/engine/types";
import { ChatInput } from "./ChatInput";

export const chatInputPlugin: TrainingPlugin = {
  id: "chat-input",
  name: "消息输入",
  meta: {
    description: "文本输入框，发送消息",
    icon: "send",
    tags: ["ui", "footer", "core"],
  },
  slots: {
    footer: ChatInput,
  },
};
