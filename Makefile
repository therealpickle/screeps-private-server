-include .env
export

.PHONY: start stop restart rebuild update staging-wipe init-map purge-cache logs cli listusers adduser setup-staging teardown-staging _verify_user

# Start the server in the background
start:
	docker compose up -d

# Stop the server without removing containers
stop:
	docker compose stop

# Restart all containers
restart:
	docker compose restart

# Pull latest code and rebuild
update:
	git pull
	$(MAKE) rebuild

# Initialize the database and import a fresh map
INIT_MAP_KEY ?= random_1x1
init-map:
	@echo 'utils.importMap("$(INIT_MAP_KEY)")' | docker compose exec -T screeps cli
	@echo 'system.resumeSimulation()' | docker compose exec -T screeps cli

# Pull latest images, rebuild, and restart; also purges CDN cache if configured
rebuild:
	docker compose down
	docker compose pull
	docker compose build
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

# List all users in the database
listusers:
	echo 'storage.db.users.find({})' | docker compose exec -T screeps cli

# Create or update a user's password: make adduser USER=username PASS=password
# Creates the user if they don't already exist, then sets the password.
adduser:
	@test -n "$(USER)" || (echo "Usage: make adduser USER=username PASS=password"; exit 1)
	@test -n "$(PASS)" || (echo "Usage: make adduser USER=username PASS=password"; exit 1)
	@USER_LOWER="$$(echo '$(USER)' | tr '[:upper:]' '[:lower:]')"; \
	printf 'try { storage.db.users.insert({username:"%s",usernameLower:"%s",cpu:100,gcl:0,active:true,cpuAvailable:10000,registeredDate:new Date().toISOString(),blocked:false,authTouched:true}) } catch(e) {}\n' "$(USER)" "$$USER_LOWER" \
	  | docker compose exec -T screeps cli
	echo 'setPassword("$(USER)", "$(PASS)")' | docker compose exec -T screeps cli

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
setup-staging: _verify_user start
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
	@echo "Deploy with: make deploy-staging  (from player_starter_pack/, or from your project.)"

# Stops the server and removes containers, volumes, and images
teardown-staging:
	@test "$(NUKE)" = "yes" || (echo "Safety check: run as 'make teardown-staging NUKE=yes'"; exit 1)
	docker compose down --volumes --rmi all

# Wipe all data volumes and remove the containers
# Requires WIPE=yes to prevent accidental data loss: make staging-wipe WIPE=yes
wipe-staging:
	@test "$(WIPE)" = "yes" || (echo "Safety check: run as 'make staging-wipe WIPE=yes'"; exit 1)
	docker compose down -v
