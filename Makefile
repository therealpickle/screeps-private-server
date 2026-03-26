-include .env
export

.PHONY: start stop restart rebuild purge-cache logs cli setup-staging _setup-staging-run

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

STAGING_USER ?= testuser
STAGING_PASS ?= testpass
STAGING_HOST ?= localhost


 _verify_user:
	@if ! groups | grep -q '\bdocker\b'; then \
		echo "Error: $$(whoami) is not in the docker group."; \
		echo "Fix it by running:"; \
		echo "  sudo usermod -aG docker $$(whoami)"; \
		echo "  newgrp docker"; \
		echo "Then re-run: make $@"; \
		exit 1; \
	fi

setup-staging: _verify_user start
	@echo "Waiting for server to be ready..."
	@until bash -c 'echo >/dev/tcp/localhost/21025' 2>/dev/null; do sleep 2; done
	@echo 'system.resetAllData()' | docker compose exec -T screeps cli
	@echo 'utils.importMap("https://maps.screepspl.us/maps/random")' | docker compose exec -T screeps cli
	@echo 'system.resumeSimulation()' | docker compose exec -T screeps cli
	@(printf 'var USERNAME="%s"; var PASSWORD="%s"; ' "$(STAGING_USER)" "$(STAGING_PASS)"; tr '\n' ' ' < scripts/spawn-user.js; printf '\n') | docker compose exec -T screeps cli
	@echo ""
	@echo "=== Staging server ready ==="
	@echo ""
	@echo "To push code to the test user, add to your project's .screeps.yml:"
	@echo ""
	@printf 'servers:\n  staging:\n    host: $(STAGING_HOST)\n    port: 21025\n    http: true\n    username: $(STAGING_USER)\n    password: $(STAGING_PASS)\n    branch: default\n'
	@echo ""
	@echo "Deploy with: make deploy-staging  (from starter/)"
