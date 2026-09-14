"""官方 DeepSeek tokenizer 适配层（``infra.llm.tokenizer``）行为测试。

覆盖三件事：① 计数与入库产物一致（golden 值，词汇表/特殊 token 口径漂移即失败）；
② 产物缺失或 ``tokenizers`` 缺失时**降级且不静默**；③ LRU 缓存命中。

校准复现（staging 真实日志逐条比对 ``prompt_tokens``，2026-09-14，n=120：官方
mean|e| 1.9% / 中位 1.1%，启发式 mean|e| 10.9%；只取 ``status='success'`` 且未截断的
调用 —— failed 行会带残缺 usage）：

    ssh yecaoyun "docker exec nursing-db psql -U nursing -d nursing_vp -At -c \\
      \\"SELECT json_agg(t) FROM (SELECT purpose, prompt_tokens, request_chars,
      request_text FROM llm_call_logs WHERE prompt_tokens IS NOT NULL AND
      request_text IS NOT NULL AND status='success' AND request_chars=length(request_text)
      ORDER BY id DESC LIMIT 120) t\\"" > /tmp/samples.json

    cd backend && PYTHONPATH=. uv run python - <<'EOF'
    import json, statistics
    from infra.llm.token_counter import _heuristic_tokens, estimate_tokens

    rows = json.load(open("/tmp/samples.json"))
    pt = [r["prompt_tokens"] for r in rows]
    off = [estimate_tokens(r["request_text"]) for r in rows]
    heu = [_heuristic_tokens(r["request_text"]) for r in rows]
    for name, vals in (("official", off), ("heuristic", heu)):
        err = [v / t - 1 for v, t in zip(vals, pt)]
        print(name, f"mean={statistics.mean(err):+.4f}",
              f"mean|e|={statistics.mean(map(abs, err)):.4f}",
              f"med|e|={statistics.median(map(abs, err)):.4f}",
              f"max|e|={max(map(abs, err)):.4f}")
    EOF

（``request_text`` 是 ``" ".join(content)``，不含 role 标记；官方计数与 ``prompt_tokens``
的残差恒为负、按用途近似恒定 —— 那是 API 侧 chat 模板开销，属预期口径差。）
"""

import logging
import sys
from pathlib import Path

import pytest

from infra.llm import tokenizer as tok_mod
from infra.llm.token_counter import estimate_tokens

# golden：官方产物（backend/data/tokenizer/tokenizer.json）的编码结果。
# 换产物、误开 add_special_tokens、或 encode 口径被改都会让这些数字变。
GOLDEN = [
    ("hello world", 2),
    ("患者体温38.5", 5),
    ("体温 38.5 °C", 7),
    ("护士你好，我这两天喘不上来气，咳嗽也厉害了，痰也多了。", 18),
    ("姓名：王建国，68岁，男\n主诉：间断胸痛伴心悸1周", 20),
    ('{"score": 85, "feedback": "沟通良好"}', 13),
    ("👨‍👩‍👧‍👦", 11),  # ZWJ 连字：4 个 emoji（8 token）+ 3 个 ZWJ 字节
    (" ", 1),
]


class TestOfficialCounting:
    @pytest.mark.parametrize(("text", "expected"), GOLDEN)
    def test_golden_counts(self, text, expected):
        assert tok_mod.count_tokens(text) == expected

    def test_estimate_tokens_prefers_official_over_heuristic(self):
        """路由：官方可用时 ``estimate_tokens`` 必须走官方计数。

        ``患者体温38.5`` 官方 5 / 启发式 4；``'A'*100`` 官方 13 / 启发式 30 ——
        两个方向各取一例，避免断言恰好被启发式满足。
        """
        assert estimate_tokens("患者体温38.5") == 5
        assert estimate_tokens("A" * 100) == 13

    def test_empty_is_zero(self):
        assert tok_mod.count_tokens("") == 0
        assert estimate_tokens("") == 0

    def test_nonempty_never_zero(self):
        """非空输入恒 ≥1 token（历史预算用 0 表示「无需计费」，不能被非空文本取到）。"""
        for text in [" ", "\n", "\x00", "\u200b", "a"]:
            assert estimate_tokens(text) >= 1

    def test_artifact_is_vendored(self):
        assert tok_mod.ARTIFACT_PATH.is_file(), f"官方 tokenizer 产物缺失：{tok_mod.ARTIFACT_PATH}"


