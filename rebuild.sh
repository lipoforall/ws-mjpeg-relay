#!/bin/bash

echo "Stopping existing container..."
docker-compose down

echo "Building new container with FFmpeg support..."
docker-compose build --no-cache

echo "Starting container..."
docker-compose up -d

echo "Container logs (press Ctrl+C to exit):"
docker-compose logs -f 