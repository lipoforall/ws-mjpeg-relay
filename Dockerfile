# Build stage
FROM node:16-alpine as build

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY client/package*.json ./client/

# Install dependencies
RUN npm install
RUN cd client && npm install

# Copy source code
COPY . .

# Build the React app
RUN cd client && npm run build

# Production stage
FROM node:18-alpine

# Install FFmpeg and other dependencies
RUN apk add --no-cache ffmpeg bash

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy server files
COPY --from=build /app/client/build ./public
COPY server.js ./

# Create recordings directory
RUN mkdir -p recordings && chmod 777 recordings

# Expose port
EXPOSE 10000

# Command to run the server
CMD ["node", "server.js"]
