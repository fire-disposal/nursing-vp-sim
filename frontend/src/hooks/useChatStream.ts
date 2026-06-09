import { useCallback, useRef, useState } from "react";
import { sendMessageStream } from "@/api/api-client";
import type { ChatMessage } from "@/engine/types";

interface UseChatStreamOptions {
  onPatientChunk?: (chunk: string) => void;
  onPatientDone?: () => void;
  onError?: (err: string) => void;
  onSanitized?: (reply: string) => void;
}

export function useChatStream(recordId: number | null, options?: UseChatStreamOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const addedIdsRef = useRef<Set<string>>(new Set());

  const onPatientChunkRef = useRef(options?.onPatientChunk);
  onPatientChunkRef.current = options?.onPatientChunk;
  const onPatientDoneRef = useRef(options?.onPatientDone);
  onPatientDoneRef.current = options?.onPatientDone;
  const onErrorRef = useRef(options?.onError);
  onErrorRef.current = options?.onError;
  const onSanitizedRef = useRef(options?.onSanitized);
  onSanitizedRef.current = options?.onSanitized;

  const isOperation = useCallback((content: string) => content.startsWith("/") || content.startsWith("测") || content.startsWith("观察"), []);

  const send = useCallback(
    async (content: string) => {
      if (!recordId || loading) return;
      setLoading(true);
      addedIdsRef.current.clear();

      const op = isOperation(content);

      if (!op) {
        const studentId = crypto.randomUUID();
        addedIdsRef.current.add(studentId);
        setMessages((prev) => [...prev, { id: studentId, role: "student", content }]);
      } else {
        const sysId = crypto.randomUUID();
        addedIdsRef.current.add(sysId);
        setMessages((prev) => [...prev, { id: sysId, role: "system", content: `正在${content}...` }]);
      }

      if (!op) {
        const placeholderId = crypto.randomUUID();
        addedIdsRef.current.add(placeholderId);
        setMessages((prev) => [...prev, { id: placeholderId, role: "patient", content: "", streaming: true }]);
      }

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await sendMessageStream(
          recordId,
          content,
          (chunk: string) => {
            setMessages((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i]?.streaming) {
                  next[i] = { ...next[i], content: next[i].content + chunk };
                  return next;
                }
              }
              next.push({ id: crypto.randomUUID(), role: "patient", content: chunk, streaming: true });
              return next;
            });
            onPatientChunkRef.current?.(chunk);
          },
          (doneId?: number) => {
            setMessages((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i]?.streaming) {
                  next[i] = { ...next[i], streaming: false, id: doneId || next[i].id };
                  return next;
                }
              }
              return next;
            });
            onPatientDoneRef.current?.();
            setLoading(false);
            if (abortRef.current === controller) abortRef.current = null;
          },
          (err: string) => {
            setMessages((prev) => prev.filter((m) => !m.streaming && !addedIdsRef.current.has(String(m.id ?? ""))));
            addedIdsRef.current.clear();
            setLoading(false);
            onErrorRef.current?.(err);
            if (abortRef.current === controller) abortRef.current = null;
          },
          (reply: string) => {
            onSanitizedRef.current?.(reply);
          },
          (sysMsg: string) => {
            setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "system", content: sysMsg }]);
          },
          controller.signal,
        );
      } catch (err: any) {
        setMessages((prev) => prev.filter((m) => !m.streaming && !addedIdsRef.current.has(String(m.id ?? ""))));
        addedIdsRef.current.clear();
        setLoading(false);
        onErrorRef.current?.(err?.message || "发送失败");
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [recordId, loading, isOperation],
  );

  return { messages, setMessages, send, loading, isOperation, abortRef };
}
