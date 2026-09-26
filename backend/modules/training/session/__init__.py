"""Training session subsystem — settlement, caching, state.

**本包不导入任何子模块**（曾经在这里 `from .settlement import settlement_loop`）：
包初始化一旦拉起子模块，深层导入（``pipeline.context`` → ``pipeline`` 包 → …）就会
顺着 ``settlement → finalize → workflows → profile`` 绕回还在导入中的模块，形成环。
调用方一律走具体模块路径：

* ``from modules.training.session.cache import InitiativeCache``
* ``from modules.training.session.settlement import settlement_loop``
* ``from modules.training.session.state import patch_runtime_state``

新增子模块时不要在这里 re-export —— 入口导航写在 ``modules/training/__init__.py`` 的地图里。
"""
