SERVER_NAME ?= private

.PHONY: install configure deploy deploy-local

configure:
	@test -n "$(SERVER_ADDRESS)" || (echo "Usage: make configure SERVER_ADDRESS=<addr> USERNAME=<user> PASSWORD=<pass> [SERVER_NAME=private]"; exit 1)
	@test -n "$(USERNAME)"       || (echo "Usage: make configure SERVER_ADDRESS=<addr> USERNAME=<user> PASSWORD=<pass> [SERVER_NAME=private]"; exit 1)
	@test -n "$(PASSWORD)"       || (echo "Usage: make configure SERVER_ADDRESS=<addr> USERNAME=<user> PASSWORD=<pass> [SERVER_NAME=private]"; exit 1)
	@printf 'servers:\n  $(SERVER_NAME):\n    host: $(SERVER_ADDRESS)\n    port: 21025\n    http: true\n    username: $(USERNAME)\n    password: $(PASSWORD)\n    branch: default\n' > .screeps.yml
	@echo "Wrote .screeps.yml for server '$(SERVER_NAME)'"

install:
	npm install

deploy:
	npx screeps-api upload --server private default/*.js

deploy-local:
	npx screeps-api upload --server local default/*.js
