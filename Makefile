.PHONY: start stop restart rebuild logs cli

start:
	docker compose up -d

stop:
	docker compose stop

restart:
	docker compose restart

rebuild:
	docker compose down
	docker compose pull
	docker compose up -d

logs:
	docker compose logs screeps -f

cli:
	docker compose exec screeps cli

adduser:
	@test -n "$(USER)" || (echo "Usage: make adduser USER=username PASS=password"; exit 1)
	@test -n "$(PASS)" || (echo "Usage: make adduser USER=username PASS=password"; exit 1)
	docker compose exec screeps cli --command 'auth.setPassword("$(USER)", "$(PASS)")'
