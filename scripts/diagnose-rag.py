"""Diagnose RAG retrieval quality for sample nursing questions."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from infrastructure.rag.retriever import _load_chunks, _split_terms, _build_idf, _score

QUESTIONS = [
    ("注射前如何消毒", "消毒步骤, 注射部位, 无菌技术, 皮肤消毒"),
    ("糖尿病患者饮食护理", "糖尿病饮食, 血糖控制, 营养管理"),
    ("术后引流管护理注意事项", "引流管护理, 术后护理, 引流液观察"),
    ("心肺复苏基本步骤", "心肺复苏, CPR, 胸外按压, 人工呼吸"),
    ("压疮预防措施", "压疮预防, 皮肤护理, 体位变换"),
    ("静脉输液注意事项", "静脉输液, 输液速度, 输液反应"),
    ("心衰病人的体位护理", "心衰体位, 半卧位, 端坐呼吸"),
]


def diagnose():
    chunks = _load_chunks()
    print(f"Total chunks: {len(chunks)}\n")

    for question, llm_keywords in QUESTIONS:
        print(f"{'='*60}")
        print(f"Q: {question}")
        print(f"LLM keywords: {llm_keywords}")

        terms = _split_terms(llm_keywords)
        print(f"Parsed terms: {terms}")

        idf = _build_idf(chunks, terms)
        sorted_idf = sorted(idf.items(), key=lambda x: x[1], reverse=True)
        print(f"IDF: {[(t, round(w,2)) for t, w in sorted_idf[:8]]}")

        scored = []
        for c in chunks:
            s = _score(c.chunk_text, terms, idf)
            if s > 0:
                scored.append((s, c))
        scored.sort(key=lambda x: x[0], reverse=True)

        for i, (score, c) in enumerate(scored[:3]):
            src = c.source.replace("textbook:", "")
            sect = c.section.rsplit("/", 1)[-1] if "/" in c.section else c.section
            ch = "/".join(c.section.split("/")[:2]) if "/" in c.section else c.section
            preview = c.chunk_text[:100].replace("\n", " ")
            print(f"  #{i+1} score={score:.2f} {src} | {ch[:60]}")
            print(f"      section: {sect[:50]}")
            print(f"      preview: {preview}...")
            print()


if __name__ == "__main__":
    diagnose()
