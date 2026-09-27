# Open Ajar production image. Node 24 (matches development; node:sqlite is available without a flag).
FROM node:24-alpine

# No third-party dependencies, so there is nothing to npm install.
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public

# The SQLite database lives on a mounted disk at /data (see render.yaml) so it survives deploys.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    DB_PATH=/data/openajar.db
EXPOSE 4173

# Never seed fictional demo data into production.
ENV SEED_DEMO=0 DEMO_MODE=0

CMD ["node", "server/index.js"]
