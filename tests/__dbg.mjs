import * as core from "../src/renderer/src/components/session/MarkdownLinkCore.ts";
console.log('keys:', Object.keys(core).join(','));
console.log('docs/guide.md →', core.isLocalPathRef("docs/guide.md"));
console.log('./src/a.ts →', core.isLocalPathRef("./src/a.ts"));
console.log('https →', core.isLocalPathRef("https://a.com"));
