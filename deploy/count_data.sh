#!/bin/bash
docker exec nursing-db psql -U nursing -d nursing_vp -t -A -c "SELECT 'users', count(*) FROM users" \
  -c "SELECT 'cases', count(*) FROM cases" \
  -c "SELECT 'training_records', count(*) FROM training_records" \
  -c "SELECT 'messages', count(*) FROM messages" \
  -c "SELECT 'scores', count(*) FROM scores" \
  -c "SELECT 'feedbacks', count(*) FROM feedbacks" \
  -c "SELECT 'qa_sessions', count(*) FROM qa_sessions" \
  -c "SELECT 'qa_records', count(*) FROM qa_records" \
  -c "SELECT 'api_secrets', count(*) FROM api_secrets" \
  -c "SELECT 'llm_configs', count(*) FROM llm_configs" \
  -c "SELECT 'llm_call_logs', count(*) FROM llm_call_logs" \
  -c "SELECT 'prompt_templates', count(*) FROM prompt_templates" \
  -c "SELECT 'notes', count(*) FROM notes"
