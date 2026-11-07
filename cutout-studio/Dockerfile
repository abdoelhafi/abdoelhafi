# Cut-Out Studio: Node + Chromium (Playwright) + Python (OpenCV) + ffmpeg in one image.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

COPY package.json package-lock.json ./
# the browsers are already in the base image
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --omit=dev

COPY . .
ENV NODE_ENV=production PORT=10000 DATA_DIR=/data PYTHON=python3
RUN mkdir -p /data
EXPOSE 10000
# create the Rolodex demo project on first start, then run the server
CMD ["sh", "-c", "[ -d /data/projects ] && [ \"$(ls -A /data/projects 2>/dev/null)\" ] || node scripts/seed-demo.js; node server/index.js"]
