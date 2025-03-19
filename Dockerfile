# Build stage
FROM node:18-alpine as build

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

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy built React app and server code
COPY --from=build /app/client/build ./public
COPY server.js ./

# Expose port
EXPOSE 10000

# Start the server
CMD ["node", "server.js"]
