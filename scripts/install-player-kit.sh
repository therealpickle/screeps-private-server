#!/bin/sh
# Downloads the Screeps player starter kit into the current directory.
#
# Fresh install (creates missing files, updates tooling):
#   curl -fsSL https://raw.githubusercontent.com/therealpickle/screeps-private-server/main/scripts/install-player-kit.sh | bash
#
# Update tooling only (from an existing kit via make):
#   make update-kit

set -e

BASE="https://raw.githubusercontent.com/therealpickle/screeps-private-server/main/player_starter_pack"

# Download a file from the kit.
# force=1  -> always overwrite (tooling)
# force=0  -> skip if the file already exists (user files)
download() {
    src="$1" dst="$2" force="$3"
    if [ "$force" = "1" ] || [ ! -f "$dst" ]; then
        mkdir -p "$(dirname "$dst")"
        if curl -fsSL "$BASE/$src" -o "$dst"; then
            if [ "$force" = "1" ]; then
                printf '  updated  %s\n' "$dst"
            else
                printf '  created  %s\n' "$dst"
            fi
        else
            printf '  FAILED   %s\n' "$dst" >&2
            return 1
        fi
    else
        printf '  skipped  %s  (already exists)\n' "$dst"
    fi
}

echo "Screeps player kit installer"
echo "============================"

# Tooling — always update so the server admin can push improvements
download "Makefile.kit"                            "Makefile.kit"                           1
download "CLAUDE.kit.md"                           "CLAUDE.kit.md"                          1
download ".claude/skills/game-state/SKILL.md"     ".claude/skills/game-state/SKILL.md"     1

# Player files — create only; players own these after first install
download "Makefile"                               "Makefile"                                0
download "CLAUDE.md"                              "CLAUDE.md"                               0
download "package.json"                           "package.json"                            0
download ".gitignore"                             ".gitignore"                              0
download "default/main.js"                        "default/main.js"                         0

echo ""
echo "Done."
if [ ! -f ".screeps.yml" ]; then
    echo ""
    echo "Next steps:"
    echo "  make install           # install npm dependencies"
    echo "  make init-screeps-yml  # generate .screeps.yml (fill in server details)"
fi
