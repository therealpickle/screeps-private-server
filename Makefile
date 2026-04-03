# Created with Claude Code (claude.ai/code)

-include .env
export

.PHONY: build start stop restart status rebuild update init-map purge-cache logs cli listusers set-user-pass set-tick-rate staging-setup teardown staging-wipe headless-user deleteuser spawn-user _verify_user test-picklenet

# Full setup from a fresh clone: creates .env if missing, builds image, starts server, initializes database and map
build: _verify_user
	@if [ ! -f .env ]; then \
		cp .env.sample .env; \
		echo ""; \
		echo "Created .env from .env.sample."; \
		echo "Fill in your Steam API key, then re-run: make build"; \
		echo "  https://steamcommunity.com/dev/apikey"; \
		echo ""; \
		exit 1; \
	fi
	@if [ -z "$(STEAM_KEY)" ]; then \
		echo "Error: STEAM_KEY is not set in .env"; \
		echo "  Get your key at https://steamcommunity.com/dev/apikey"; \
		exit 1; \
	fi
	$(MAKE) start
	@echo "Waiting for server CLI to be ready..."
	@until echo 'true' | docker compose exec -T screeps cli > /dev/null 2>&1; do sleep 2; done
	$(MAKE) init-map
	@echo ""
	@echo "=== Server ready at http://localhost:21025 ==="

# Start the server in the background (always builds the custom image first)
start:
	docker compose build
	docker compose up -d

# Stop the server without removing containers
stop:
	docker compose stop

# Restart all containers
restart:
	docker compose restart

# Show container status
status:
	docker compose ps

# Pull latest code and rebuild
update:
	git pull
	$(MAKE) rebuild

# Initialize the database and import a fresh map
INIT_MAP_KEY ?= random_1x1
init-map:
	@echo 'system.resetAllData()' | docker compose exec -T screeps cli
	@echo "Waiting for server to recover after reset..."
	@sleep 3
	@until echo 'true' | docker compose exec -T screeps cli > /dev/null 2>&1; do sleep 2; done
	@echo 'utils.importMap("$(INIT_MAP_KEY)")' | docker compose exec -T screeps cli
	@sleep 3
	@echo 'system.resumeSimulation()' | docker compose exec -T screeps cli
	@echo "Restarting screeps to reload map data..."
	docker compose restart screeps
	@until echo 'true' | docker compose exec -T screeps cli > /dev/null 2>&1; do sleep 2; done

# Pull latest base images, rebuild custom image, and restart; also purges CDN cache if configured
rebuild:
	docker compose down
	docker compose pull --ignore-buildable
	docker compose build --no-cache
	docker compose up -d
	$(MAKE) purge-cache

# This purges the production server cache. Will only run if CF_ZONE_ID and CF_API_TOKEN
# are defined in the .env file
purge-cache:
	@if [ -n "$(CF_ZONE_ID)" ]; then \
		echo "Purging Cloudflare cache..."; \
		curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$(CF_ZONE_ID)/purge_cache" \
		  -H "Authorization: Bearer $(CF_API_TOKEN)" \
		  -H "Content-Type: application/json" \
		  --data '{"files":["https://screeps.therealpickle.net/visualizer/visualizer.css"]}' \
		  | grep -o '"success":[a-z]*'; \
	fi

# Tail the screeps container logs
logs:
	docker compose logs screeps -f

# Open an interactive CLI session on the running server
cli:
	docker compose exec screeps cli

# Reload config.yml without restarting the server
reload:
	echo 'utils.reloadConfig()' | docker compose exec -T screeps cli

# Run screepsmod-picklenet unit tests
test-picklenet:
	npm test --prefix screepsmod-picklenet

# Set tick duration temporarily (not persistent): make set-tick-rate MS=500
set-tick-rate:
	@test -n "$(MS)" || (echo "Usage: make set-tick-rate MS=<milliseconds>"; exit 1)
	echo 'system.setTickDuration($(MS))' | docker compose exec -T screeps cli

# List all users in the database
listusers:
	echo 'storage.db.users.find({})' | docker compose exec -T screeps cli

# Set a user's password: make set-user-pass USER=username PASS=password
# The user must already exist (created when they first log in via the Steam client).
set-user-pass:
	@test -n "$(USER)" || (echo "Usage: make set-user-pass USER=username PASS=password"; exit 1)
	@test -n "$(PASS)" || (echo "Usage: make set-user-pass USER=username PASS=password"; exit 1)
	echo 'setPassword("$(USER)", "$(PASS)")' | docker compose exec -T screeps cli

