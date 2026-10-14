import Fastify from "fastify";

// monde-mind: the resident-agent backend (GDD §9, §19.3). Skeleton only; see MVP_PLAN F-07.
const app = Fastify({ logger: true });
app.get("/v1/health", async () => ({ ok: true, service: "monde-mind" }));

const port = Number(process.env.PORT ?? 8080);
await app.listen({ port, host: "0.0.0.0" });
