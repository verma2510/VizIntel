# One image, many roles: the same build runs the API (default CMD) and every Kafka worker
# (override the command, e.g. `node workers/activityConsumer.js`) — see docker-compose.yml.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production \
    LOG_PRETTY=false
WORKDIR /app
# tini = PID 1 that forwards SIGTERM so the API/workers can drain outboxes and leave consumer groups cleanly.
RUN apk add --no-cache tini
COPY --from=deps /app/node_modules ./node_modules
COPY . .
USER node
EXPOSE 5000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "index.js"]
