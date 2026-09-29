"""「这条训练是不是学生练习」的唯一判定。

``training_records.is_student_practice`` 回答的是一个**教学事实**：这次训练是不是一次学生练习
（计入教学统计、作业态度与次数、排行榜、以及学生自己的练习历史）。旧字段 ``is_test`` 把同一件事
从否定面读（``is_test == False``）、且名字说的是"测试性质"，于是"什么算真实练习"只能靠读各处过滤
条件反推。现在字段名、语义与筛选条件同向，判定规则集中在本模块。

规则：**发起者不具备教学/复核权限 → 学生练习**。

* 学生角色只有 ``training_access`` / ``qa_access``，所以学生的作业、自由练习、同例重练与迁移变式
  都算学生练习；
* 教师 / 管理员 / 超管的任何开始都**不算** —— 他们的记录用于试跑、演示与判例，不能混进学生数据。

**不做请求参数覆盖**：本系统角色是互斥的（``users.role_id`` 单角色），不存在"教师兼学生、这次以学生
身份练"的合法场景；开放一个"我这次不算练习"的声明，等于给"绕过作业最大尝试次数与在训唯一性"开口子
（两者都按学生练习过滤，见 ``router/session.py``）。
"""

from __future__ import annotations

from collections.abc import Collection

#: 具备其中之一 = 能出题或能复核，其训练因此不算学生练习
TEACHING_PERMISSIONS: frozenset[str] = frozenset({"case_manage", "score_review"})


def is_student_practice(*, permissions: Collection[str]) -> bool:
    """按发起者的权限判定这条训练是不是学生练习（纯函数）。"""
    return not (TEACHING_PERMISSIONS & set(permissions))
