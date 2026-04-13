FROM node:18-bullseye

# Install system deps for image processing
RUN apt-get update && apt-get install -y --no-install-recommends \
  build-essential \
  ffmpeg \
  gifsicle \
  zip \
  libvips-dev \
  libheif-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p storage storage/originals storage/outputs storage/tmp

EXPOSE 3000
CMD ["node", "server.js"]
