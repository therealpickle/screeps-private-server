FROM ghcr.io/jomik/screeps-server:edge

USER root
RUN apt-get update && apt-get install -y --no-install-recommends gettext-base \
    && rm -rf /var/lib/apt/lists/*
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
COPY --chown=node:node screepsmod-visualizer/ /screepsmod-visualizer/

USER node
ENTRYPOINT ["/entrypoint.sh"]
CMD ["start"]
