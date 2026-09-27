import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { VhostraStore } from "../dist-electron/store.js";

const verifyHtml = async (root, html) => {
    for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
        const reference = match[1];
        if (/^(?:https?:|data:|mailto:)/.test(reference)) continue;
        assert.doesNotMatch(
            reference,
            /\{\{/,
            "Rendered welcome references must be resolved",
        );
        const file = path.resolve(root, reference);
        await access(file);
        if (reference.endsWith(".css")) {
            const css = await readFile(file, "utf8");

            for (const url of css.matchAll(/url\(["']?([^\)"']+)["']?\)/g)) {
                const assetUrl = url[1];

                if (assetUrl.startsWith("data:")) continue;

                assert.doesNotMatch(
                    assetUrl,
                    /^https?:\/\//,
                    `CSS must not depend on remote asset: ${assetUrl}`,
                );

                await access(path.resolve(path.dirname(file), assetUrl));
            }
        }
    }
};
test("desktop and rendered welcome package their offline artwork and fonts", async () => {
    await verifyHtml(
        path.resolve("dist"),
        await readFile("dist/index.html", "utf8"),
    );
    const root = await mkdtemp(path.join(os.tmpdir(), "vhostra-assets-"));
    try {
        const store = new VhostraStore(root, path.resolve("dist-welcome"));
        const state = await store.getState();
        const publicRoot = state.sites.find(
            (site) => site.builtIn,
        ).documentRoot;
        await verifyHtml(
            publicRoot,
            await readFile(path.join(publicRoot, "index.html"), "utf8"),
        );
        const manifest = JSON.parse(await readFile("package.json", "utf8"));
        for (const resource of manifest.build.extraResources)
            await access(resource.from);
        for (const icon of [
            "build/icon.icns",
            "build/icon.ico",
            "build/icons/512x512.png",
            "src/assets/favicon-16.png",
            "src/assets/favicon-32.png",
        ])
            await access(icon);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
