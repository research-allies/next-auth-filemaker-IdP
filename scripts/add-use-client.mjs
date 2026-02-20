import { readFileSync, writeFileSync } from "fs";

// Prepend "use client" to the client bundle so Next.js
// recognizes the React Server Component boundary correctly.
const files = ["dist/client.js", "dist/client.cjs"];

for (const file of files) {
  const content = readFileSync(file, "utf8");
  if (!content.startsWith('"use client"')) {
    writeFileSync(file, '"use client";\n' + content);
    console.log(`✓ Prepended "use client" to ${file}`);
  }
}
