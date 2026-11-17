"""火山语音 ENV 初始化边界：分通道、只一次、不覆盖管理配置。"""

from types import SimpleNamespace

import seed


def _vc(**overrides):
    values = {
        "api_key": "",
        "asr_api_key": "",
        "tts_env_seeded": False,
        "asr_env_seeded": False,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_asr_env_initializes_only_asr(monkeypatch):
    monkeypatch.setattr(seed, "VOLC_TTS_API_KEY", "env-tts")
    monkeypatch.setattr(seed, "VOLC_ASR_API_KEY", "env-asr")
    vc = _vc(api_key="existing-tts")

    assert seed._apply_voice_env_seed(vc) is True
    assert vc.api_key == "existing-tts"
    assert vc.asr_api_key == "env-asr"
    assert vc.tts_env_seeded is True
    assert vc.asr_env_seeded is True


def test_empty_channels_are_initialized_independently(monkeypatch):
    monkeypatch.setattr(seed, "VOLC_TTS_API_KEY", "")
    monkeypatch.setattr(seed, "VOLC_ASR_API_KEY", "env-asr")
    vc = _vc()

    assert seed._apply_voice_env_seed(vc) is True
    assert vc.api_key == ""
    assert vc.asr_api_key == "env-asr"
    assert vc.tts_env_seeded is False
    assert vc.asr_env_seeded is True


def test_second_run_does_not_replace_or_refill(monkeypatch):
    monkeypatch.setattr(seed, "VOLC_TTS_API_KEY", "new-env-tts")
    monkeypatch.setattr(seed, "VOLC_ASR_API_KEY", "new-env-asr")
    vc = _vc(
        api_key="",
        asr_api_key="",
        tts_env_seeded=True,
        asr_env_seeded=True,
    )

    assert seed._apply_voice_env_seed(vc) is False
    assert vc.api_key == ""
    assert vc.asr_api_key == ""


def test_no_env_leaves_channel_uninitialized_for_later(monkeypatch):
    monkeypatch.setattr(seed, "VOLC_TTS_API_KEY", "")
    monkeypatch.setattr(seed, "VOLC_ASR_API_KEY", "")
    vc = _vc()

    assert seed._apply_voice_env_seed(vc) is False
    assert vc.tts_env_seeded is False
    assert vc.asr_env_seeded is False
