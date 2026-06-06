export interface ChatMessage {
  id?: number;
  role: "student" | "patient" | "system";
  content: string;
  streaming?: boolean;
}
