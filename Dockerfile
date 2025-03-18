FROM node:18-alpine

WORKDIR /app

# Install dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Expose port
EXPOSE 10000

# Start the application
CMD ["node", "server.js"]
