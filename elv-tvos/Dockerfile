FROM node:12-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      git \
      ca-certificates \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --only=production

COPY . ./

CMD [ "npm", "start" ]