class TestCache:
    def test_repeated_text_hits_cache(self):
        tok_mod._encode_count.cache_clear()
        assert tok_mod.count_tokens("患者体温38.5") == 5
        assert tok_mod._encode_count.cache_info().misses == 1
        assert tok_mod.count_tokens("患者体温38.5") == 5
        info = tok_mod._encode_count.cache_info()
        assert (info.hits, info.misses) == (1, 1)

    def test_long_text_bypasses_cache(self):
        """超长文本（整段 prompt，每次不同）不进缓存，避免冲掉跨轮复用的小文本。"""
        tok_mod._encode_count.cache_clear()
        long_text = "患者主诉胸痛伴心悸，" * 100
        assert len(long_text) > tok_mod._CACHE_MAX_TEXT_CHARS
        first = tok_mod.count_tokens(long_text)
        assert tok_mod.count_tokens(long_text) == first
        assert tok_mod._encode_count.cache_info().currsize == 0


@pytest.fixture
def unloaded_tokenizer(monkeypatch):
    """把适配层重置回「未探测」状态（用例结束后 monkeypatch 自动还原）。"""
    monkeypatch.setattr(tok_mod, "_load_probed", False)
    monkeypatch.setattr(tok_mod, "_tokenizer", None)
    monkeypatch.setattr(tok_mod, "_load_error", None)
    monkeypatch.setattr(tok_mod, "_fallback_calls", 0)
    tok_mod._encode_count.cache_clear()
    return tok_mod


class TestDegradedPath:
    def test_missing_artifact_falls_back_and_warns(self, monkeypatch, caplog, unloaded_tokenizer):
        monkeypatch.setattr(tok_mod, "ARTIFACT_PATH", Path("/nonexistent/tokenizer.json"))
        with caplog.at_level(logging.WARNING, logger="infra.llm.tokenizer"):
            assert tok_mod.count_tokens("患者体温38.5") is None
            assert estimate_tokens("患者体温38.5") == 4  # 0.6/0.3 启发式

        status = tok_mod.tokenizer_status()
        assert status["mode"] == "heuristic"
        assert status["fallback_calls"] >= 1, "降级必须计数，不能静默"
        assert "/nonexistent/tokenizer.json" in status["error"]
        assert any("降级" in r.message for r in caplog.records), "降级必须留日志，不能静默"

    def test_missing_package_falls_back(self, monkeypatch, caplog, unloaded_tokenizer):
        monkeypatch.setitem(sys.modules, "tokenizers", None)  # 令 `from tokenizers import ...` 抛 ImportError
        with caplog.at_level(logging.WARNING, logger="infra.llm.tokenizer"):
            assert tok_mod.count_tokens("hello world") is None
            assert estimate_tokens("hello world") == 3

        status = tok_mod.tokenizer_status()
        assert status["mode"] == "heuristic"
        assert "未安装" in status["error"]
        assert any("降级" in r.message for r in caplog.records)

    def test_status_does_not_trigger_load(self, monkeypatch, unloaded_tokenizer):
        """``tokenizer_status`` 是只读观测，不得触发 6 MB 产物加载。"""
        monkeypatch.setattr(tok_mod, "ARTIFACT_PATH", Path("/nonexistent/tokenizer.json"))
        # 若 status() 顺带探测，产物不可用会让 mode 变成 "heuristic"。
        assert tok_mod.tokenizer_status()["mode"] == "unloaded"

    def test_probe_happens_once(self, monkeypatch, unloaded_tokenizer):
        """加载只探测一次：成功后即使产物消失也不再重新读盘（热路径无文件 I/O）。"""
        assert tok_mod.is_available() is True
        monkeypatch.setattr(tok_mod, "ARTIFACT_PATH", Path("/nonexistent/tokenizer.json"))
        assert tok_mod.count_tokens("hello world") == 2
        assert tok_mod.tokenizer_status()["mode"] == "tokenizer"
