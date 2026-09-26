"""持久化 Job 的可验证部分（docs/ideas/pipeline-and-job-separation.md）。

**验证边界（必须明说）**：认领语义依赖 PostgreSQL 的 ``FOR UPDATE SKIP LOCKED`` 与
``make_interval``，本地无库（本仓测试约定：纯逻辑、不连库）**无法验证**。这里只钉：

* 常量绑定关系（租约必须长于评分超时，否则"还在跑"的任务会被判死重领）；
* 退避函数的单调性与上限；
* 入队分支：``job`` 模式写 jobs 表且**不碰** TaskQueue；``inline`` 模式保持原语义。

认领/心跳/重领的 SQL 行为需要在目标库上验证（切换前的验收步骤）。
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from core import config as config_module
from infra import jobs


class TestConfigBinding:
    def test_execution_mode_is_one_of_two(self):
        assert config_module.SCORING_EXECUTION in {"inline", "job"}

    def test_lease_outlives_scoring_timeout(self):
        """租约必须长于一次评分的最坏耗时，否则执行中的任务会被判死并重领。"""
        assert config_module.JOB_LEASE_SECONDS > config_module.SCORING_TIMEOUT_SECONDS

    def test_heartbeat_is_frequent_enough(self):
        """心跳间隔要显著小于租约，至少能容忍一次丢包。"""
        assert config_module.JOB_HEARTBEAT_SECONDS * 2 < config_module.JOB_LEASE_SECONDS

    def test_lease_follows_timeout_env(self, monkeypatch):
        """租约是派生值：改 SCORING_TIMEOUT_SECONDS 时租约随之变化（不手填）。"""
        assert config_module.JOB_LEASE_SECONDS == config_module.SCORING_TIMEOUT_SECONDS + 120


class TestBackoff:
    def test_first_failure_uses_base(self):
        assert jobs.backoff_seconds(1) == config_module.JOB_RETRY_BACKOFF_SECONDS

    def test_backoff_grows_and_is_capped(self):
        values = [jobs.backoff_seconds(n) for n in range(1, 8)]
        assert values == sorted(values), "退避必须单调不减"
        assert max(values) == config_module.JOB_RETRY_BACKOFF_CAP_SECONDS

    def test_zero_or_negative_attempts_waits_nothing(self):
        assert jobs.backoff_seconds(0) == 0


class TestOwnerIdentity:
    def test_owner_carries_role_host_and_pid(self):
        owner = jobs.job_owner("worker")
        role, host, pid = owner.split(":")
        assert role == "worker"
        assert host
        assert pid.isdigit()

    def test_owner_changes_between_roles(self):
        assert jobs.job_owner("inline") != jobs.job_owner("worker")


class TestEnqueueBranch:
    """入队是唯一分支点：两种模式互斥，且 job 模式不得依赖 TaskQueue。"""

    @pytest.fixture
    def runner(self):
        import modules.training.scoring.runner as runner_module

        return runner_module

    async def test_job_mode_writes_row_and_ignores_task_queue(self, runner, monkeypatch):
        calls: list[tuple[int, int]] = []
        monkeypatch.setattr(runner, "SCORING_EXECUTION", "job")
        monkeypatch.setattr(runner, "_enqueue_job_row", lambda record_id, priority: calls.append((record_id, priority)))

        class _Exploding:
            async def enqueue(self, *_args, **_kwargs):  # pragma: no cover - 不得被调用
                raise AssertionError("job 模式不得使用 TaskQueue")

        state = SimpleNamespace(task_queue=_Exploding())
        await runner.enqueue_scoring(state, 42, {"any": "case"}, priority=7)

        assert calls == [(42, 7)]

    async def test_job_mode_works_without_task_queue(self, runner, monkeypatch):
        monkeypatch.setattr(runner, "SCORING_EXECUTION", "job")
        monkeypatch.setattr(runner, "_enqueue_job_row", lambda record_id, priority: 1)
        # 没有 task_queue 也不该 raise：job 模式只需要能写表
        await runner.enqueue_scoring(SimpleNamespace(), 1, None)

    async def test_inline_mode_still_requires_task_queue(self, runner, monkeypatch):
        monkeypatch.setattr(runner, "SCORING_EXECUTION", "inline")
        with pytest.raises(RuntimeError, match="TaskQueue"):
            await runner.enqueue_scoring(SimpleNamespace(task_queue=None), 1, {})

    async def test_inline_mode_enqueues_run_scoring_background(self, runner, monkeypatch):
        captured: dict = {}

        class _Queue:
            async def enqueue(self, factory, *, priority=0):
                captured["priority"] = priority
                captured["factory"] = factory

        monkeypatch.setattr(runner, "SCORING_EXECUTION", "inline")
        await runner.enqueue_scoring(
            SimpleNamespace(task_queue=_Queue(), llm_client=object()), 9, {"case": True}, priority=5
        )

        assert captured["priority"] == 5
        assert callable(captured["factory"])
