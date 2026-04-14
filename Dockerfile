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
COPY package*.json ./
# prefer npm ci, but fall back to npm install for environments without a lockfile (works with BuildKit/Portainer)
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
RUN mkdir -p storage storage/originals storage/outputs storage/tmp

EXPOSE 3000
CMD ["node", "server.js"]
