"""QA 引用链路：中文检索召回 + chapter/heading key 往返 + 原文接口。

回归目标（review qa-voice-tools #1/#8）：
  - 中文整句查询（无空格）不再退化成整串子串匹配 → 典型问题有命中；
  - 引用 key 的构造与解析成对，含 "/" 的小节标题不被切断；
  - /api/qa/section-text 对系统产出的引用返回正文而不是 404；
  - 上下文注入不再把「小节不存在」错误串当教材正文。
"""

import pytest
from fastapi import HTTPException

from modules.qa.knowledge_base.chapter_index import (
    make_section_key,
    parse_section_key,
    read_section_by_key,
    search,
)
from modules.qa.router.endpoints import get_section_text
from modules.qa.router.tools import inject_search_context, pre_search

# 教材实有语料；断言"命中该小节"即验证召回是否真的定位到内容而不是泛泛命中。
_PNEUMONIA_QUESTION = "肺炎病人的护理措施有哪些？"
_PNEUMONIA_SECTION = ("第四节 肺部感染性疾病",)


class TestChineseRecall:
    def test_typical_questions_all_recall(self):
        """无空格中文问句必须召回（旧实现按 [,，\\s]+ 切分 → 整句一个 term → 恒 0 命中）。"""
        questions = [
            _PNEUMONIA_QUESTION,
            "术后并发症如何预防",
            "高血压患者的健康教育",
            "心衰的临床表现",
            "糖尿病酮症酸中毒的处理",
            "压疮预防措施",
        ]
        for question in questions:
            results = search(question, top_k=3)
            assert results, f"未召回任何小节: {question}"

    def test_pneumonia_question_hits_the_right_section(self):
        results = search(_PNEUMONIA_QUESTION, top_k=3)
        assert any(r["heading"] in _PNEUMONIA_SECTION for r in results)
        # 命中的小节正文确实在讲肺炎
        top = next(r for r in results if r["heading"] in _PNEUMONIA_SECTION)
        assert top["match_count"] > 0
        assert top["snippet"]
        assert "肺炎" in top["snippet"]

    def test_textbook_scope_restricts_results(self):
        results = search("肺炎", textbook="内科护理学", top_k=5)
        assert results
        assert {r["textbook"] for r in results} == {"内科护理学"}

    def test_unknown_textbook_returns_empty(self):
        assert search("肺炎", textbook="不存在的教材") == []

    def test_latin_terms_still_searchable(self):
        assert search("COPD", top_k=3)

    def test_empty_and_punctuation_only_query_return_nothing(self):
        """空/纯标点查询不得产出"垃圾命中"（旧实现兜底 terms=[query]，count("") 语义命中全部）。"""
        assert search("") == []
        assert search("   ") == []
        assert search("？？！") == []

    def test_unmatched_query_returns_empty(self):
        assert search("zzqqxxnotfoundterm") == []

    def test_long_pasted_question_still_recalls(self):
        """问题框允许 4096 字：长粘贴不得退化成逐字 2-gram 的全库扫描。"""
        question = "肺炎病人的护理措施有哪些？" * 200
        results = search(question, top_k=3)
        assert results
        assert any(r["heading"] in _PNEUMONIA_SECTION for r in results)

    def test_tokenize_bounds_term_count(self):
        from modules.qa.knowledge_base.chapter_index import _MAX_TERMS, _tokenize

        distinct_chars = "".join(chr(0x4E00 + i) for i in range(500))  # 500 个互异汉字
        assert len(_tokenize(distinct_chars)) == _MAX_TERMS


class TestSectionKey:
    def test_roundtrip_plain(self):
        key = make_section_key("第二章 呼吸系统疾病病人的护理", "第二节 概述")
        assert key == "第二章 呼吸系统疾病病人的护理/第二节 概述"
        assert parse_section_key(key) == ("第二章 呼吸系统疾病病人的护理", "第二节 概述")

    def test_roundtrip_preserves_slash_in_heading(self):
        """教材实有 `## 第二节 断肢/指再植`，标题里的 "/" 不能被当作分隔符切断。"""
        heading = "第二节 断肢/指再植"
        chapter = "第四十一章 手外伤及断肢指再植病人的护理"
        assert parse_section_key(make_section_key(chapter, heading)) == (chapter, heading)

    def test_key_without_separator(self):
        assert parse_section_key("没有章节前缀") == ("", "没有章节前缀")

    def test_read_by_key_returns_body_for_slash_heading(self):
        results = search("断肢再植护理", top_k=5)
        slash_hit = next((r for r in results if "/" in r["heading"]), None)
        assert slash_hit, "语料中应能检索到含 '/' 的小节"
        key = make_section_key(slash_hit["chapter"], slash_hit["heading"])
        body = read_section_by_key(slash_hit["textbook"], key)
        assert body
        assert "再植" in body

    def test_read_by_key_missing_returns_none(self):
        assert read_section_by_key("内科护理学", "不存在的章节/不存在的小节") is None
        assert read_section_by_key("不存在的教材", "第一章/第一节 概述") is None


class TestCitationChain:
    def test_pre_search_produces_resolvable_citations(self):
        citations = pre_search(_PNEUMONIA_QUESTION)
        assert citations
        for c in citations:
            assert c["source"]
            assert c["section"]
            # 引用原文必须可解析（旧实现 section=裸 heading，消费端等值比较 → 恒 404）
            assert read_section_by_key(c["source"], c["section"])

    def test_section_text_endpoint_serves_pre_search_citation(self):
        citation = pre_search(_PNEUMONIA_QUESTION)[0]
        payload = get_section_text(source=citation["source"], section=citation["section"])
        assert payload["source"] == citation["source"]
        assert payload["section"] == citation["section"]
        assert payload["text"]

    def test_section_text_endpoint_404_for_unknown_key(self):
        with pytest.raises(HTTPException) as exc:
            get_section_text(source="内科护理学", section="不存在/不存在的小节")
        assert exc.value.status_code == 404

    def test_inject_search_context_includes_real_body_not_error_text(self):
        citations = pre_search(_PNEUMONIA_QUESTION)
        messages: list[dict] = [{"role": "user", "content": _PNEUMONIA_QUESTION}]
        inject_search_context(messages, citations)
        assert len(messages) == 2
        injected = messages[1]["content"]
        assert messages[1]["role"] == "system"
        assert "肺炎" in injected
        # read_section 的失败哨兵串绝不能被当作教材正文注入
        assert "不存在于" not in injected
        assert "教材 '" not in injected

    def test_inject_search_context_skips_unresolvable_citation(self):
        messages: list[dict] = [{"role": "user", "content": "问题"}]
        inject_search_context(messages, [{"source": "内科护理学", "section": "不存在/不存在"}])
        assert "不存在于" not in messages[1]["content"]
