FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV LIVELENS_HOST=0.0.0.0 LIVELENS_PORT=4318 LIVELENS_DB_PATH=/app/data/intelligence.sqlite
EXPOSE 4318
CMD ["node", "src/server.mjs"]
