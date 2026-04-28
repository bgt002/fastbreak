// Side-effect import (Platform-gated) that styles the browser's scrollbars to
// match the rest of the app's dark / orange theme. No-op on native.

import { Platform } from "react-native";

if (Platform.OS === "web" && typeof document !== "undefined") {
  const id = "fastbreak-scrollbar-styles";
  if (!document.getElementById(id)) {
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      /* Firefox */
      * {
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 107, 0, 0.6) rgba(255, 255, 255, 0.04);
      }
      /* Chromium / Safari */
      ::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      ::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.03);
      }
      ::-webkit-scrollbar-thumb {
        background: rgba(255, 107, 0, 0.55);
        border-radius: 4px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 107, 0, 0.8);
      }
      ::-webkit-scrollbar-corner {
        background: transparent;
      }
    `;
    document.head.appendChild(style);
  }
}
