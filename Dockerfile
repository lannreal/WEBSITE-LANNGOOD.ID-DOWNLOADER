FROM node:20-slim

RUN apt-get update && apt-get install -y \
  python3 \
  python3-pip \
  ffmpeg \
  curl \
  --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# Install yt-dlp versi terbaru
RUN pip3 install -U yt-dlp --break-system-packages

# Verifikasi
RUN yt-dlp --version && ffmpeg -version | head -1

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]