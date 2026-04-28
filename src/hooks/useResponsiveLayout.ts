import { useWindowDimensions } from "react-native";

import { breakpoints, desktopBreakpoint } from "../theme";

export type Layout = "mobile" | "desktop";

export type Breakpoint = "xs" | "sm" | "md" | "lg" | "xl" | "xxl";

export type ResponsiveInfo = {
  width: number;
  height: number;
  layout: Layout;
  breakpoint: Breakpoint;
  isAtLeast: (b: Breakpoint) => boolean;
};

function resolveBreakpoint(width: number): Breakpoint {
  if (width >= breakpoints.xxl) return "xxl";
  if (width >= breakpoints.xl) return "xl";
  if (width >= breakpoints.lg) return "lg";
  if (width >= breakpoints.md) return "md";
  if (width >= breakpoints.sm) return "sm";
  return "xs";
}

export function useResponsiveLayout(): ResponsiveInfo {
  const { width, height } = useWindowDimensions();
  const breakpoint = resolveBreakpoint(width);
  const layout: Layout = width >= desktopBreakpoint ? "desktop" : "mobile";
  return {
    width,
    height,
    layout,
    breakpoint,
    isAtLeast: (b) => width >= breakpoints[b]
  };
}
