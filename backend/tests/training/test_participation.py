"""`is_student_practice` 判定——纯函数测试，不连库。"""

from modules.training.participation import TEACHING_PERMISSIONS, is_student_practice


def test_student_is_practice():
    """学生角色只有 training_access / qa_access → 任何入口都是学生练习。"""
    assert is_student_practice(permissions={"training_access", "qa_access"}) is True


def test_no_permissions_is_practice():
    """权限加载不到时不臆造"非练习"：默认按学生练习算。"""
    assert is_student_practice(permissions=set()) is True


def test_teacher_rehearsal_is_not_practice():
    """能出题或能复核的人在自己账号里开始 → 不算学生练习（试跑/演示/判例）。"""
    assert is_student_practice(permissions={"training_access", "case_manage", "score_review"}) is False
    assert is_student_practice(permissions={"case_manage"}) is False
    assert is_student_practice(permissions={"score_review"}) is False


def test_unrelated_permissions_do_not_disqualify():
    """与教学/复核无关的权限（如能看统计）不改变判定。"""
    assert is_student_practice(permissions={"training_access", "stats_view", "qa_access"}) is True


def test_teaching_permissions_are_the_only_disqualifier():
    assert set(TEACHING_PERMISSIONS) == {"case_manage", "score_review"}
