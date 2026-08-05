# WiFi-Sim as a container. Build once, serve the static bundle with nginx.
#
# The app has no server side at all: everything is computed in the browser and
# nothing leaves the machine. The container exists only so you do not need Node
# or a toolchain to run it, and so it keeps working offline once pulled.
#
#   docker build -t wifi-sim .
#   docker run --rm -p 8080:8080 wifi-sim
#
# Then open http://localhost:8080

FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first, so a source-only change does not reinstall them.
# The image's bundled npm is a major behind the one the lock file was resolved
# with, and the two disagree about a conflicting optional peer dependency deep
# in the VitePress tree, so it is pinned to keep "npm ci" reproducible.
COPY package.json package-lock.json ./
RUN npm install -g npm@11 && npm ci

COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS serve
LABEL org.opencontainers.image.title="WiFi-Sim"
LABEL org.opencontainers.image.description="Physically-based indoor Wi-Fi planning suite"
LABEL org.opencontainers.image.licenses="GPL-3.0-or-later"
LABEL org.opencontainers.image.source="https://github.com/ProfessorQuantumUniverse/wifi-sim"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
