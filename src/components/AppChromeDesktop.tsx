import Ionicons from "@expo/vector-icons/Ionicons";
import type { PropsWithChildren } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { type NavItem, type TabId } from "../navigation";
import { colors, fonts, spacing } from "../theme";

type Props = PropsWithChildren<{
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  items: NavItem[];
}>;

export function AppChromeDesktop({ activeTab, children, onTabChange, items }: Props) {
  return (
    <View style={styles.shell}>
      <Sidebar activeId={activeTab} items={items} onTabChange={onTabChange} />
      <View style={styles.main}>{children}</View>
    </View>
  );
}

function Sidebar({
  activeId,
  items,
  onTabChange
}: {
  activeId: TabId;
  items: NavItem[];
  onTabChange: (tab: TabId) => void;
}) {
  return (
    <View style={styles.sidebar}>
      <View style={styles.brandRow}>
        <Ionicons color={colors.secondary} name="basketball-outline" size={24} />
        <Text style={styles.brandText}>Fastbreak</Text>
      </View>
      <View style={styles.navList}>
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              key={item.id}
              onPress={() => onTabChange(item.id)}
              style={(state) => {
                // hovered is a react-native-web extension
                const { pressed } = state;
                const hovered = (state as { hovered?: boolean }).hovered;
                return [
                  styles.navItem,
                  active && styles.navItemActive,
                  hovered && !active && styles.navItemHovered,
                  pressed && styles.pressed
                ];
              }}
            >
              <Ionicons color={active ? colors.white : "#A5ACB8"} name={item.icon} size={18} />
              <Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.footer}>
        <Text style={styles.footerText}>Data via NBA · ESPN</Text>
      </View>
    </View>
  );
}

const SIDEBAR_WIDTH = 232;

const styles = StyleSheet.create({
  shell: {
    backgroundColor: colors.background,
    flex: 1,
    flexDirection: "row"
  },
  sidebar: {
    backgroundColor: "rgba(14,30,54,0.96)",
    borderRightColor: "rgba(255,255,255,0.08)",
    borderRightWidth: 1,
    flexDirection: "column",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    width: SIDEBAR_WIDTH
  },
  brandRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm
  },
  brandText: {
    color: colors.secondary,
    fontFamily: fonts.display,
    fontSize: 22,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    transform: [{ skewX: "-8deg" }]
  },
  navList: {
    flex: 1,
    gap: 4,
    marginTop: spacing.lg
  },
  navItem: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  navItemActive: {
    backgroundColor: colors.secondary
  },
  navItemHovered: {
    backgroundColor: "rgba(255,255,255,0.04)"
  },
  navLabel: {
    color: "#A5ACB8",
    fontFamily: fonts.heading,
    fontSize: 13,
    letterSpacing: 0.4,
    textTransform: "uppercase"
  },
  navLabelActive: {
    color: colors.white
  },
  footer: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md
  },
  footerText: {
    color: "#566275",
    fontFamily: fonts.body,
    fontSize: 11
  },
  main: {
    backgroundColor: colors.background,
    flex: 1,
    minWidth: 0
  },
  pressed: {
    opacity: 0.72
  }
});
