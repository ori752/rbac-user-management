# Playwright's official image ships Node 20 + Chromium + every system library
# the headless crawl needs. Tag matches the installed playwright (1.61.1) so the
# bundled browser version lines up with `chromium.launch()`.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app

# Install ALL dependencies, including dev:
#   - typescript (tsc) is needed to build the server
#   - ts-node is needed at runtime to run the crawler (scripts/) the /import route spawns
COPY package*.json ./
RUN npm ci --include=dev

# Application source
COPY . .

# Ensure the matching Chromium build is present, then compile the server (src -> dist)
RUN npx playwright install chromium \
 && npm run build

ENV NODE_ENV=production
# Railway injects PORT at runtime; src/index.ts reads process.env.PORT
EXPOSE 3000

CMD ["npm", "start"]
