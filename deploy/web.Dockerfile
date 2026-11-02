FROM node:20-alpine AS build
WORKDIR /app
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build
FROM alpine:3
WORKDIR /out
COPY --from=build /app/dist ./dist
CMD ["sh", "-c", "cp -r /out/dist/* /srv/ && echo done && sleep infinity"]
