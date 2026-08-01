import http from "node:http"

const server = http.createServer((request, response) => {
  const upstream = http.request(
    {
      headers: { ...request.headers, host: "localhost:3000" },
      hostname: "127.0.0.1",
      method: request.method,
      path: request.url,
      port: 3000,
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

const port = Number(process.env.CACHE_PROXY_PORT ?? "3001")

server.listen(port, "127.0.0.1", () => {
  console.log(`Cache-isolated proxy ready on http://localhost:${port}`)
})
