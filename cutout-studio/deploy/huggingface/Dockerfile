# Hugging Face Space for Cut-Out Studio (free CPU Space: 2 vCPU, 16 GB RAM).
# The Space only needs this file and README.md: it pulls the app from GitHub when it builds.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ARG REPO=https://github.com/abdoelhafi/abdoelhafi.git
ARG BRANCH=ccr-18ed63bb-3wocck
RUN git clone --depth 1 -b "$BRANCH" "$REPO" /src && mv /src/cutout-studio /app && rm -rf /src

WORKDIR /app
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --omit=dev

# Spaces run the container as user 1000: make the data folder writable.
ENV NODE_ENV=production PORT=7860 DATA_DIR=/data PYTHON=python3 HOME=/tmp
RUN mkdir -p /data && chmod -R 777 /data /app
EXPOSE 7860
CMD ["node", "server/index.js"]
