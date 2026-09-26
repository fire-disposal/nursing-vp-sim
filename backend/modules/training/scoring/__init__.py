"""Training scoring subsystem.

Entry points:
- ``engine.evaluate_training``: LLM scoring execution.
- ``runner``: scoring execution plumbing — the single enqueue boundary, background
  task body, failure/snapshot recovery, and the stuck-record classifier.
- ``lifecycle``: scoring locks and state transitions.
- ``prompt_builder``: rubric -> prompt/schema text.
- ``rubric``: final rubric composition.
- ``rubric_loader``: bundled nursing history rubric (SSOT = rubric.json).
- ``validation``: result shape and semantic checks.

Keep imports explicit at call sites. Package-level eager imports create circular
dependencies with the training profile during app startup.
"""
