#!/usr/bin/env python3
"""U0 候选清单：把「冻结的那一版到底是什么」从**既有字段**导出来（docs/19 §U0-C 第 4 条）。

清单里每一项都来自真实字段，不靠人工回忆，也不新增存储：

| 清单项 | 来源 |
|---|---|
| 提交 | `git rev-parse HEAD`（+ 分支/脏树/所在 tag） |
| `APP_VERSION` / `EXPERIMENT_BATCH` | 部署环境（`core.config`，与进程同一份 env） |
| 病例 revision | `cases.current_revision_id` → `case_revisions.revision_no` + 内容指纹 `case@<hash12>` |
| 模式 | 记录的 `practice_snapshot.behavior.mode`（`normalize_training_mode`，缺省 guided） |
| 模型 profile | 评分记录上的 `scores.model_name`（真实调用过的模型，不写"配置里大概是什么"） |
| 患者 prompt 身份 | 记录 `prompt_snapshot` → `prompt_identity.prompt_id_from_snapshot`（`<workflow>@<hash12>`） |
| rubric 身份 | `scores.rubric_version` + `scores.mapping_version` |
| 上下文策略身份 | 记录 `context_policy_version` + 当前代码的 `ctx@<hash8>` |
| 问卷模板 | 模板 id/标题/`updated_at` + 题目指纹 `_questions_digest`（服务端实现） |

**缺项不补默认值**：任何身份取不到就写 `null` 并计入 `gaps`，同时以退出码 1 结束——
候选冻结不能因为"清单打出来了"就宣布成立（docs/19 §1.3、§八）。

用法::

    uv run --project backend python scripts/u0-candidate-manifest.py
    uv run --project backend python scripts/u0-candidate-manifest.py --case-name 咳嗽咳痰伴呼吸困难 --out /tmp/u0-manifest.json

只读：仅 SELECT，不写库、不改配置、不碰历史成绩。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.config import APP_VERSION, ENV, EXPERIMENT_BATCH  # noqa: E402
from core.database import SessionLocal  # noqa: E402
from core.statuses import normalize_training_mode  # noqa: E402
from models import Case, CaseRevision, QuestionnaireTemplate, Score, TrainingRecord  # noqa: E402
from modules.questionnaires.service import QuestionnaireTemplateService  # noqa: E402
from modules.training.manifest import experiment_label  # noqa: E402
from modules.training.prompt_identity import (  # noqa: E402
    compute_context_policy_version,
    prompt_id_from_snapshot,
)


def _digest(payload: object) -> str:
    blob = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:12]


def git_identity() -> dict:
    def run(*args: str) -> str:
        try:
            return subprocess.run(  # noqa: S603 — 固定参数，无 shell
                ["git", *args],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            ).stdout.strip()
        except (
            OSError,
            subprocess.SubprocessError,
        ) as exc:  # pragma: no cover - 环境问题
            return f"<error: {exc}>"

    head = run("rev-parse", "HEAD")
    return {
        "commit": head,
        "short": head[:9],
        "branch": run("rev-parse", "--abbrev-ref", "HEAD"),
        "dirty": bool(run("status", "--porcelain")),
        "tag": run("describe", "--tags", "--exact-match", "HEAD") or None,
        "commit_date": run("show", "-s", "--format=%cI", "HEAD"),
    }


def case_identity(db, case_name: str) -> tuple[dict, list[str]]:
    gaps: list[str] = []
    case = db.query(Case).filter(Case.name == case_name).one_or_none()
    if case is None:
        return {"name": case_name, "found": False}, [f"病例不存在：{case_name}"]

    revision = (
        db.get(CaseRevision, case.current_revision_id)
        if case.current_revision_id
        else None
    )
    if revision is None:
        gaps.append("病例没有已发布 revision：新开始会拿不到内容")

    content = (revision.content if revision else None) or {}
    out = {
        "name": case.name,
        "case_id": case.id,
        "status": case.status,
        "current_revision_id": case.current_revision_id,
        "revision_no": revision.revision_no if revision else None,
        "published_at": revision.published_at.isoformat()
        if revision and revision.published_at
        else None,
        "content_digest": f"case@{_digest(content)}" if content else None,
        "has_scene": "scene" in content,
        "has_blueprint": "blueprint" in content,
        "blueprint_editorial_state": (
            (content.get("blueprint") or {}).get("review") or {}
        ).get("editorial_state"),
    }
    if not out["has_scene"]:
        gaps.append("U0 病例缺 scene：患者上下文没有环境/体位/可见体征来源")
    if not out["has_blueprint"]:
        gaps.append(
            "U0 病例没有 blueprint：评分提示词里没有 must_cover 等任务边界，也没有教师审阅留痕字段"
            "（`blueprint.review.editorial_state`）——要么补齐，要么由研究者显式接受这一状态"
        )
    return out, gaps


def questionnaire_identity(db, title: str) -> tuple[dict, list[str]]:
    template = (
        db.query(QuestionnaireTemplate)
        .filter(QuestionnaireTemplate.title == title)
        .one_or_none()
    )
    if template is None:
        return {"title": title, "found": False}, [f"问卷模板不存在：{title}"]
    return (
        {
            "title": template.title,
            "template_id": template.id,
            "is_active": getattr(template, "is_active", None),
            "updated_at": template.updated_at.isoformat()
            if getattr(template, "updated_at", None)
            else None,
            "questions_digest": f"questions@{QuestionnaireTemplateService(db)._stored_questions_digest(template.id)}",
        },
        [],
    )


def training_identity(db, case_id: int, expect_batch: str) -> tuple[dict, list[str]]:
    gaps: list[str] = []
    base = db.query(TrainingRecord).filter(TrainingRecord.case_id == case_id)
    total = base.count()
    latest = base.order_by(TrainingRecord.id.desc()).first()
    if latest is None:
        return (
            {"records_total": 0, "records_in_batch": 0, "sample_record": None},
            [
                "候选环境里还没有该病例的训练记录：prompt/模式/评分来源无法从真实数据取证"
            ],
        )

    prompt_id = prompt_id_from_snapshot(latest.prompt_snapshot, latest.workflow_id)
    if not prompt_id:
        gaps.append(
            f"记录 {latest.id} 没有 prompt_snapshot：患者 prompt 身份不可知（历史记录可能本就为空）"
        )
    # 评分身份取**最近一条已评分**记录：最新记录可能刚开始、还没交卷，拿它当评分来源等于写了 null
    scored = (
        db.query(TrainingRecord, Score)
        .join(Score, Score.record_id == TrainingRecord.id)
        .filter(TrainingRecord.case_id == case_id)
        .order_by(TrainingRecord.id.desc())
        .first()
    )
    if scored is None:
        gaps.append(
            "候选环境里没有该病例的已评分记录：rubric/映射/模型身份无法从真实数据取证"
        )
    score = scored[1] if scored else None
    scored_record = scored[0] if scored else None

    mode = normalize_training_mode(
        (latest.practice_snapshot or {}).get("behavior", {}).get("mode")
    )
    batch_counts = {
        label: 0
        for label in {
            experiment_label((r.practice_snapshot or {}))
            for r in base.with_entities(TrainingRecord.practice_snapshot)
        }
    }
    for (snapshot,) in base.with_entities(TrainingRecord.practice_snapshot):
        label = experiment_label(snapshot)
        batch_counts[label] = batch_counts.get(label, 0) + 1

    context_record = latest.context_policy_version
    if not context_record:
        gaps.append(
            f"记录 {latest.id} 的 context_policy_version 为空（列存在前创建的历史记录不回填）"
        )

    out = {
        "records_total": total,
        "records_in_batch": batch_counts.get(expect_batch, 0),
        "batch_label_counts": batch_counts,
        "sample_record": {
            "id": latest.id,
            "workflow_id": latest.workflow_id,
            "created_at": latest.start_time.isoformat() if latest.start_time else None,
            "status": getattr(latest.status, "value", latest.status),
            "mode": mode,
            "batch": experiment_label(latest.practice_snapshot) or None,
        },
        "scored_record": (
            {
                "id": scored_record.id,
                "model_name": score.model_name,
                "rubric_version": score.rubric_version,
                "mapping_version": score.mapping_version,
                "raw_total": score.raw_total,
                "fallback": score.fallback,
            }
            if scored_record is not None
            else None
        ),
        "patient_prompt": prompt_id,
        "context_policy_frozen": context_record,
        "context_policy_current_code": compute_context_policy_version(),
    }
    if context_record and context_record != out["context_policy_current_code"]:
        gaps.append(
            "记录冻结的上下文策略与当前代码不一致：记录的产物与当前代码装配方式不同，"
            "候选清单必须说明用哪一侧解释结果"
        )
    return out, gaps


def main() -> None:
    parser = argparse.ArgumentParser(description="导出 U0 候选清单（只读）")
    parser.add_argument("--case-name", default="咳嗽咳痰伴呼吸困难")
    parser.add_argument(
        "--questionnaire-title", default="系统可用性量表（SUS）+ 开放题 · U0"
    )
    parser.add_argument("--expect-batch", default="usability-u0")
    parser.add_argument("--out", default=None, help="清单 JSON 的输出路径")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        case, case_gaps = case_identity(db, args.case_name)
        questionnaire, questionnaire_gaps = questionnaire_identity(
            db, args.questionnaire_title
        )
        training, training_gaps = training_identity(
            db, case.get("case_id", -1), args.expect_batch
        )
    finally:
        db.close()

    gaps = case_gaps + questionnaire_gaps + training_gaps
    if not EXPERIMENT_BATCH:
        gaps.append(
            "环境变量 EXPERIMENT_BATCH 未设置：新记录不会带批次标签，"
            f"U0 数据无法按 {args.expect_batch} 认出（生产设置需另行授权，见 docs/19 §U0-D）"
        )
    elif EXPERIMENT_BATCH != args.expect_batch:
        gaps.append(
            f"EXPERIMENT_BATCH={EXPERIMENT_BATCH} 与候选批次 {args.expect_batch} 不一致"
        )
    if case.get("blueprint_editorial_state") not in (None, "teacher_reviewed"):
        gaps.append(
            f"病例蓝图审阅状态={case.get('blueprint_editorial_state')}：临床事实尚未由护理教师确认，"
            "候选清单不得据此声明已审阅"
        )

    manifest = {
        "generated_at": datetime.now(UTC).isoformat(),
        "source": git_identity(),
        "deployment": {
            "app_version": APP_VERSION,
            "environment": ENV,
            "experiment_batch": EXPERIMENT_BATCH or None,
        },
        "case": case,
        "questionnaire": questionnaire,
        "training": training,
        "gaps": gaps,
        "complete": not gaps,
    }

    print(f"U0 候选清单（{args.expect_batch}）")
    print(
        f"  提交      {manifest['source']['short']} {'(脏树)' if manifest['source']['dirty'] else ''}"
    )
    print(f"  版本      {APP_VERSION} / 环境 {ENV}")
    print(
        "  病例      "
        f"{case.get('name')} revision={case.get('revision_no')} {case.get('content_digest')} "
        f"scene={case.get('has_scene')} 蓝图审阅={case.get('blueprint_editorial_state')}"
    )
    print(
        f"  问卷      {questionnaire.get('title')} {questionnaire.get('questions_digest')}"
    )
    print(
        "  训练      "
        f"记录 {training.get('records_total')} 条（批次内 {training.get('records_in_batch')}），"
        f"prompt={training.get('patient_prompt')}"
    )
    print(
        "  身份      "
        f"ctx 冻结={training.get('context_policy_frozen')} 当前代码={training.get('context_policy_current_code')}"
    )
    sample = training.get("sample_record") or {}
    scored = training.get("scored_record") or {}
    print(
        "  样本记录  "
        f"#{sample.get('id')} 模式={sample.get('mode')} 批次={sample.get('batch')} 状态={sample.get('status')}"
    )
    print(
        "  评分来源  "
        f"记录#{scored.get('id')} 模型={scored.get('model_name')} rubric={scored.get('rubric_version')} "
        f"映射={scored.get('mapping_version')} 原始分={scored.get('raw_total')} 降级={scored.get('fallback')}"
    )
    print(f"  缺项      {len(gaps)}")
    for gap in gaps:
        print(f"    - {gap}")

    if args.out:
        Path(args.out).write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"  清单已写入 {args.out}")
    sys.exit(0 if not gaps else 1)


if __name__ == "__main__":
    main()
