# Backend image (alternative to local dev - see root README "Docker (alternative)"). Runs the same code, same npm
# scripts (db:migrate, db:seed:reference, db:seed:dev) that local dev uses; only the MongoDB host/credentials differ,
# supplied by docker-compose.yml. This image is also reused, unmodified, for the one-off migrate/seed step.
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
# pino-pretty is a devDependency, but src/utils/logger.js loads it for every APP_ENV other than "production" -
# and compose's own backend/seed-dev services run this image with APP_ENV=development by default. Install it
# explicitly rather than keeping all of --omit=dev's other test/lint tooling out of the image.
RUN npm ci --omit=dev && npm install --no-save pino-pretty@^13.1.3

COPY . .

ENV APP_ENV=production
ENV APP_PORT=8000
EXPOSE 8000

CMD ["node", "src/server.js"]
