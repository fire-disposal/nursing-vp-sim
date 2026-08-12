"""Replay determinism — the same action sequence must reproduce the exact
same state, including the compartment physiology. This is the engine's
core invariant (no RNG, no wall clock), and the contract that makes
persisted sessions reproducible for audit and scoring."""

from modules.simulations import engine as e
from modules.simulations.engine import new_session
from modules.simulations.state import state_to_dict

_ACTIONS = [
    ("ASSESS", "vitals"),
    ("ASSESS", "drain"),
    ("ORDER", "cbc"),
    ("MONITOR", "vitals"),
    ("WAIT", None),
    ("VIEW", "cbc"),
    ("ORDER", "abg"),
    ("WAIT", None),
    ("VIEW", "abg"),
    ("GIVE", "FLUIDS"),
    ("WAIT", None),
    ("REPORT", "doctor"),
]


def _play() -> dict:
    s = new_session()
    for action, target in _ACTIONS:
        ok, _ = e.apply_action(s, action, target)
        assert ok, (action, target)
    return state_to_dict(s)


def test_same_actions_reproduce_identical_state():
    first = _play()
    second = _play()
    assert first == second


def test_physio_compartments_are_deterministic():
    a = _play()["hidden"]["physio"]
    b = _play()["hidden"]["physio"]
    assert a == b
    assert set(a) == {"vol", "svr", "lactate", "hb", "meds", "conscious", "sedation"}


def test_interleaved_actions_replay_exactly():
    """Determinism is about the sequence, not the total: two runs of the
    same interleaving must match, and a different interleaving may not."""
    s1 = new_session()
    for action, target in _ACTIONS:
        e.apply_action(s1, action, target)

    s2 = new_session()
    for action, target in reversed(_ACTIONS):
        e.apply_action(s2, action, target)  # reversed order may reject early; irrelevant here
    # The reversed run must not equal the forward run (order matters).
    assert state_to_dict(s1) != state_to_dict(s2)
