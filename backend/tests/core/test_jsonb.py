"""Unit tests for PydanticJSONB column adapter — no database needed."""

from core.jsonb import JsonbModel, PydanticJSONB


class Payload(JsonbModel):
    name: str = ""
    age: int = 0


class _Dialect:
    pass


class TestJsonbModel:
    def test_extra_keys_ignored_on_validation(self):
        model = Payload.model_validate({"name": "x", "age": 1, "unknown": True})
        assert model.name == "x"

    def test_defaults_fill_missing_fields(self):
        model = Payload.model_validate({})
        assert model.name == ""
        assert model.age == 0


class TestProcessBindParam:
    def test_none_passthrough(self):
        col = PydanticJSONB(Payload)
        assert col.process_bind_param(None, _Dialect()) is None

    def test_dict_cleaned_through_model(self):
        col = PydanticJSONB(Payload)
        result = col.process_bind_param({"name": "王", "age": 30}, _Dialect())
        assert result == {"name": "王", "age": 30}

    def test_dict_drops_unknown_keys(self):
        col = PydanticJSONB(Payload)
        result = col.process_bind_param({"name": "王", "junk": 1}, _Dialect())
        assert result == {"name": "王", "age": 0}

    def test_model_instance_dumped_to_json(self):
        col = PydanticJSONB(Payload)
        result = col.process_bind_param(Payload(name="李"), _Dialect())
        assert result == {"name": "李", "age": 0}

    def test_invalid_data_stored_raw_without_raising(self):
        # Read-loose policy: advisory guard must not block write paths.
        col = PydanticJSONB(Payload)
        bad = {"age": "not-a-number"}
        assert col.process_bind_param(bad, _Dialect()) is bad


class TestProcessResultValue:
    def test_raw_dict_passthrough(self):
        col = PydanticJSONB(Payload)
        raw = {"name": "历史数据", "age": 1}
        assert col.process_result_value(raw, _Dialect()) is raw
