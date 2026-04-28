import Ionicons from "@expo/vector-icons/Ionicons";
import type { PropsWithChildren } from "react";
import {
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text,
  View,
  type ViewStyle
} from "react-native";

import { navItems, type NavItem, type TabId } from "../navigation";
import { colors, fonts, spacing } from "../theme";

type AppChromeProps = PropsWithChildren<{
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  items?: NavItem[];
}>;

// On web (incl. iOS/Android PWA standalone) we deliberately skip
// react-native-web's SafeAreaView wrapper. RNW's SafeAreaView pads the
// *outer* container with env(safe-area-inset-*), which pushes the topbar's
// dark background down — leaving the page background showing as a tall dark
// gap under the status bar. Instead, we let the chrome extend edge-to-edge
// and push env() padding *inside* the topbar / bottom nav, so their dark
// backgrounds extend full-bleed under the translucent status bar and home
// indicator (matching native iOS apps).
export function AppChrome({ activeTab, children, onTabChange, items = navItems }: AppChromeProps) {
  const tree = (
    <View style={styles.screen}>
      <TopBar />
      <View style={styles.content}>{children}</View>
      <BottomNav activeId={activeTab} items={items} onTabChange={onTabChange} />
    </View>
  );

  if (Platform.OS === "web") {
    return tree;
  }
  return <SafeAreaView style={styles.safeArea}>{tree}</SafeAreaView>;
}

function TopBar() {
  return (
    <View style={[styles.topBar, webTopBarSafeArea]}>
      <View style={styles.topBarInner}>
        <View style={styles.brandRow}>
          <Ionicons color={colors.secondary} name="basketball-outline" size={20} />
          <Text style={styles.brandText}>Fastbreak</Text>
        </View>
      </View>
    </View>
  );
}

function BottomNav({
  activeId,
  items,
  onTabChange
}: {
  activeId: TabId;
  items: NavItem[];
  onTabChange: (tab: TabId) => void;
}) {
  return (
    <View style={[styles.bottomNav, webBottomNavSafeArea]}>
      <View style={styles.bottomNavInner}>
        {items.map((item) => {
          const active = item.id === activeId;

          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              key={item.id}
              onPress={() => onTabChange(item.id)}
              style={({ pressed }) => [styles.navItem, active && styles.navItemActive, pressed && styles.pressed]}
            >
              <Ionicons color={active ? colors.secondary : "#7D8490"} name={item.icon} size={20} />
              <Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const topInset = Platform.OS === "android" ? NativeStatusBar.currentHeight ?? 0 : 0;

// On web we let the topbar / bottom nav extend full-bleed, then apply
// env(safe-area-inset-*) padding inside them so their dark backgrounds slide
// under the iOS status bar / home indicator while the actual content (logo,
// nav buttons) stays inside the safe area. Cast to any: env() is a CSS
// expression that RN's typed paddingTop doesn't allow, but RNW passes it
// through to inline style as-is.
const webTopBarSafeArea = (Platform.OS === "web"
  ? {
      paddingTop: "env(safe-area-inset-top)",
      paddingLeft: "env(safe-area-inset-left)",
      paddingRight: "env(safe-area-inset-right)"
    }
  : null) as ViewStyle | null;

// On web we put the nav back into the normal flex flow (cancelling the
// `position: absolute` from styles.bottomNav) so its position is determined
// by layout, not by viewport-relative anchoring.
//
// Why: iOS PWA standalone has unstable viewport-anchored positioning. Both
// `position: absolute` (anchors to React root, which iOS resizes between
// launches) and `position: fixed` (anchors to the visual viewport, which
// iOS animates during launch transitions) produced visible "creeping up"
// of the nav between sessions. With the screen sized to 100dvh in
// postbuild-pwa.js and the nav as a normal flex child at the end of the
// column, the nav sits at the bottom by layout — stable across reopens.
const webBottomNavSafeArea = (Platform.OS === "web"
  ? {
      position: "relative",
      bottom: "auto",
      left: "auto",
      right: "auto",
      paddingBottom: "env(safe-area-inset-bottom)",
      paddingLeft: "env(safe-area-inset-left)",
      paddingRight: "env(safe-area-inset-right)"
    }
  : null) as ViewStyle | null;

// Visual breathing room between the last list item and the nav. With the nav
// in flex flow on web, content already sits above it (no overlap), so this
// is just spacing — not nav clearance. Native still uses `position: absolute`
// for the nav, so screens there need real clearance equal to the nav height.
export const NAV_CLEARANCE: number = Platform.OS === "web" ? 24 : 86;

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
    paddingTop: topInset
  },
  content: {
    flex: 1
  },
  topBar: {
    backgroundColor: "rgba(5, 11, 20, 0.94)",
    borderBottomColor: "rgba(255,255,255,0.1)",
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 54,
    shadowColor: colors.black,
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 0.32,
    shadowRadius: 18,
    zIndex: 5
  },
  topBarInner: {
    alignItems: "center",
    alignSelf: "center",
    flexDirection: "row",
    height: 54,
    justifyContent: "space-between",
    maxWidth: 1024,
    paddingHorizontal: spacing.md,
    width: "100%"
  },
  brandRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7
  },
  brandText: {
    color: colors.secondary,
    fontFamily: fonts.display,
    fontSize: 17,
    letterSpacing: 0,
    lineHeight: 19,
    textTransform: "uppercase",
    transform: [{ skewX: "-8deg" }]
  },
  bottomNav: {
    backgroundColor: "rgba(14,30,54,0.96)",
    borderTopColor: "rgba(255,255,255,0.1)",
    borderTopWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    left: 0,
    minHeight: 56,
    paddingBottom: Platform.OS === "ios" ? spacing.sm : 0,
    position: "absolute",
    right: 0
  },
  bottomNavInner: {
    alignSelf: "center",
    flexDirection: "row",
    height: 56,
    maxWidth: 1024,
    width: "100%"
  },
  navItem: {
    alignItems: "center",
    flex: 1,
    gap: 2,
    justifyContent: "center"
  },
  navItemActive: {
    borderTopColor: colors.secondary,
    borderTopWidth: 2
  },
  navLabel: {
    color: "#7D8490",
    fontFamily: fonts.heading,
    fontSize: 8,
    letterSpacing: 0,
    lineHeight: 10,
    textTransform: "uppercase"
  },
  navLabelActive: {
    color: colors.secondary
  },
  pressed: {
    opacity: 0.72
  }
});
