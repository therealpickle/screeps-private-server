SERVER_NAME ?= private

.PHONY: install configure deploy deploy-local

configure:
	node utils.js configure --address=$(SERVER_ADDRESS) --username=$(USERNAME) --password=$(PASSWORD) --name=$(SERVER_NAME)

install:
	npm install

deploy:
	npx screeps-api upload --server private default/*.js

deploy-local:
	npx screeps-api upload --server local default/*.js
