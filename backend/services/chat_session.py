"""训练会话状态管理 —— disclosed topics 缓存的增删查"""

_disclosed_topics: dict[int, set] = {}


def cleanup_topics(record_id: int) -> None:
    """训练结束时清理该会话的缓存"""
    _disclosed_topics.pop(record_id, None)
