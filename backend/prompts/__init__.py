"""
System prompts catalog — single source of truth for all LLM prompt templates.

Structure:
  prompts/engine.py        — render_template({#var#}) engine
  prompts/training/        — training pipeline prompts
  prompts/qa.py            — QA tutor prompts
  prompts/generation.py    — case generation prompts

Import from this package or sub-packages directly:
  from prompts.training.scoring import SCORING_SYSTEM
  from prompts.training.patient import PATIENT_SYSTEM
"""

from prompts.engine import render_template, validate_template_vars

__all__ = ["render_template", "validate_template_vars"]
