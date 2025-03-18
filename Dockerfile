# Build stage for React client
FROM node:18-alpine as client-builder

WORKDIR /app/client

# Copy client package files and install dependencies
COPY client/package*.json ./
RUN npm install

# Copy client source code and build
COPY client/ ./
RUN npm run build

# Final stage for server
FROM node:18-alpine

WORKDIR /app

# Install dependencies
RUN apk add --no-cache python3 make g++

# Copy package files and install dependencies
COPY package.json ./
RUN npm install

# Copy server source code
COPY server.js ./

# Copy built client files
COPY --from=client-builder /app/client/build ./public

# Expose port
EXPOSE 10000

# Start the application
CMD ["node", "server.js"]
