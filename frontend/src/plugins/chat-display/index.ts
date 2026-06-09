import type { TrainingPlugin } from "@/engine/types";
import { ChatDisplay } from "./ChatDisplay";

export const chatDisplayPlugin: TrainingPlugin = {
  id: "chat-display",
  name: "聊天消息展示",
  meta: {
    description: "渲染聊天消息列表，自动跟随新消息滚动，流式消息实时更新，离底时显示回底按钮",
    icon: "message-square",
    tags: ["ui", "content", "core"],
  },
  slots: {
    content: ChatDisplay,
  },
};