# Create a non-Steam user with a password: make headless-user USER=username PASS=password
# Note: users created this way cannot log in via the Steam client — password auth only.
headless-user:
	@test -n "$(USER)" || (echo "Usage: make headless-user USER=username PASS=password"; exit 1)
	@test -n "$(PASS)" || (echo "Usage: make headless-user USER=username PASS=password"; exit 1)
	@USER_LOWER="$$(echo '$(USER)' | tr '[:upper:]' '[:lower:]')"; \
	printf 'try { storage.db.users.insert({username:"%s",usernameLower:"%s",cpu:100,gcl:0,active:true,cpuAvailable:10000,registeredDate:new Date().toISOString(),blocked:false,authTouched:true}) } catch(e) {}\n' "$(USER)" "$$USER_LOWER" \
	  | docker compose exec -T screeps cli
	echo 'setPassword("$(USER)", "$(PASS)")' | docker compose exec -T screeps cli
	@printf 'storage.db.users.findOne({username:"%s"}).then(function(u){ return storage.db["users.code"].findOne({user:u._id}).then(function(c){ if(!c) return storage.db["users.code"].insert({user:u._id,branch:"default",modules:{main:""},activeWorld:true,activeSim:false}); }); })\n' "$(USER)" \
	  | docker compose exec -T screeps cli

# Delete a user and their code: make deleteuser USER=username
deleteuser:
	@test -n "$(USER)" || (echo "Usage: make deleteuser USER=username"; exit 1)
	@printf 'storage.db.users.findOne({username:"%s"}).then(function(u){ if(!u){print("User not found");return;} return storage.db["users.code"].remove({user:u._id}).then(function(){ return storage.db.users.remove({_id:u._id}); }).then(function(){ print("Deleted user: %s"); }); })\n' "$(USER)" "$(USER)" \
	  | docker compose exec -T screeps cli

# Manually spawn a user: make spawn-user USER=username
spawn-user:
	@test -n "$(USER)" || (echo "Usage: make spawn-user USER=username"; exit 1)
	@printf 'var USERNAME="%s";\n' "$(USER)" | cat - scripts/spawn-user.js \
	  | docker compose exec -T screeps cli

################################################################################
# Staging and testing setup
################################################################################

STAGING_USER ?= testuser
STAGING_PASS ?= testpass
STAGING_HOST ?= localhost

# Make sure your user can use docker
 _verify_user:
	@if ! groups | grep -q '\bdocker\b'; then \
		echo "Error: $$(whoami) is not in the docker group."; \
		echo "Fix it by running:"; \
		echo "  sudo usermod -aG docker $$(whoami)"; \
		echo "  newgrp docker"; \
		echo "Then re-run: make $@"; \
		exit 1; \
	fi

# Initializes the server, and sets up the map
staging-setup: _verify_user start
	@echo "Waiting for server to be ready..."
	@until bash -c 'echo >/dev/tcp/localhost/21025' 2>/dev/null; do sleep 2; done
	@echo 'system.resetAllData()' | docker compose exec -T screeps cli
	@echo 'utils.importMap("https://maps.screepspl.us/maps/random")' | docker compose exec -T screeps cli
	@echo 'system.resumeSimulation()' | docker compose exec -T screeps cli
	@echo ""
	@echo "=== Staging server ready ==="
	@echo ""
	@echo "To push code to the test user, add to your project's .screeps.yml:"
	@echo ""
	@printf 'servers:\n  staging:\n    host: $(STAGING_HOST)\n    port: 21025\n    http: true\n    username: $(STAGING_USER)\n    password: $(STAGING_PASS)\n    branch: default\n'
	@echo ""
	@echo "Deploy with: make staging-deploy  (from player_starter_pack/, or from your project.)"

# Stops the server and removes containers, volumes, and images
teardown:
	@test "$(NUKE)" = "yes" || (echo "Safety check: run as 'make teardown NUKE=yes'"; exit 1)
	docker compose down --volumes --rmi all

# Wipe all data volumes and remove the containers
# Requires WIPE=yes to prevent accidental data loss: make staging-wipe WIPE=yes
staging-wipe:
	@test "$(WIPE)" = "yes" || (echo "Safety check: run as 'make staging-wipe WIPE=yes'"; exit 1)
	docker compose down -v

# Created with Claude Code (claude.ai/code)

# Created with Claude Code (claude.ai/code)
