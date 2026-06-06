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
    inquiries = ["名字", "年龄", "不舒服", "头痛", "发烧"]
    student_text = "你叫什么名字？今年多大了？哪里不舒服？"
    assert count_covered_inquiries(inquiries, student_text) == 2


def test_count_covered_inquiries_all_match():
    inquiries = ["名字", "舒服"]
    student_text = "你叫什么名字？哪里不舒服？"
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
    base = (
        "请问您叫什么名字？今年多大年龄了？"
        + "您哪里不舒服？具体是发热还是咳嗽还是头痛恶心？"
        + "喉咙痛不痛？有没有胸闷？"
    )
    long_student = base * 4
    patient_base = (
        "我咳嗽发烧已经持续一周了，体温最高39度，头痛恶心呕吐吃不下饭睡不着觉。"
    )
    long_patient = patient_base * 18
    messages = [
        FakeMessage("patient", "你好，我是来就诊的。"),
        FakeMessage("student", long_student),
        FakeMessage("patient", long_patient),
    ]
    case_data = {"required_inquiries": ["发热", "咳嗽", "头痛", "恶心", "胸闷"]}
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
