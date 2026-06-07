import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getRecordDetail } from "@/api/training";
import { useToast } from "@/components/Toast";
import type { ScoreData } from "@/types/score";

interface UseRecordLoaderOptions {
  recordId: string | undefined;
  setMessages: (msgs: unknown[]) => void;
  setCaseTitle: (t: string) => void;
  setRequiredInquiries: (inquiries: string[]) => void;
  setPatientInfo: (info: unknown) => void;
  setCaseId: (id: number) => void;
  setFeatures: (features: Record<string, boolean>) => void;
  setRecordStatus: (status: string | null) => void;
  setScore: (score: ScoreData | null) => void;
  setShowScore: (show: boolean) => void;
  onTimerReady: (remaining: number | null) => void;
  onPreTestCheck: () => Promise<{ has_pending?: boolean } | undefined>;
}

export function useRecordLoader(recordId: string | undefined, opts: UseRecordLoaderOptions) {
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    if (!recordId) return;

    getRecordDetail(Number(recordId))
      .then(({ data }) => {
        if (cancelled) return;
        const detail = data as Record<string, unknown> & {
          messages?: Array<{ streaming?: boolean }>;
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

        opts.setMessages((detail.messages || []).map((m) => ({ ...m, streaming: false })));
        if (detail.case_name) opts.setCaseTitle(detail.case_name);
        if (detail.required_inquiries) opts.setRequiredInquiries(detail.required_inquiries as string[]);
        if (detail.patient_info) opts.setPatientInfo(detail.patient_info);
        if (detail.case_id) opts.setCaseId(detail.case_id);
        if (detail.features) opts.setFeatures(detail.features);
        opts.setRecordStatus(detail.status || null);

        if (detail.status === "completed") {
          opts.onTimerReady(null);
          if (detail.score) {
            opts.setScore(detail.score);
            opts.setShowScore(true);
          }
          return;
        }

        const r =
          detail.remaining_seconds != null
            ? detail.remaining_seconds
            : detail.start_time
              ? Math.max(0, (detail.time_limit || 20) * 60 - Math.floor((Date.now() - new Date(detail.start_time).getTime()) / 1000))
              : Math.max(0, (detail.time_limit || 20) * 60);
        opts.onTimerReady(r);

        opts.onPreTestCheck();
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
  }, [recordId]);
}
