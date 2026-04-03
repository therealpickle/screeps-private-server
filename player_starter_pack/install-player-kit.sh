#!/bin/sh
# Downloads the Screeps player starter kit into the current directory.
#
# Fresh install (creates missing files, updates tooling):
#   curl -fsSL https://raw.githubusercontent.com/therealpickle/screeps-private-server/main/player_starter_pack/install-player-kit.sh | bash
#
# Update tooling only (from an existing kit via make):
#   make update-kit
#
# Update tooling from a local server repo checkout:
#   bash /path/to/screeps-private-server/player_starter_pack/install-player-kit.sh --local /path/to/screeps-private-server
#   (or via: make update-kit-local  — requires SERVER_REPO_PATH in .env)

set -e

# --- Parse arguments ---
BRANCH="main"
while [ $# -gt 0 ]; do
    case "$1" in
        --branch) BRANCH="$2"; shift 2 ;;
        --local)  LOCAL_PATH="$2"; shift 2 ;;
        *) shift ;;
    esac
done

# --- Local mode: copy from a local repo checkout instead of downloading ---
if [ -n "$LOCAL_PATH" ]; then
    if [ -z "$LOCAL_PATH" ]; then
        echo "Usage: install-player-kit.sh --local <server-repo-path>" >&2
        exit 1
    fi
    KIT="$LOCAL_PATH/player_starter_pack"

    copy_local() {
        src="$1" dst="$2" force="$3"
        if [ "$force" = "1" ] || [ ! -f "$dst" ]; then
            mkdir -p "$(dirname "$dst")"
            cp "$KIT/$src" "$dst"
            if [ "$force" = "1" ]; then
                printf '  updated  %s\n' "$dst"
            else
                printf '  created  %s\n' "$dst"
            fi
        else
            printf '  skipped  %s  (already exists, ok)\n' "$dst"
        fi
    }

    merge_local() {
        src="$1" dst="$2"
        if [ ! -f "$dst" ]; then
            mkdir -p "$(dirname "$dst")"
            cp "$KIT/$src" "$dst"
            printf '  created  %s\n' "$dst"
        else
            added=0
            while IFS= read -r line; do
                if [ -n "$line" ] && ! grep -qxF "$line" "$dst"; then
                    printf '%s\n' "$line" >> "$dst"
                    added=$((added + 1))
                fi
            done < "$KIT/$src"
            printf '  merged   %s  (%d lines added)\n' "$dst" "$added"
        fi
    }

    echo "Screeps player kit installer (local)"
    echo "====================================="

    copy_local "Makefile.kit"                                 "Makefile.kit"                                1
    copy_local "CLAUDE.kit.md"                               "CLAUDE.kit.md"                               1
    copy_local ".claude/skills/game-state/SKILL.md"         ".claude/skills/game-state/SKILL.md"          1
    copy_local ".mcp.json"                                   ".mcp.json"                                   1
    copy_local ".claude/mcp-launcher.sh"                     ".claude/mcp-launcher.sh"                     1
    copy_local "install-player-kit.sh"                       "install-player-kit.sh"                       1
    chmod +x ".claude/mcp-launcher.sh" "install-player-kit.sh"

    copy_local "Makefile"                               "Makefile"                                0
    copy_local "CLAUDE.md"                              "CLAUDE.md"                               0
    copy_local "package.json"                           "package.json"                            0
    merge_local ".gitignore"                             ".gitignore"
    copy_local "default/main.js"                        "default/main.js"                         0

    echo ""
    echo "Done."
    exit 0
fi

# --- Remote mode: download from GitHub ---

BASE="https://raw.githubusercontent.com/therealpickle/screeps-private-server/$BRANCH/player_starter_pack"

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
        printf '  skipped  %s  (already exists, ok)\n' "$dst"
    fi
}

# Merge a file line-by-line: create if missing, otherwise append only new lines.
merge_download() {
    src="$1" dst="$2"
    tmpfile=$(mktemp)
    if curl -fsSL "$BASE/$src" -o "$tmpfile"; then
        if [ ! -f "$dst" ]; then
            mkdir -p "$(dirname "$dst")"
            mv "$tmpfile" "$dst"
            printf '  created  %s\n' "$dst"
        else
            added=0
            while IFS= read -r line; do
                if [ -n "$line" ] && ! grep -qxF "$line" "$dst"; then
                    printf '%s\n' "$line" >> "$dst"
                    added=$((added + 1))
                fi
            done < "$tmpfile"
            rm -f "$tmpfile"
            printf '  merged   %s  (%d lines added)\n' "$dst" "$added"
        fi
    else
        printf '  FAILED   %s\n' "$dst" >&2
        rm -f "$tmpfile"
        return 1
    fi
}

echo "Screeps player kit installer"
echo "============================"

# Tooling — always update so the server admin can push improvements
download "Makefile.kit"                                 "Makefile.kit"                                1
download "CLAUDE.kit.md"                               "CLAUDE.kit.md"                               1
download ".claude/skills/game-state/SKILL.md"          ".claude/skills/game-state/SKILL.md"          1
download ".mcp.json"                                   ".mcp.json"                                   1
download ".claude/mcp-launcher.sh"                     ".claude/mcp-launcher.sh"                     1
download "install-player-kit.sh"                       "install-player-kit.sh"                       1
chmod +x ".claude/mcp-launcher.sh" "install-player-kit.sh"

# Player files — create only; players own these after first install
download "Makefile"                               "Makefile"                                0
download "CLAUDE.md"                              "CLAUDE.md"                               0
download "package.json"                           "package.json"                            0
merge_download ".gitignore"                       ".gitignore"
download "default/main.js"                        "default/main.js"                         0

echo ""
echo "Done."
if [ ! -f ".screeps.yml" ]; then
    echo ""
    echo "Next steps:"
    echo "  make install           # install npm dependencies"
    echo "  make init-screeps-yml  # generate .screeps.yml (fill in server details)"
fi
# Created with Claude Code (claude.ai/code)
