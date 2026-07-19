import { rm } from "node:fs/promises"
import { spawn } from "node:child_process"

const disposablePaths = [
  new URL("../.e2e-dist", import.meta.url),
  new URL("../.wrangler", import.meta.url),
]

await Promise.all(
  disposablePaths.map((path) => rm(path, { recursive: true, force: true }))
)

const exitCode = await new Promise((resolve, reject) => {
  const child = spawn("bunx", ["playwright", "test"], {
    stdio: "inherit",
    env: process.env,
  })
  child.once("error", reject)
  child.once("exit", (code) => resolve(code ?? 1))
})

await Promise.all(
  disposablePaths.map((path) => rm(path, { recursive: true, force: true }))
)

process.exitCode = exitCode
