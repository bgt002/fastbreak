// Injects PWA + iOS standalone head tags into dist/index.html after
// `expo export --platform web`. iOS Safari only honors the standalone display
// flag if the meta tag is in the initial HTML, so we can't add it from JS at
// runtime — hence the postbuild step.

const fs = require("node:fs");
const path = require("node:path");

const indexPath = path.resolve(__dirname, "..", "dist", "index.html");

if (!fs.existsSync(indexPath)) {
  console.error("[postbuild-pwa] dist/index.html not found — did the build complete?");
  process.exit(1);
}

const tags = `
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#050B14" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Fastbreak" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
    <link rel="icon" type="image/x-icon" href="/icons/favicon.ico" />
    <link rel="icon" type="image/png" sizes="96x96" href="/icons/favicon-96x96.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="/icons/web-app-manifest-192x192.png" />
    <link rel="icon" type="image/png" sizes="512x512" href="/icons/web-app-manifest-512x512.png" />
    <style>
      /* Match the app's dark theme on the host page so iOS PWA standalone mode
         doesn't flash a white safe area above the status bar before React
         mounts. The actual app uses #050B14 too. */
      html, body, #root { background-color: #050B14; margin: 0; padding: 0; }
      html { overscroll-behavior: none; }
      html, body { height: 100%; width: 100%; }
      /* Why a JS-driven --app-vh instead of a CSS unit: in iOS PWA standalone
         mode, every CSS viewport unit (vh, dvh, lvh, svh) AND position:fixed
         + inset:0 anchor to the *safe* viewport — they all exclude the
         home-indicator strip even with viewport-fit=cover. That leaves a
         ~34px band of body background visible below the bottom nav. The only
         reliable measurement that returns the *full* visual viewport height
         (status-bar through home-indicator inclusive) is window.innerHeight
         read from JS. The script below writes it into --app-vh and refreshes
         on resize/visualViewport changes. */
      #root {
        display: flex;
        flex-direction: column;
        height: var(--app-vh, 100vh);
      }
    </style>
    <script>
      (function () {
        function setHeight() {
          document.documentElement.style.setProperty(
            "--app-vh",
            window.innerHeight + "px"
          );
        }
        setHeight();
        window.addEventListener("resize", setHeight);
        window.addEventListener("orientationchange", setHeight);
        if (window.visualViewport) {
          window.visualViewport.addEventListener("resize", setHeight);
        }
      })();
    </script>
`;

let html = fs.readFileSync(indexPath, "utf-8");

if (html.includes("manifest.webmanifest")) {
  console.log("[postbuild-pwa] Tags already present — skipping.");
  process.exit(0);
}

if (!html.includes("</head>")) {
  console.error("[postbuild-pwa] No </head> in dist/index.html — Expo template changed?");
  process.exit(1);
}

// Expo's default viewport tag lacks `viewport-fit=cover`, which is what tells
// iOS PWAs to extend content into the safe areas (status bar + home indicator
// regions). Without it, iOS pads the page with a white safe-area background.
html = html.replace(
  /<meta\s+name="viewport"\s+content="[^"]*"\s*\/?>/i,
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />'
);

html = html.replace("</head>", `${tags}  </head>`);
fs.writeFileSync(indexPath, html);
console.log("[postbuild-pwa] Injected manifest + iOS standalone tags into dist/index.html");
