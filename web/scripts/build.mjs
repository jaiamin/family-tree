import { readFile, mkdir, writeFile } from "node:fs/promises";
import { build, transform } from "esbuild";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { installationConfig } from "./config.mjs";
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const config = process.env.FAMILY_INSTALLATION_CONFIG_JSON || process.env.FAMILY_INSTALLATION_CONFIG || existsSync("installation.json") ? installationConfig() : null;
const base = process.env.BASE_PATH ?? config?.basePath ?? "/family-tree";
if (config && base !== config.basePath) throw Error("BASE_PATH conflicts with the installation configuration. Use matching values or build Docker separately.");
if (!/^(\/[a-zA-Z0-9_-]+)*$/.test(base)) throw Error("Invalid BASE_PATH.");
const source = name => readFile(`ui/${name}`, "utf8");
const render = (template, values) => template.replace(/__[A-Z_]+__/g, token => { if (!(token in values)) throw Error(`Missing ${token}`); return values[token]; });
const header = await source("header.html");
const shared = { __SITE_NAME__: '<span class="skeleton skeleton-site" aria-hidden="true">&nbsp;</span>', __COUNT__: "", __TREE_SWITCH__: "", __SEARCH__: "", __SHARE_TREE__: "" };
const homeHeader = render(header, shared);
const treeHeader = render(header, { ...shared,
  __COUNT__: '<div class="count" id="count"><span class="skeleton skeleton-count" aria-hidden="true">&nbsp;</span></div>', __SEARCH__: await source("search.html"),
  __TREE_SWITCH__: '<span class="tree-crumb"><span class="divider" aria-hidden="true">/</span><a class="current-tree" href="/"><span class="skeleton skeleton-tree" aria-hidden="true">&nbsp;</span></a><span class="tree-picker"><button id="tree-switch" aria-label="Switch family tree" aria-expanded="false" aria-controls="tree-options" title="Switch family tree"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><ul id="tree-options" class="tree-options" aria-label="Family trees" hidden></ul></span></span>',
  __SHARE_TREE__: '<button class="icon-button share-tree-button" id="share-tree" aria-label="Share tree" title="Share tree"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m-4 4 4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg><span>Share</span></button>',
});
const font = await readFile("node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2");
const fontPath = `/assets/geist.${createHash("sha256").update(font).digest("hex").slice(0,16)}.woff2`;
const fontLicense = await readFile("node_modules/@fontsource-variable/geist/LICENSE", "utf8");
const licensePath = `/assets/geist-license.${createHash("sha256").update(fontLicense).digest("hex").slice(0,16)}.txt`;
const fontCss = `/* Geist: SIL OFL 1.1; ${base}${licensePath} */@font-face{font-family:Geist;font-style:normal;font-weight:100 900;font-display:swap;src:url(${base}${fontPath}) format('woff2');}`;
const css = fontCss + await source("shell.css"), clientCss = await readFile("src/client.css", "utf8");
const pages = { [fontPath]: font.toString("base64"), [licensePath]: fontLicense };
async function script(name, content, browser = true) {
  // Shared helpers also support Node tests. Remove those exports before wrapping browser code.
  const result = await transform(content, { minify: true, target: "es2022", ...browser ? { define: { module: "undefined" } } : {} });
  const code = browser ? `(() => {${result.code}})();` : result.code;
  const hash = createHash("sha256").update(code).digest("hex").slice(0, 16);
  const path = `/assets/${name}.${hash}.js`;
  pages[path] = code;
  return `<script src="${base}${path}" data-base="${base}" defer></script>`;
}
const browser = await build({ entryPoints: { app: "src/client.js", viewer: "ui/share.js" }, bundle: true, splitting: true, format: "esm", target: "es2022", minify: true, write: false, outdir: "assets", entryNames: "[name].[hash]", chunkNames: "shared.[hash]", publicPath: `${base}/assets`, external: ["./vendor/elk.bundled.js"], metafile: true });
const entries = {};
for (const output of browser.outputFiles) {
  const path = `/assets/${output.path.split("/").pop()}`;
  pages[path] = output.text;
  const meta = browser.metafile.outputs[Object.keys(browser.metafile.outputs).find(key => output.path.endsWith(key))];
  if (meta.entryPoint === "src/client.js") entries.app = path;
  if (meta.entryPoint === "ui/share.js") entries.viewer = path;
}
const moduleScript = path => `<script type="module" src="${base}${path}"></script>`;
const appScript = moduleScript(entries.app);
const viewerScripts = await script("elk", await source("vendor/elk.bundled.js"), false) + moduleScript(entries.viewer);
const templates = {
  "/index.html": render(await source("home.html"), { __TITLE__: "Family trees", __TREE_COUNT__: "0", __TREES__: '<ul class="trees" id="family-list"></ul>', __SHELL_CSS__: css, __HEADER__: homeHeader }).replace('<h2>Family trees (0)</h2>', '<h2 id="family-heading">Family trees</h2>'),
  "/tree.html": render(await source("share.html"), {
    __TITLE__: "Family tree", __SHELL_CSS__: css, __HEADER__: treeHeader,
    __VIEWER_SCRIPTS__: viewerScripts,
  }),
};
for (const [name, template] of Object.entries(templates)) {
  pages[name] = template.replace('<body>', `<body data-family-base="${base}">`).replaceAll('href="/', `href="${base}/`).replaceAll(`href="${base}/"`, `href="${base || '/'}"`).replace('</head>', `<style>${clientCss}</style>${appScript}</head>`);
}
pages["/login.html"] = (await readFile("src/login.html", "utf8")).replaceAll("__BASE__", base).replace("__SHELL_CSS__", css).replace("__CLIENT_CSS__", clientCss).replace(`<script src="${base}/app.js" defer></script>`, appScript);
pages["/favicon.svg"] = await source("favicon.svg");
await mkdir("generated", { recursive: true });
await mkdir("dist", { recursive: true });
await writeFile("dist/build.json", JSON.stringify({ basePath: base }));
await writeFile("generated/pages.json", JSON.stringify(pages));
await build({ entryPoints: ["src/index.ts"], bundle: true, format: "esm", target: "es2022", outfile: "dist/worker.mjs", minify: true, sourcemap: true });

await build({ entryPoints: ["src/app.ts"], bundle: true, format: "esm", target: "es2022", outfile: "dist/app.mjs", minify: true });

await build({ entryPoints: ["src/public-ids.ts"], bundle: true, format: "esm", platform: "node", outfile: "dist/public-ids.mjs" });

await build({ entryPoints: ["src/platform/local.ts"], bundle: true, format: "esm", platform: "node", target: "node26", outfile: "dist/local.mjs" });

await build({ entryPoints: ["src/backup.ts", "src/recovery.ts", "src/backup-export.ts", "src/legacy-migration.ts"], bundle:true, format:"esm", platform:"node", target:"node26", outdir:"dist/maintenance" });
