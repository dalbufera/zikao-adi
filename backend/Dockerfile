FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

RUN mkdir -p /opt/zikao/data /opt/zikao/voices /opt/zikao/frontend

EXPOSE 3100

CMD ["node", "server.js"]
