"""训练会话状态管理 —— disclosed topics 缓存的增删查"""

_disclosed_topics: dict[int, set] = {}


def restore_topics(record_id: int, history_text: str, case_data: dict) -> set:
    """从历史对话恢复已触发的隐藏信息主题集合"""
    from services.patient_guard import get_revealed_topics

    if record_id not in _disclosed_topics:
        _disclosed_topics[record_id] = get_revealed_topics(history_text, case_data)
    return _disclosed_topics[record_id]


def add_topic(record_id: int, topic: str) -> None:
    """标记一个隐藏信息主题为已触发"""
    if record_id not in _disclosed_topics:
        _disclosed_topics[record_id] = set()
    _disclosed_topics[record_id].add(topic)


def cleanup_topics(record_id: int) -> None:
    """训练结束时清理该会话的缓存"""
    _disclosed_topics.pop(record_id, None)
