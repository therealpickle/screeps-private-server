SERVER_NAME ?= private

.PHONY: install configure deploy deploy-%

configure:
	node utils.js configure --address=$(SERVER_ADDRESS) --username=$(USERNAME) --password=$(PASSWORD) --name=$(SERVER_NAME)

install:
	npm install

deploy:
	npx screeps-api upload --server $(SERVER_NAME) default/*.js

deploy-%:
	npx screeps-api upload --server $* default/*.js
