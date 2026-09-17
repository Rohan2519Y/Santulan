FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN npx prisma generate --schema prisma/schema.prisma

EXPOSE 8000

CMD ["node", "src/server.js"]
