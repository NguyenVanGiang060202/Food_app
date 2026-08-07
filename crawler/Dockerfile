FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY crawler/package.json crawler/package.json
RUN npm ci
COPY crawler crawler
RUN npm run build --workspace crawler

# Playwright ships usable browsers in this image; ensure system deps are present.
RUN npx playwright install --with-deps chromium

ENV NODE_ENV=production
# One-shot batch crawl by default; override with a different dist/cli script.
ENTRYPOINT ["node", "crawler/dist/cli/playwright-batch-crawl.js"]