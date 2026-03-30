# Created with Claude Code (claude.ai/code)

FROM ghcr.io/jomik/screeps-server:edge

USER root
RUN apt-get update && apt-get install -y --no-install-recommends gettext-base \
    && rm -rf /var/lib/apt/lists/*
COPY server/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
COPY --chown=node:node screepsmod-visualizer/ /screepsmod-visualizer/
COPY --chown=node:node screepsmod-picklenet/ /screepsmod-picklenet/

USER node
ENTRYPOINT ["/entrypoint.sh"]
CMD ["start"]

# Created with Claude Code (claude.ai/code)
