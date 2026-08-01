import type { Plugin } from "vite"

const repoImportMethod = /\bimport\(binary, args\)\s*\{/g

export function rewriteAutomergeRepoImportMethod(code: string, id: string) {
  const normalizedId = id.split("?", 1)[0].replaceAll("\\", "/")
  if (
    !normalizedId.endsWith(
      "/node_modules/@automerge/automerge-repo/dist/Repo.js"
    ) ||
    !code.includes("import(binary, args)")
  ) {
    return null
  }

  const rewritten = code.replace(repoImportMethod, '["import"](binary, args) {')
  return rewritten === code ? null : rewritten
}

export function automergeRepoImportMethodCompat(): Plugin {
  return {
    name: "fairlend-automerge-repo-import-method-compat",
    enforce: "pre",
    transform(code, id) {
      const rewritten = rewriteAutomergeRepoImportMethod(code, id)
      return rewritten ? { code: rewritten, map: null } : null
    },
  }
}
