# Frontend image (alternative to local dev - see root README "Docker (alternative)"). Multi-stage: build the static
# CRA bundle with Node, then serve it with nginx. REACT_APP_API_BASE is a BUILD-time value (CRA bakes env vars into
# the bundle), so it must be supplied as a build arg, not a runtime env var - docker-compose.yml sets it.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
# package-lock.json is already out of sync with package.json in the repo (npm ci refuses: missing yaml@2.9.1) -
# npm install tolerates that instead of requiring a lock-file regeneration as part of the Docker build.
RUN npm install
COPY . .
# No default API address (G-45): a build that forgets it must fail, not ship a bundle pointing at localhost.
ARG REACT_APP_API_BASE
ENV REACT_APP_API_BASE=$REACT_APP_API_BASE
# Source maps would publish the readable source of the app with the bundle.
ENV GENERATE_SOURCEMAP=false
RUN test -n "$REACT_APP_API_BASE" || (echo "REACT_APP_API_BASE build arg is required" && exit 1)
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
