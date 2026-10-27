import { readFile, mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const base = (process.env.FAMILY_BASE_PATH || "/family-tree").replace(/\/$/, "");
const source = name => readFile(`ui/${name}`, "utf8");
const render = (template, values) => template.replace(/__[A-Z_]+__/g, token => { if (!(token in values)) throw Error(`Missing ${token}`); return values[token]; });
const header = await source("header.html");
const shared = { __SITE_NAME__: "Family trees", __COUNT__: "", __TREE_SWITCH__: "", __SEARCH__: "", __SHARE_TREE__: "" };
const homeHeader = render(header, shared);
const treeHeader = render(header, { ...shared,
  __COUNT__: '<div class="count" id="count"></div>', __SEARCH__: await source("search.html"),
  __TREE_SWITCH__: '<span class="tree-crumb"><span class="divider" aria-hidden="true">/</span><a class="current-tree" href="/">Family tree</a><span class="tree-picker"><button id="tree-switch" aria-label="Switch family tree" aria-expanded="false" aria-controls="tree-options" title="Switch family tree"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><ul id="tree-options" class="tree-options" aria-label="Family trees" hidden></ul></span></span>',
  __SHARE_TREE__: '<button class="icon-button" id="share-tree" aria-label="Share tree" title="Share tree"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m-4 4 4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg></button>',
});
const css = await source("shell.css"), clientCss = await readFile("src/client.css", "utf8");
const pages = {};
const templates = {
  "/index.html": render(await source("home.html"), { __TITLE__: "Family trees", __TREE_COUNT__: "0", __TREES__: '<ul class="trees" id="family-list"></ul>', __SHELL_CSS__: css, __HEADER__: homeHeader }).replace('<h2>Family trees (0)</h2>', '<h2 id="family-heading">Family trees</h2>'),
  "/tree.html": render(await source("share.html"), {
    __TITLE__: "Family tree", __SHELL_CSS__: css, __HEADER__: treeHeader,
    __LAYOUT_ENGINE__: await source("vendor/elk.bundled.js"),
    __LAYOUT_JS__: await source("layout.js") + "\n" + await source("relationship.js"), __SHARE_JS__: await source("share.js"),
  }),
};
for (const [name, template] of Object.entries(templates)) {
  pages[name] = template.replace('<body>', `<body data-family-base="${base}">`).replaceAll('href="/', `href="${base}/`).replace('</head>', `<style>${clientCss}</style><script src="${base}/app.js"></script></head>`);
}
pages["/login.html"] = (await readFile("src/login.html", "utf8")).replaceAll("__BASE__", base).replace("__SHELL_CSS__", css).replace("__CLIENT_CSS__", clientCss);
pages["/favicon.svg"] = await source("favicon.svg");
pages["/app.js"] = await readFile("src/client.js", "utf8");
await mkdir("generated", { recursive: true });
await writeFile("generated/pages.json", JSON.stringify(pages));
await build({ entryPoints: ["src/index.ts"], bundle: true, format: "esm", target: "es2022", outfile: "dist/worker.mjs", minify: true, sourcemap: true });
