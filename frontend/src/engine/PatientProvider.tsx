import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import {
  useInitialMessages,
  usePatientData,
  useRecordCapabilities,
  useRemainingSeconds,
  useTimeLimit,
} from "./TrainingDataContext";
import type { ChatMessage, PatientData } from "./types";

interface PatientContextValue {
  patient: PatientData | null;
  trainingType: string;
  loading: boolean;
  error: string | null;
  capabilities: Record<string, boolean>;
  fromAssignment: boolean;
  initialMessages: ChatMessage[];
  timeLimit: number;
  remainingSeconds: number | null;
}

const PatientContext = createContext<PatientContextValue>({
  patient: null,
  trainingType: "history_taking",
  loading: true,
  error: null,
  capabilities: {},
  fromAssignment: false,
  initialMessages: [],
  timeLimit: 20,
  remainingSeconds: null,
});

export function PatientProvider({
  children,
}: {
  children: ReactNode;
}) {
  const patient = usePatientData();
  const capabilities = useRecordCapabilities();
  const initialMessages = useInitialMessages();
  const timeLimit = useTimeLimit();
  const remainingSeconds = useRemainingSeconds();

  // loading is always false here — TrainingEntry gates before rendering us
  const value = useMemo(
    () => ({
      patient,
      trainingType: "history_taking",
      loading: false,
      error: null,
      capabilities,
      fromAssignment: false,
      initialMessages,
      timeLimit,
      remainingSeconds,
    }),
    [patient, capabilities, initialMessages, timeLimit, remainingSeconds],
  );

  return (
    <PatientContext.Provider value={value}>{children}</PatientContext.Provider>
  );
}

export function usePatient() {
  return useContext(PatientContext);
}
