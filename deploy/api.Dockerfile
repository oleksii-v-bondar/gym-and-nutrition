FROM node:20-alpine AS build
WORKDIR /app
COPY api/package*.json ./
RUN npm ci
COPY api/ ./
RUN npm run build
FROM node:20-alpine
WORKDIR /app
COPY api/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY db/ ./db/
EXPOSE 3000
CMD ["node", "dist/server.js"]
