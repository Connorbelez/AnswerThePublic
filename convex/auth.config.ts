import { createWorkosAuthConfig } from "./lib/workosAuthConfig"

export default createWorkosAuthConfig(process.env.WORKOS_CLIENT_ID ?? "")
