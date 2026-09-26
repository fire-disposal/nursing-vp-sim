"""导入卫生：包初始化不得拉起整个应用。

这个不变量已经被破坏过三次，每次症状都是"某个导入顺序下随机报循环导入"：

* ``modules/training/__init__`` 曾急切导入两个 router；
* ``modules/training/session/__init__`` 曾急切导入 settlement；
* ``modules/training/pipeline/__init__`` 曾急切导入 runner（→ 五个中间件 → workflows → profile）。

判据很硬：**导入一个深层模块，不应把 routers / workflows / 中间件链拉进 sys.modules**。
用子进程验证（同进程里其它测试早已导入了这些模块，无法区分）。
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]

#: 被导入时**不该**出现的模块前缀（应用装配层的标志物）
_FORBIDDEN = (
    "modules.training.router",
    "modules.training.workflows",
    "modules.training.pipeline.runner",
    "modules.training.pipeline.middleware",
    "modules.training.session.settlement",
)


def _pulled_by(module: str) -> list[str]:
    code = f"import sys\nimport {module}\nforbidden = [m for m in sys.modules if m.startswith({_FORBIDDEN!r})]\nprint('|'.join(sorted(forbidden)))\n"
    proc = subprocess.run(  # noqa: S603 — module 名来自本文件的常量，不是外部输入
        [sys.executable, "-c", code],
        cwd=BACKEND,
        capture_output=True,
        text=True,
        check=True,
    )
    out = proc.stdout.strip()
    return out.split("|") if out else []


class TestPackageInitIsInert:
    def test_pipeline_context_import_is_light(self):
        """深层模块（notes 在导入期就引用它）不得顺带装配中间件链。"""
        assert _pulled_by("modules.training.pipeline.context") == []

    def test_session_cache_import_is_light(self):
        assert _pulled_by("modules.training.session.cache") == []

    def test_prompt_identity_import_is_light(self):
        assert _pulled_by("modules.training.prompt_identity") == []

    def test_importing_the_domain_package_is_light(self):
        assert _pulled_by("modules.training") == []
