import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { notifySSEProgress } from "@/engine/ScoreManager";
import useAuthStore from "@/stores/authStore";

export function useScoringNotifications() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const retryCountRef = useRef(0);

    useEffect(() => {
        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
        let aborted = false;

        async function connect() {
            const token = useAuthStore.getState().token;
            if (!token || aborted) return;

            try {
                const response = await fetch("/api/training/notifications/stream", {
                    headers: { Authorization: `Bearer ${token}` },
                });

                if (!response.ok) {
                    if (response.status === 401) return;
                    throw new Error(`HTTP ${response.status}`);
                }

                const stream = response.body;
                if (!stream) throw new Error("No stream");
                reader = stream.getReader();
                const decoder = new TextDecoder();
                let buffer = "";

                while (!aborted) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() || "";

                    let eventType = "";
                    for (const line of lines) {
                        if (line.startsWith("event: ")) {
                            eventType = line.slice(7).trim();
                        } else if (line.startsWith("data: ")) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                if (eventType === "scoring_complete") {
                                    queryClient.invalidateQueries({ queryKey: ["notifications"] });
                                    toast.success("评分已完成！", {
                                        description: "训练评分已生成，可点击查看详情",
                                        action: {
                                            label: "查看",
                                            onClick: () => navigate(`/record/${data.record_id}`),
                                        },
                                        duration: 10000,
                                    });
                                }
                                if (eventType === "scoring_failed") {
                                    queryClient.invalidateQueries({ queryKey: ["notifications"] });
                                    toast.error("评分失败", {
                                        description: data.error || "请稍后重试",
                                        action: {
                                            label: "查看",
                                            onClick: () => navigate(`/record/${data.record_id}`),
                                        },
                                        duration: 10000,
                                    });
                                }
                                if (eventType === "scoring_progress") {
                                    notifySSEProgress(data);
                                }
                            } catch (e) {
                                console.warn("[SSE] malformed event data:", e);
                            }
                        }
                    }
                }
            } catch (_err) {
                if (!aborted) {
                    const delay = Math.min(1000 * 2 ** retryCountRef.current, 30000);
                    retryCountRef.current = Math.min(retryCountRef.current + 1, 5);
                    console.warn("[SSE] disconnected, retrying in " + delay + "ms (attempt " + retryCountRef.current + ")");
                    retryRef.current = setTimeout(connect, delay);
                }
            }
        }

        connect();

        return () => {
            aborted = true;
            if (reader) reader.cancel().catch(() => {});
            if (retryRef.current) clearTimeout(retryRef.current);
        };
    }, [navigate, queryClient]);
}
