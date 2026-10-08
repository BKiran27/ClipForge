FROM oven/bun:latest

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python audio/transcription modules
RUN python3 -m pip install --break-system-packages --upgrade pip && \
    python3 -m pip install --break-system-packages yt-dlp youtube-transcript-api faster-whisper

WORKDIR /app

# Copy dependency manifests
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy project source
COPY . .

# Expose Web Studio port
EXPOSE 3000
ENV PORT=3000

# Start Clips Studio Web Dashboard
CMD ["bun", "run", "serve", "-p", "3000"]
