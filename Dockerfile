# Statistical Football: the app and its game server in one container.
# Container Manager on the NAS builds it from this folder (see NAS.md); nothing to install on the laptop.

# ---- Stage 1: build the app (Angular) and the game server (one bundled file) ----
FROM node:24-alpine AS build
ENV NG_CLI_ANALYTICS=false
WORKDIR /src
# The packages first: Docker keeps this step cached until package-lock.json changes.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx ng build \
 && npx esbuild server/main.ts --bundle --platform=node --format=esm --outfile=dist-server/main.mjs --log-level=warning

# ---- Stage 2: what runs. Only the built files: no packages, no build tools, not as root ----
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    APP_DIR=/app/dist/spf/browser
WORKDIR /app
COPY --from=build /src/dist-server/main.mjs ./dist-server/main.mjs
COPY --from=build /src/dist/spf/browser ./dist/spf/browser
COPY --from=build /src/public/cards ./public/cards
# Sessions and the sign-in log live here (a Docker volume, see docker-compose.yml), owned by the "node" user.
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
VOLUME /app/data
# Container Manager shows "healthy" while the sign-in page answers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD wget -q -O /dev/null http://127.0.0.1:3000/auth/signin || exit 1
CMD ["node", "dist-server/main.mjs"]
