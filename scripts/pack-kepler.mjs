import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { deflateRawSync, crc32 } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, ".kepler-pack");
const zipPath = join(root, "public", "kepler-yard.zip");

const esbuild = await import("/tmp/ky-esbuild/node_modules/esbuild/lib/main.js");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const bundled = await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(root, "src/simulator/standalone.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  write: false,
  minify: true,
});

const css = readFileSync(join(root, "src/simulator/lab.css"), "utf8");
const js = bundled.outputFiles[0]?.text ?? "";
if (!js) throw new Error("Kepler bundle was empty");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Kepler Yard</title>
  <meta name="description" content="Fling planets into orbit. A stable n-body gravity sandbox." />
  <meta name="theme-color" content="#07080c" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    html, body { height: 100%; margin: 0; background: #07080c; }
    ${css}
    button, a.ky-btn, .ky-dev { cursor: pointer; }
  </style>
</head>
<body>
  <main id="root" class="ky-host" aria-label="Kepler Yard"></main>
  <script>${js}</script>
</body>
</html>
`;

const readme = `# Kepler Yard

A self-contained orbital gravity sandbox. No build step and no server.

## Host on GitHub Pages

1. Create a new empty repository on GitHub.
2. Upload \`index.html\` to the repository root (this README can go too).
3. Open Settings → Pages.
4. Deploy from the \`main\` branch, folder \`/ (root)\`.
5. After a minute, the site is live at the Pages URL.

You can also open \`index.html\` directly in a browser.

Drag the sky to spawn a body, drag a planet to fling it, and use the time scale when you want the dance to hurry.
`;

function zipStore(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = deflateRawSync(file.data);
    const crc = crc32(file.data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, data);
    const cent = Buffer.alloc(46);
    cent.writeUInt32LE(0x02014b50, 0);
    cent.writeUInt16LE(20, 4);
    cent.writeUInt16LE(20, 6);
    cent.writeUInt16LE(0, 8);
    cent.writeUInt16LE(8, 10);
    cent.writeUInt16LE(0, 12);
    cent.writeUInt16LE(0, 14);
    cent.writeUInt32LE(crc, 16);
    cent.writeUInt32LE(data.length, 20);
    cent.writeUInt32LE(file.data.length, 24);
    cent.writeUInt16LE(name.length, 28);
    cent.writeUInt16LE(0, 30);
    cent.writeUInt16LE(0, 32);
    cent.writeUInt16LE(0, 34);
    cent.writeUInt16LE(0, 36);
    cent.writeUInt32LE(0, 38);
    cent.writeUInt32LE(offset, 42);
    central.push(cent, name);
    offset += local.length + name.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, centralBuf, end]);
}

const zip = zipStore([
  { name: "index.html", data: Buffer.from(html) },
  { name: "README.md", data: Buffer.from(readme) },
]);
writeFileSync(zipPath, zip);
rmSync(outDir, { recursive: true, force: true });
console.log(`wrote ${zipPath} (${zip.length} bytes)`);
