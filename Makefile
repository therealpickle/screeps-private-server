-include .env
export

.PHONY: start stop restart rebuild purge-cache logs cli

start:
	docker compose up -d

stop:
	docker compose stop

restart:
	docker compose restart

rebuild:
	docker compose down
	docker compose pull
	docker compose build
	docker compose up -d
	$(MAKE) purge-cache

purge-cache:
	@echo "Purging Cloudflare cache..."
	@curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$(CF_ZONE_ID)/purge_cache" \
	  -H "Authorization: Bearer $(CF_API_TOKEN)" \
	  -H "Content-Type: application/json" \
	  --data '{"files":["https://screeps.therealpickle.net/visualizer/visualizer.css"]}' \
	  | grep -o '"success":[a-z]*'

logs:
	docker compose logs screeps -f

cli:
	docker compose exec screeps cli

reload:
	echo 'utils.reloadConfig()' | docker compose exec -T screeps cli

dev-setup:
	@test -f docker-compose.override.yml \
		&& echo "docker-compose.override.yml already exists" \
		|| (cp docker-compose.override.yml.example docker-compose.override.yml && echo "Created docker-compose.override.yml — run: make rebuild")

adduser:
	@test -n "$(USER)" || (echo "Usage: make adduser USER=username PASS=password"; exit 1)
	@test -n "$(PASS)" || (echo "Usage: make adduser USER=username PASS=password"; exit 1)
	echo 'setPassword("$(USER)", "$(PASS)")' | docker compose exec -T screeps cli
