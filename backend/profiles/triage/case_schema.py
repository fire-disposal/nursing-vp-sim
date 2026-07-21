from pydantic import BaseModel, Field


class QuizOption(BaseModel):
    key: str
    text: str


class QuizQuestion(BaseModel):
    id: str
    stem: str
    options: list[QuizOption] = []
    answer: str
    explanation: str = ""


class TriageQuizConfig(BaseModel):
    title: str = "引导题目"
    questions: list[QuizQuestion] = []


class TriagePatientInfo(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    age: int = Field(ge=0, le=120)
    gender: str = Field(pattern="^(男|女)$")


class VitalsData(BaseModel):
    hr: int = Field(ge=0, le=300)
    bp_sys: int = Field(ge=0, le=300)
    bp_dia: int = Field(ge=0, le=200)
    rr: int = Field(ge=0, le=60)
    spo2: int = Field(ge=0, le=100)
    temp: float = Field(ge=34.0, le=42.0)
    consciousness: str = Field(default="alert")


class TriageCaseData(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    patient_info: TriagePatientInfo
    chief_complaint: str = ""
    arrival_mode: str = Field(default="walk")
    vitals: VitalsData
    mews_score: int = Field(default=0, ge=0, le=14)
    triage_category: str = Field(default="未评估")
    red_flags: list[str] = Field(default_factory=list)
    description: str = ""
    time_limit_minutes: int = Field(default=10, ge=1, le=60)

    # 病例声明的能力开关
    capabilities: dict[str, bool] = {}
    hidden_info: list[str] = Field(default_factory=list)
    scoring_criteria: dict[str, object] = Field(default_factory=dict)
    quiz: TriageQuizConfig | None = None
