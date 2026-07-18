import { rm } from "node:fs/promises"
import { spawn } from "node:child_process"

const exitCode = await new Promise((resolve, reject) => {
  const child = spawn("bunx", ["playwright", "test"], {
    stdio: "inherit",
    env: process.env,
  })
  child.once("error", reject)
  child.once("exit", (code) => resolve(code ?? 1))
})

await rm(new URL("../.e2e-dist", import.meta.url), {
  recursive: true,
  force: true,
})

process.exitCode = exitCode
