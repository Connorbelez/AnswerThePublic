import { describe, expect, it } from "vitest"

import { rewriteAutomergeRepoImportMethod } from "../../scripts/vite-automerge-compat"

describe("Vite Automerge compatibility", () => {
  it("protects Repo.import from Vite dynamic-import query rewriting", () => {
    const source = `class Repo {
      import(binary, args) {
        return binary
      }
    }`

    const rewritten = rewriteAutomergeRepoImportMethod(
      source,
      "/workspace/node_modules/@automerge/automerge-repo/dist/Repo.js"
    )

    expect(rewritten).toContain('["import"](binary, args) {')
    expect(rewritten).not.toContain("import(binary, args) {")
  })

  it("does not rewrite application source", () => {
    expect(
      rewriteAutomergeRepoImportMethod(
        "function importValue(binary, args) {}",
        "/workspace/src/import-value.ts"
      )
    ).toBeNull()
  })

  it("does not rewrite similarly shaped methods in other dependencies", () => {
    expect(
      rewriteAutomergeRepoImportMethod(
        "class Loader { import(binary, args) {} }",
        "/workspace/node_modules/example-loader/dist/index.js"
      )
    ).toBeNull()
  })
})
