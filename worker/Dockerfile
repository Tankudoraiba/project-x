FROM node:20-alpine

WORKDIR /usr/src/app

RUN apk add --no-cache vips-dev fftw-dev libpng-dev libjpeg-turbo-dev libwebp-dev ffmpeg zip unzip

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "src/worker.js"]
