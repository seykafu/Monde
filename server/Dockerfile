FROM node:22-slim AS build
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY shared/ ./shared/
COPY server/ ./server/
COPY client/package.json ./client/package.json
RUN npm ci --workspace @monde/server --include-workspace-root=true
RUN npm run build -w @monde/server

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA
COPY package*.json ./
COPY shared/package.json ./shared/package.json
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm ci --omit=dev --workspace @monde/server --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/drizzle ./server/drizzle
COPY content/ ./content/
RUN chmod -R a-w /app/content
ENV MONDE_CONTENT_DIR=/app/content
USER node
EXPOSE 8080
CMD ["node", "server/dist/index.js"]
