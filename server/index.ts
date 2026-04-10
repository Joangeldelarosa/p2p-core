import { SignalingServer } from './SignalingServer';

const PORT = parseInt(process.env.PORT ?? '8080', 10);
const DEBUG = process.env.DEBUG === 'true';

const server = new SignalingServer({
  port: PORT,
  debug: DEBUG,
  allowRoomListing: true,
});

console.log(`p2p-core signaling server starting on port ${PORT} …`);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down …');
  await server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await server.close();
  process.exit(0);
});

export { server };
