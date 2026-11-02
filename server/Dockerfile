FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

COPY server ./server
RUN npm --workspace server run db:generate

EXPOSE 4000

CMD ["sh", "-c", "npm --workspace server run db:deploy && npm --workspace server run db:seed && npm --workspace server run start"]
