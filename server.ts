import "dotenv/config";
import { buildServer } from "./src/server.js";

const host = process.env.SANDBOX_HOST ?? "127.0.0.1";
const port = Number(process.env.SANDBOX_PORT ?? 3399);
const server = buildServer();

await server.listen({ host, port });
console.log(`sandbox tool server listening on http://${host}:${port}`);
