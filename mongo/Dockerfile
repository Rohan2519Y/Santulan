# A single-node MongoDB replica set (needed for transactions, same as backend/scripts/mongo-local.js sets up for local
# dev) with a generated keyfile and least-privilege users. All the actual bootstrap logic is in entrypoint.sh +
# bootstrap.js (this same folder), not here - this file only stages them into the official image.
FROM mongo:8

COPY entrypoint.sh /usr/local/bin/santulan-entrypoint.sh
COPY bootstrap.js /docker-init/bootstrap.js
RUN chmod +x /usr/local/bin/santulan-entrypoint.sh

ENTRYPOINT ["santulan-entrypoint.sh"]
