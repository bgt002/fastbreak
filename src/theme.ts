export const colors = {
  background: "#050B14",
  primary: "#0A192F",
  secondary: "#FF6B00",
  secondaryPressed: "#CC5600",
  tertiary: "#00FFC2",
  neutral: "#F4F7F9",
  onBackground: "#E0E3E5",
  onSurface: "#E0E3E5",
  onSurfaceMuted: "#8F9097",
  surface: "#101416",
  surfaceContainer: "#1C2022",
  surfaceContainerHigh: "#262B2C",
  surfaceContainerHighest: "#313537",
  card: "#0E1E36",
  outline: "#44474D",
  border: "rgba(255, 255, 255, 0.08)",
  borderStrong: "rgba(255, 255, 255, 0.14)",
  white: "#FFFFFF",
  black: "#000000",
  win: "#00FFC2",
  loss: "#FF5263"
};

export const fonts = {
  body: "Inter_400Regular",
  bodyMedium: "Inter_500Medium",
  bodySemiBold: "Inter_600SemiBold",
  bodyBold: "Inter_700Bold",
  heading: "Lexend_600SemiBold",
  scoreboard: "Lexend_700Bold",
  display: "Lexend_800ExtraBold"
};

export const radii = {
  xs: 2,
  sm: 4,
  md: 8,
  pill: 999
};

export const spacing = {
  xs: 4,
  sm: 8,
  gutter: 12,
  md: 16,
  lg: 24,
  xl: 40
};

// Breakpoints picked from real-world device widths (CSS pixels):
//   xs : <380   - iPhone SE (375), Galaxy S25 (360)
//   sm : 380   - iPhone 14/15 (390), iPhone 16 Pro (393)
//   md : 640   - large phones in landscape, small tablets
//   lg : 1024  - iPad landscape (1024), iPad Pro 11" landscape (1194)
//   xl : 1280  - 13" MacBooks and most laptops
//   xxl: 1600  - desktops/external monitors
//
// `lg` is the cutoff where the chrome switches from mobile (bottom tabs) to
// desktop (sidebar). iPad portrait (768/834) stays on the mobile chrome —
// that layout already works at those widths and the touch target sizing is
// tuned for it. Landscape iPad and everything above gets the desktop tree.
export const breakpoints = {
  xs: 0,
  sm: 380,
  md: 640,
  lg: 1024,
  xl: 1280,
  xxl: 1600
} as const;

export const desktopBreakpoint = breakpoints.lg;
