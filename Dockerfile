# Use Node.js 18 Alpine as base image
FROM node:18-alpine

# Add tini for better signal handling
RUN apk add --no-cache tini

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force

# Copy application files
COPY . .

# Use tini as entrypoint
ENTRYPOINT ["/sbin/tini", "--"]

# Expose port 3000 (Railway will handle port mapping)
EXPOSE 3000

# Start the application
CMD ["node", "src/index.js"] 