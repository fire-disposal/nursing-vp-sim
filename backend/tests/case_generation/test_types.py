from schemas.case_schema import list_valid_training_types


def test_only_registered_types_allowed():
    valid = set(list_valid_training_types())
    assert "history_taking" in valid
    assert "triage" in valid
    assert "physical_exam" not in valid
    assert "nursing_operation" not in valid
