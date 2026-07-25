from pydantic import BaseModel, Field


class ExamOperationResult(BaseModel):
    type: str
    label: str = ""
    value: str = ""
    unit: str = ""


class ExamOperationResponse(BaseModel):
    type: str
    data: ExamOperationResult
    all_results: list[ExamOperationResult] = Field(default_factory=list)
