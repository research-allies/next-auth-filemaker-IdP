import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/client.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["next-auth", "@auth/core", "react", "react-dom", "next"],
  splitting: false,
  treeshake: true,
});
