import type { FastifyInstance } from "fastify";

export function registerAssetDemo(app: FastifyInstance) {
  const upstream = process.env.ACTISCAPE_ASSET_SERVICE_URL || "http://127.0.0.1:3133";
  app.get("/asset-demo", async (_request, reply) => reply.redirect("/asset-demo/"));
  app.get("/asset-demo/*", async (request, reply) => {
    const path = request.url.slice("/asset-demo".length) || "/";
    const result = await fetch(`${upstream}${path}`, {
      headers: { accept: request.headers.accept || "*/*" },
      redirect: "follow",
    });
    const contentType = result.headers.get("content-type") || "application/octet-stream";
    const headers = Object.fromEntries(result.headers);
    delete headers["content-length"];
    delete headers["content-encoding"];
    if (/html|javascript|json|css/.test(contentType)) {
      const text = (await result.text())
        .replaceAll("/api/v1/", "/asset-demo/api/v1/")
        .replaceAll('href="/style.css"', 'href="/asset-demo/style.css"')
        .replaceAll('src="/app.js"', 'src="/asset-demo/app.js"');
      return reply
        .code(result.status)
        .headers(headers)
        .type(contentType)
        .send(text);
    }
    return reply
      .code(result.status)
      .headers(headers)
      .type(contentType)
      .send(Buffer.from(await result.arrayBuffer()));
  });
  app.post("/asset-demo/*", async (_request, reply) =>
    reply.code(405).send({
      error: "PUBLIC_DEMO_READ_ONLY",
      message: "公开演示为只读模式；请在团队内部资产服务中提交生成任务。",
    }),
  );
}
