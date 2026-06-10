#!/bin/bash
set -e
cd /opt/nursing-vp-sim

echo '=== 1. Stop production ==='
IMAGE_VERSION=2026.06.02-2 docker compose -f docker-compose.yml --env-file .env down 2>/dev/null || true

echo '=== 2. Destroy old DB volume ==='
docker volume rm ai_vp_pg_data 2>/dev/null || true

echo '=== 3. Update DB image ==='
sed -i 's|image:.*|image: postgres:15|' docker-compose.yml 2>/dev/null || true

echo '=== 4. Start fresh DB ==='
IMAGE_VERSION=2026.06.10-2 docker compose -f docker-compose.yml --env-file .env up -d db
for i in $(seq 1 30); do
  if docker exec nursing-db pg_isready -U nursing -d nursing_vp 2>/dev/null; then
    echo "DB ready"
    break
  fi
  sleep 2
done

echo '=== 5. Pull and start backend (runs migrations) ==='
IMAGE_VERSION=2026.06.10-2 docker compose -f docker-compose.yml --env-file .env pull backend
IMAGE_VERSION=2026.06.10-2 docker compose -f docker-compose.yml --env-file .env up -d backend

echo 'Waiting for backend healthy...'
for i in $(seq 1 60); do
  STATUS=$(docker inspect -f '{{.State.Health.Status}}' nursing-vp-sim-backend-1 2>/dev/null || echo 'starting')
  if [ "$STATUS" = "healthy" ]; then echo "Backend healthy"; break; fi
  if [ "$STATUS" = "unhealthy" ]; then echo "Backend unhealthy - check logs"; docker logs nursing-vp-sim-backend-1 --tail 20; exit 1; fi
  sleep 2
done

echo '=== 6. Restore data ==='
docker cp /tmp/prod_dump.sql nursing-db:/tmp/
docker exec nursing-db psql -U nursing -d nursing_vp -f /tmp/prod_dump.sql

echo '=== 7. Verify ==='
docker exec nursing-db psql -U nursing -d nursing_vp -c "SELECT 'users', count(*) FROM users UNION ALL SELECT 'cases', count(*) FROM cases UNION ALL SELECT 'records', count(*) FROM training_records UNION ALL SELECT 'messages', count(*) FROM messages UNION ALL SELECT 'scores', count(*) FROM scores"

echo '=== 8. Start frontend and cleanup ==='
IMAGE_VERSION=2026.06.10-2 docker compose -f docker-compose.yml --env-file .env up -d frontend
docker image prune -f
echo 'Done!'
