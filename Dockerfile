FROM node:22-slim

WORKDIR /app

# Set production environment defaults for Phase 1
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    ENABLE_PYTHON_AI_SERVICE=false

# Copy root and workspace package manifests for optimized layer caching
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/

# Install only production dependencies
RUN npm ci --omit=dev

# Copy backend application source and frontend static assets
COPY backend/ ./backend/
COPY frontend/public/ ./frontend/public/

# Run under the unprivileged standard node user for container security
USER node

# Expose default Cloud Run container port
EXPOSE 8080

# Start Express server directly
CMD ["node", "backend/server.js"]
