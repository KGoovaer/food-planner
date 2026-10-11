FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY web ./web
RUN mkdir -p /data && chown node:node /data
USER node
ENV PORT=8080 DATA_DIR=/data TZ=Europe/Brussels
EXPOSE 8080
VOLUME /data
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.ts"]
