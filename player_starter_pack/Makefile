# Created with Claude Code (claude.ai/code)

.PHONY: install init-screeps-yml update-kit deploy-%

init-screeps-yml:
	@printf 'servers:\n  private:\n    host: <SERVER_ADDRESS>\n    port: 21025\n    http: true\n    username: <USERNAME>\n    password: <PASSWORD>\n    branch: default\n' > .screeps.yml
	@echo "Created .screeps.yml — fill in <SERVER_ADDRESS>, <USERNAME>, and <PASSWORD>"

install:
	npm install

update-kit:
	curl -fsSL https://raw.githubusercontent.com/therealpickle/screeps-private-server/main/scripts/install-player-kit.sh | bash

deploy-%:
	npx screeps-api upload --server $* default/*.js

# Created with Claude Code (claude.ai/code)

# Created with Claude Code (claude.ai/code)
