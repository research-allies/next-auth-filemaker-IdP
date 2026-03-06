import { defineConfig } from "tsup";
import { readFileSync, writeFileSync } from "fs";

function prependUseClient() {
  for (const file of ["dist/client.js", "dist/client.cjs"]) {
    try {
      const content = readFileSync(file, "utf8");
      if (!content.startsWith('"use client"')) {
        writeFileSync(file, `"use client";\n${content}`);
      }
    } catch (err) {
      throw new Error(
        `prependUseClient: could not process ${file} — did the client entry build succeed?\n${err}`
      );
    }
  }
}

const shared = {
  format: ["cjs", "esm"] as ("cjs" | "esm")[],
  dts: true,
  sourcemap: true,
  external: ["next-auth", "@auth/core", "react", "react-dom", "next"],
  splitting: false,
  treeshake: true,
};

export default defineConfig([
  {
    ...shared,
    entry: ["src/index.ts"],
    clean: true,
  },
  {
    ...shared,
    entry: ["src/client.ts"],
    onSuccess: async () => prependUseClient(),
  },
]);
