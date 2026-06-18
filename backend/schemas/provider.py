from pydantic import BaseModel


class ModelPresetItem(BaseModel):
    name: str
    price_input: float = 0
    price_output: float = 0


class ProviderPresetResponse(BaseModel):
    provider: str = ""
    display_name: str = ""
    base_url: str = ""
    models: list[ModelPresetItem] = []


class CatalogResponse(BaseModel):
    providers: list[ProviderPresetResponse] = []


class HealthCheckItem(BaseModel):
    base_url: str
    status: str
    latency_ms: int | None = None
    error: str | None = None


class TestResultItem(BaseModel):
    base_url: str
    ok: bool
    status_code: int | None = None
    latency_ms: int | None = None
    error: str | None = None


class TestAllResultsResponse(BaseModel):
    results: list[TestResultItem]
