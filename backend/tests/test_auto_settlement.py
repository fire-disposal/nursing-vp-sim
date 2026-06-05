from services.auto_settlement import count_covered_inquiries, should_auto_score


def test_count_covered_inquiries_empty():
    inquiries = []
    student_text = "你好，请问你哪里不舒服？"
    assert count_covered_inquiries(inquiries, student_text) == 0


def test_count_covered_inquiries_no_match():
    inquiries = ["姓名", "年龄", "主诉", "既往史", "过敏史", "用药情况"]
    student_text = "你好"
    assert count_covered_inquiries(inquiries, student_text) == 0


def test_count_covered_inquiries_partial_match():
    inquiries = ["姓名", "年龄", "主诉", "既往史", "过敏史", "用药情况"]
    student_text = "你叫什么名字？今年多大了？哪里不舒服？"
    assert count_covered_inquiries(inquiries, student_text) == 3


def test_count_covered_inquiries_all_match():
    inquiries = ["主诉", "现病史"]
    student_text = "你哪里不舒服？这个情况持续多久了？"
    assert count_covered_inquiries(inquiries, student_text) == 2


def test_count_covered_inquiries_fuzzy_match():
    inquiries = ["发热情况"]
    student_text = "你有没有发热"
    assert count_covered_inquiries(inquiries, student_text) == 1


class FakeMessage:
    def __init__(self, role, content):
        self.role = role
        self.content = content


def test_should_auto_score_passes():
    messages = [
        FakeMessage("patient", "你好，我是患者。今天不太舒服。"),
        FakeMessage("student", "你好，请问你的姓名、年龄？哪里不舒服？持续多久了？有没有什么诱因？"),
        FakeMessage("patient", "我叫张三，今年35岁。咳嗽三天了，可能是着凉了。"),
    ]
    case_data = {"required_inquiries": ["姓名", "年龄", "主诉", "现病史", "诱因", "既往史", "过敏史"]}
    assert should_auto_score(messages, case_data) is True


def test_should_auto_score_fails_empty():
    messages = [
        FakeMessage("patient", "你好，我是患者。今天不太舒服。"),
    ]
    case_data = {"required_inquiries": ["姓名", "年龄", "主诉", "现病史", "诱因"]}
    assert should_auto_score(messages, case_data) is False


def test_should_auto_score_fails_low_chars():
    messages = [
        FakeMessage("patient", "你好"),
        FakeMessage("student", "好"),
    ]
    case_data = {"required_inquiries": ["姓名", "年龄", "主诉", "现病史", "诱因", "既往史"]}
    assert should_auto_score(messages, case_data) is False
