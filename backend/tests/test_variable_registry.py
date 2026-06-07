"""Tests for VariableRegistry"""

from services.prompt import VariableDef, get_registry


class TestRegistryLookup:
    def test_patient_chat_has_eight_variables(self):
        r = get_registry()
        vars_ = r.get_variables("patient_chat")
        assert len(vars_) == 10

    def test_qa_has_no_variables(self):
        r = get_registry()
        assert r.get_variables("qa") == []

    def test_unknown_purpose_returns_empty(self):
        r = get_registry()
        assert r.get_variables("nonexistent") == []

    def test_get_variable_names(self):
        r = get_registry()
        names = r.get_variable_names("patient_chat")
        assert "patient_info" in names
        assert "patient_info" in names
        assert "scenario" in names
        assert "example_dialogues" in names

    def test_get_variable_map_patient_chat_has_content(self):
        r = get_registry()
        m = r.get_variable_map("patient_chat")
        assert isinstance(m["patient_info"], VariableDef)
        assert m["patient_info"].type == "string"
        assert m["patient_info"].source != ""

    def test_get_variable_map_scoring(self):
        r = get_registry()
        m = r.get_variable_map("scoring")
        assert "scoring_rubric" in m
        assert isinstance(m["scoring_rubric"], VariableDef)

    def test_get_variable_map_unknown_purpose_returns_empty(self):
        r = get_registry()
        assert r.get_variable_map("nonexistent") == {}

    def test_get_defaults(self):
        r = get_registry()
        defaults = r.get_defaults("case_generation")
        assert "description" in defaults
        assert "reference_material" in defaults

    def test_get_defaults_qa_empty(self):
        r = get_registry()
        assert r.get_defaults("qa") == {}

    def test_get_variable_names_qa_empty(self):
        r = get_registry()
        assert r.get_variable_names("qa") == set()

    def test_get_sample_kwargs_case_generation_has_keys(self):
        r = get_registry()
        kwargs = r.get_sample_kwargs("case_generation")
        assert "description" in kwargs
        assert "reference_material" in kwargs

    def test_get_sample_kwargs_scoring_has_rubric(self):
        r = get_registry()
        kwargs = r.get_sample_kwargs("scoring")
        assert "scoring_rubric" in kwargs
        assert "conversation_text" in kwargs
        assert len(kwargs["scoring_rubric"]) > 50

    def test_get_sample_kwargs_qa_empty(self):
        r = get_registry()
        assert r.get_sample_kwargs("qa") == {}


class TestRegistryValidation:
    def test_known_vars_pass(self):
        r = get_registry()
        errors, warnings = r.validate_template_vars("patient_chat", {"patient_info", "chief_complaint"})
        assert errors == []
        assert warnings == []

    def test_unknown_var_warns_not_errors(self):
        r = get_registry()
        errors, warnings = r.validate_template_vars("patient_chat", {"patient_info", "made_up_var"})
        assert errors == []
        assert len(warnings) == 1
        assert "made_up_var" in warnings[0]

    def test_all_unknown_vars_warn(self):
        r = get_registry()
        errors, warnings = r.validate_template_vars("patient_chat", {"a", "b", "c"})
        assert errors == []
        assert len(warnings) == 1
        assert "a" in warnings[0]
        assert "b" in warnings[0]
        assert "c" in warnings[0]

    def test_empty_set_passes(self):
        r = get_registry()
        errors, warnings = r.validate_template_vars("patient_chat", set())
        assert errors == []
        assert warnings == []

    def test_qa_blocks_any_var_as_error(self):
        r = get_registry()
        errors, warnings = r.validate_template_vars("qa", {"anything"})
        assert len(errors) == 1
        assert "anything" in errors[0]
        assert warnings == []

    def test_error_message_includes_known_vars(self):
        r = get_registry()
        errors, warnings = r.validate_template_vars("patient_chat", {"bad_var"})
        assert errors == []
        assert len(warnings) == 1
        assert "patient_info" in warnings[0]

    def test_known_var_plus_unknown_var_warns(self):
        r = get_registry()
        errors, warnings = r.validate_template_vars("patient_chat", {"patient_info", "unknown"})
        assert errors == []
        assert len(warnings) == 1


class TestVariablesJsonb:
    def test_jsonb_has_required_fields(self):
        r = get_registry()
        data = r.get_variables_jsonb("patient_chat")
        assert len(data) == 10
        for entry in data:
            assert "name" in entry
            assert "desc" in entry
            assert "source" in entry
            assert "type" in entry
            assert "example" in entry
            assert entry["desc"] != ""

    def test_jsonb_qa_empty(self):
        r = get_registry()
        assert r.get_variables_jsonb("qa") == []

    def test_jsonb_unknown_purpose_empty(self):
        r = get_registry()
        assert r.get_variables_jsonb("nonexistent") == []
