# Workbench Proxy Sidecar
# Lightweight HTTP proxy with URL allowlist enforcement

FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies (dev only for build)
RUN npm install

# Copy source
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:24-alpine

WORKDIR /app

# Copy built output
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Don't need node_modules in production (no runtime deps)

# Use non-root user
USER node

# Default port
EXPOSE 3128

# Health check
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
  CMD wget -q --spider http://localhost:3128/health || exit 1

CMD ["node", "dist/index.js"]
