/**
 * 临床推理模拟（`/api/simulations`）的 DTO **冻结快照** —— 2026-09-28 运行期暴露关闭时生成。
 *
 * 为什么在这里：本模块的 DTO 原先来自 `api-types.gen.ts`（由 app 的 OpenAPI 生成）。运行期暴露关闭后
 * `/api/simulations` 不再挂到 app（见 docs/18 §八），生成的类型里也就不再有它们；而按裁定模块代码要
 * **保留**（内部实验台），所以把切割时的形状冻成本文件。与生成物的唯一差别：缩进，以及把
 * `components["schemas"]["X"]` 内联成 `X`。
 *
 * 冻结含义：本文件不再随后端演进（接口已不可达）。形状真源仍是 `backend/schemas/simulation.py`；
 * 若将来重启该实验面，删掉本文件、把两处 import 改回 `api-types.gen.ts` 即可。
 */

export type ActionResultResponse = {
    /** Session Id */
    session_id: number;
    /** Revision */
    revision: number;
    /** Accepted */
    accepted: boolean;
    /** Case Ended */
    case_ended: boolean;
    /**
     * Messages
     * @default []
     */
    messages: SimulationMessage[];
    snapshot: SimulationSnapshot;
    /**
     * Replayed
     * @default false
     */
    replayed: boolean;
};

export type CaseMeta = {
    /** Id */
    id: string;
    /** Name */
    name: string;
    /** Version */
    version: string;
    /**
     * Start Clock
     * @default 08:30
     */
    start_clock: string;
};

export type CommandSurfaceOut = {
    /**
     * Assessments
     * @default {}
     */
    assessments: {
        [key: string]: string;
    };
    /**
     * Drugs
     * @default {}
     */
    drugs: {
        [key: string]: string;
    };
    /**
     * Labs
     * @default {}
     */
    labs: {
        [key: string]: string;
    };
    /**
     * Talk Roles
     * @default []
     */
    talk_roles: string[];
    /**
     * Wait Labs
     * @default true
     */
    wait_labs: boolean;
    /**
     * Monitor
     * @default true
     */
    monitor: boolean;
};

export type DrainReadingOut = {
    /** Minute */
    minute: number;
    /** Output Ml */
    output_ml: number;
    /** Abnormal */
    abnormal: boolean;
};

export type LabRecordSummary = {
    /** Order Id */
    order_id: string;
    /** Kind */
    kind: string;
    /** Label */
    label: string;
    /** Sampled At */
    sampled_at: number;
    /** Ready At */
    ready_at: number;
    /** Result */
    result: {
        [key: string]: unknown;
    };
    /** Abnormal */
    abnormal: boolean;
};

export type PainReadingOut = {
    /** Minute */
    minute: number;
    /** Score */
    score: number;
    /** Abnormal */
    abnormal: boolean;
};

export type PendingLabSummary = {
    /** Id */
    id: string;
    /** Kind */
    kind: string;
    /** Label */
    label: string;
    /** Sampled At */
    sampled_at: number;
    /** Due At */
    due_at: number;
    /** Due Clock */
    due_clock: string;
};

export type SessionCreateResponse = {
    /** Session Id */
    session_id: number;
    snapshot: SimulationSnapshot;
};

export type SimulationActionIn = {
    /** Type */
    type: string;
    /** Target */
    target?: string | null;
    /** Text */
    text?: string | null;
};

export type SimulationActionRequest = {
    action: SimulationActionIn;
    /** Expected Revision */
    expected_revision?: number | null;
    /** Idem Key */
    idem_key?: string | null;
};

export type SimulationMessage = {
    /** Kind */
    kind: string;
    /** At Minute */
    at_minute: number;
    /** Text */
    text: string;
};

export type SimulationSnapshot = {
    /** Session Id */
    session_id: number;
    /** Revision */
    revision: number;
    /** Case Status */
    case_status: string;
    case_meta: CaseMeta;
    /**
     * Cases
     * @default []
     */
    cases: CaseMeta[];
    surface: CommandSurfaceOut;
    /** Current Time */
    current_time: number;
    /** Clock */
    clock: string;
    /** Monitoring */
    monitoring: boolean;
    /** Reported */
    reported: boolean;
    /** Diagnosis */
    diagnosis?: string | null;
    /**
     * Messages
     * @default []
     */
    messages: SimulationMessage[];
    /**
     * Vitals
     * @default []
     */
    vitals: VitalsReadingOut[];
    /**
     * Drain
     * @default []
     */
    drain: DrainReadingOut[];
    /**
     * Pain
     * @default []
     */
    pain: PainReadingOut[];
    /**
     * Urine
     * @default []
     */
    urine: UrineReadingOut[];
    /**
     * Readings
     * @default {}
     */
    readings: {
        [key: string]: {
            [key: string]: unknown;
        }[];
    };
    /**
     * Pending
     * @default []
     */
    pending: PendingLabSummary[];
    /**
     * Lab Records
     * @default []
     */
    lab_records: LabRecordSummary[];
    /**
     * Unrevealed Lab Count
     * @default 0
     */
    unrevealed_lab_count: number;
    /**
     * Cbc Count
     * @default 0
     */
    cbc_count: number;
    /**
     * Diag Spent
     * @default 0
     */
    diag_spent: number;
    /**
     * Diag Budget
     * @default 0
     */
    diag_budget: number;
    /**
     * Treat Spent
     * @default 0
     */
    treat_spent: number;
    /**
     * Treat Budget
     * @default 0
     */
    treat_budget: number;
    /** Case Ended At */
    case_ended_at?: number | null;
};

export type UrineReadingOut = {
    /** Minute */
    minute: number;
    /** Output Ml */
    output_ml: number;
    /** Abnormal */
    abnormal: boolean;
};

export type VitalsReadingOut = {
    /** Minute */
    minute: number;
    /** Hr */
    hr: number;
    /** Sbp */
    sbp: number;
    /** Dbp */
    dbp: number;
    /** Rr */
    rr: number;
    /** Spo2 */
    spo2: number;
    /** Temp */
    temp: number;
    /** Abnormal */
    abnormal: boolean;
};
