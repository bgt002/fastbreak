import Ionicons from "@expo/vector-icons/Ionicons";
import type { PropsWithChildren } from "react";
import { Platform, Pressable, SafeAreaView, StatusBar as NativeStatusBar, StyleSheet, Text, View } from "react-native";

import { navItems, type NavItem, type TabId } from "../navigation";
import { colors, fonts, spacing } from "../theme";

type AppChromeProps = PropsWithChildren<{
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}>;

export function AppChrome({ activeTab, children, onTabChange }: AppChromeProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <TopBar />
        <View style={styles.content}>{children}</View>
        <BottomNav activeId={activeTab} items={navItems} onTabChange={onTabChange} />
      </View>
    </SafeAreaView>
  );
}

function TopBar() {
  return (
    <View style={styles.topBar}>
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
    <View style={styles.bottomNav}>
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
