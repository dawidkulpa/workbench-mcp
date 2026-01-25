# Sandbox Container for Workbench MCP
# Provides a secure, isolated TypeScript execution environment

FROM node:20-alpine

# Install additional tools
RUN apk add --no-cache \
    git \
    curl \
    jq \
    bash

# Create non-root user (node user already exists in node:alpine)
# Set up workspace directory
RUN mkdir -p /workspace /toolbelt && \
    chown -R node:node /workspace /toolbelt

# Copy template files
COPY --chown=node:node template/ /workspace/

# Switch to non-root user
USER node

# Set working directory
WORKDIR /workspace

# Install template dependencies
RUN npm install --ignore-scripts

# Build the template project
RUN npm run build || true

# Default command - keep container running
CMD ["tail", "-f", "/dev/null"]
