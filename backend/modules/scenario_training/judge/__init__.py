"""判读：把世界状态投影成决策点锚点与经历维度（纯函数，不连库、不调 LLM）。"""

from .rules import DecisionResult, dims_snapshot, evaluate, summarize

__all__ = ["DecisionResult", "dims_snapshot", "evaluate", "summarize"]
