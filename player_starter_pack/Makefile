.PHONY: install init-screeps-yml deploy-%

init-screeps-yml:
	@printf 'servers:\n  private:\n    host: <SERVER_ADDRESS>\n    port: 21025\n    http: true\n    username: <USERNAME>\n    password: <PASSWORD>\n    branch: default\n' > .screeps.yml
	@echo "Created .screeps.yml — fill in <SERVER_ADDRESS>, <USERNAME>, and <PASSWORD>"

install:
	npm install

deploy-%:
	npx screeps-api upload --server $* default/*.js
