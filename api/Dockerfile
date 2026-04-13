FROM node:20-alpine

WORKDIR /usr/src/app

RUN apk add --no-cache git build-base vips-dev fftw-dev libpng-dev libjpeg-turbo-dev libwebp-dev

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000
CMD ["node", "src/index.js"]
