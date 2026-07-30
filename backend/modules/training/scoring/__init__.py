"""Training scoring subsystem.

Entry points:
- ``engine.evaluate_training``: LLM scoring execution.
- ``lifecycle``: scoring locks and state transitions.
- ``prompt_builder``: rubric -> prompt/schema text.
- ``rubric``: final rubric composition.
- ``rubric_loader`` / ``rubric_data``: bundled nursing history rubric.
- ``validation``: result shape and semantic checks.

Keep imports explicit at call sites. Package-level eager imports create circular
dependencies with the training profile during app startup.
"""
