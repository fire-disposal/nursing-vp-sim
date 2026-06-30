/** The scene-authorable state shape — drives both LLM prompt injection & visual rendering */
export interface SceneState {
  environment?: {
    type?: "icu" | "ward" | "er" | "clinic" | "home"
    time_of_day?: "morning" | "day" | "night"
    equipment?: string[]
    noise_level?: "quiet" | "moderate" | "loud"
  }
  patient?: {
    position?: "supine" | "sitting" | "semi-recumbent" | "lateral"
    consciousness?: "alert" | "lethargic" | "confused" | "unresponsive"
    visible_symptoms?: string[]
    expression?: string
    speaking?: boolean
  }
  vitals?: {
    hr?: number
    bp_sys?: number
    bp_dia?: number
    rr?: number
    spo2?: number
    temp?: number
    pain?: number
  }
  phase?: string
  procedure_step?: number
}

/** Every scene receives this — same type in sandbox & production */
export interface SceneProps {
  bus: import("./mock/bus").MessageBus
  mode: "sandbox" | "training"
  initialState?: SceneState
}
