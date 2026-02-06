module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true }
    },
    {
      name: "utils-cannot-import-core",
      severity: "error",
      from: { path: "src/utils" },
      to: { path: "src/core" }
    },
    {
      name: "utils-cannot-import-providers",
      severity: "error",
      from: { path: "src/utils" },
      to: { path: "src/providers" }
    },
    {
      name: "core-cannot-import-cli",
      severity: "error",
      from: { path: "src/core" },
      to: { path: "src/cli" }
    },
    {
      name: "worker-cannot-import-cli",
      severity: "error",
      from: { path: "src/worker" },
      to: { path: "src/cli" }
    },
    {
      name: "types-no-src-dependencies",
      severity: "error",
      from: { path: "src/types" },
      to: {
        path: "src",
        pathNot: "src/types"
      }
    },
    {
      name: "cli-should-not-import-providers",
      severity: "warn",
      from: { path: "src/cli" },
      to: { path: "src/providers" }
    }
  ],
  options: {
    doNotFollow: "node_modules",
    exclude: "(node_modules|dist|build)",
    maxDepth: 5,
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      mainFields: ["main", "exports"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"]
    }
  }
};
