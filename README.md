# MJPEG WebSocket Relay

A lightweight, efficient WebSocket relay server for MJPEG video streams with a responsive web interface.

![Screenshot](docs/screenshot.png)

## Features

- 📹 Relays MJPEG streams via WebSocket connections
- 🌐 Responsive web interface for viewing streams
- 🔄 Automatic reconnection handling
- 🔧 Configurable source WebSocket URL
- 📊 Display of stream statistics (resolution, connection time, frames received)
- 💡 Connection status indicator with accurate heartbeat LED
- 🔋 Traffic optimization - disconnects from source when no clients are connected

## Installation

### Using Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/lipoforall/ws-mjpeg-relay.git
cd ws-mjpeg-relay

# Start with Docker Compose
docker-compose up -d
```

### Manual Installation

```bash
# Clone the repository
git clone https://github.com/lipoforall/ws-mjpeg-relay.git
cd ws-mjpeg-relay

# Install dependencies
npm install

# Build the client
cd client
npm install
npm run build
cd ..

# Start the server
npm start
```

## Configuration

The application can be configured using environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `SOURCE_WEBSOCKET` | Source WebSocket URL | ws://10.242.176.200:8888/ws |
| `HOST_IP` | IP address to bind to | 172.27.65.25 |
| `PORT` | Port to listen on | 10000 |
| `RECONNECT_INTERVAL` | Reconnect interval (ms) | 5000 |

### Using environment variables:

```bash
SOURCE_WEBSOCKET=ws://example.com:8080/ws HOST_IP=0.0.0.0 PORT=3000 npm start
```

### Using Docker:

Edit the `docker-compose.yml` file to set your desired environment variables:

```yaml
version: '3'
services:
  mjpeg-relay:
    build: .
    ports:
      - "10000:10000"
    environment:
      - SOURCE_WEBSOCKET=ws://example.com:8080/ws
      - HOST_IP=0.0.0.0
      - PORT=10000
```

## Usage

1. Start the server using one of the installation methods
2. Open a web browser and navigate to `http://localhost:10000` (or the configured HOST_IP:PORT)
3. The stream should start automatically if the source is available
4. Use the settings button (⚙️) to change the source WebSocket URL

## API Endpoints

### GET `/api/config`

Returns current configuration:

```json
{
  "sourceWebSocket": "ws://example.com:8080/ws",
  "hostIP": "0.0.0.0",
  "port": 10000
}
```

### POST `/api/config`

Update the source WebSocket URL:

```json
{
  "sourceWebSocket": "ws://new-source.com:8080/ws"
}
```

## WebSocket Connection

The WebSocket server is available at `/ws` endpoint.

## License

[MIT License](LICENSE)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 