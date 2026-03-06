FROM node:20-slim

# Install python3, pip, ffmpeg
RUN apt-get update && apt-get install -y \
  python3 \
  python3-pip \
  ffmpeg \
  curl \
  --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# Install yt-dlp via pip
RUN pip3 install yt-dlp --break-system-packages

# Verify installs
RUN yt-dlp --version && ffmpeg -version | head -1

WORKDIR /app

# Copy package files and install node deps
COPY package*.json ./
RUN npm install --production

# Copy semua file project
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]