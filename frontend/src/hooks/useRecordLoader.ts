import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getRecordDetail } from "@/api/training";
import { useToast } from "@/components/Toast";
import type { ScoreData } from "@/types/score";

interface UseRecordLoaderOptions {
  setMessages: (msgs: unknown[]) => void;
  setCaseTitle: (t: string) => void;
  setRequiredInquiries: (inquiries: string[]) => void;
  setPatientName: (name: string) => void;
  setPatientInfo: (info: unknown) => void;
  setCaseId: (id: number) => void;
  setFeatures: (features: Record<string, boolean>) => void;
  setRecordStatus: (status: string | null) => void;
  setScore: (score: ScoreData | null) => void;
  setShowScore: (show: boolean) => void;
  onTimerReady: (remaining: number | null) => void;
  onPreTestCheck: () => Promise<{ has_pending?: boolean } | null | undefined>;
}

export function useRecordLoader(recordId: string | undefined, opts: UseRecordLoaderOptions) {
  const navigate = useNavigate();
  const toast = useToast();
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let cancelled = false;
    if (!recordId) return;

    getRecordDetail(Number(recordId))
      .then(({ data }) => {
        if (cancelled) return;
        const detail = data as Record<string, unknown> & {
          messages?: Array<{ streaming?: boolean; content?: string }>;
          case_name?: string;
          required_inquiries?: string[];
          patient_info?: unknown;
          case_id?: number;
          features?: Record<string, boolean>;
          status?: string;
          score?: ScoreData;
          remaining_seconds?: number;
          time_limit?: number;
          start_time?: string;
        };

        const o = optsRef.current;
        o.setMessages((detail.messages || []).map((m) => ({ ...m, streaming: false })));
        if (detail.case_name) o.setCaseTitle(detail.case_name);
        if (detail.required_inquiries) o.setRequiredInquiries(detail.required_inquiries as string[]);
        if (detail.patient_info) o.setPatientInfo(detail.patient_info);
        if (detail.case_id) o.setCaseId(detail.case_id);
        if (detail.features) o.setFeatures(detail.features);
        o.setRecordStatus(detail.status || null);

        if (detail.messages && detail.messages.length > 0) {
          const content = detail.messages[0]?.content;
          if (content) {
            const m = content.match(/我是(.+?)[。，]/);
            if (m) o.setPatientName(m[1]);
          }
        }

        if (detail.status === "completed") {
          o.onTimerReady(null);
          if (detail.score) {
            o.setScore(detail.score);
            o.setShowScore(true);
          }
          return;
        }

        const r =
          detail.remaining_seconds != null
            ? detail.remaining_seconds
            : detail.start_time
              ? Math.max(0, (detail.time_limit || 20) * 60 - Math.floor((Date.now() - new Date(detail.start_time).getTime()) / 1000))
              : Math.max(0, (detail.time_limit || 20) * 60);
        o.onTimerReady(r);

        o.onPreTestCheck();
      })
      .catch(() => {
        if (!cancelled) {
          toast.error("加载训练记录失败");
          navigate("/cases");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [recordId, navigate, toast.error]);
}
