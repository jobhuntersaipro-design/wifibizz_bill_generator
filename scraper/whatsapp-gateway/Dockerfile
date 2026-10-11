FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY convert.mjs server.mjs ./
ENV NODE_ENV=production WA_DATA_DIR=/data
EXPOSE 3000
CMD ["node", "server.mjs"]
