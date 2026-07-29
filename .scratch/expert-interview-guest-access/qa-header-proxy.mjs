import http from "node:http"

const identity = JSON.stringify({
  subject: process.env.QA_SUBJECT ?? "ticket_qa_operator",
  organizationId: "org_fairlend",
  email: process.env.QA_EMAIL ?? "qa@fairlend.ca",
  displayName: process.env.QA_DISPLAY_NAME ?? "Ticket QA Operator",
  workosRole: process.env.QA_WORKOS_ROLE ?? "operator-editor",
})
const listenPort = Number(process.env.QA_PROXY_PORT ?? 4175)
const upstreamPort = Number(process.env.QA_UPSTREAM_PORT ?? 4174)

http
  .createServer((request, response) => {
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: upstreamPort,
        path: request.url,
        method: request.method,
        headers: {
          ...request.headers,
          host: `localhost:${upstreamPort}`,
          "x-fairlend-e2e-key": "local-playwright-only",
          "x-fairlend-e2e-user": identity,
        },
      },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.headers
        )
        upstreamResponse.pipe(response)
      }
    )
    upstream.on("error", (error) => {
      response.statusCode = 502
      response.end(error.message)
    })
    request.pipe(upstream)
  })
  .listen(listenPort, "127.0.0.1")
