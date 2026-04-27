import type { ComponentProps } from "react";

import Ionicons from "@expo/vector-icons/Ionicons";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

export type TabId = "scores" | "stats" | "standings" | "playoffs";

export type NavItem = {
  id: TabId;
  label: string;
  icon: IoniconName;
};

export const navItems: NavItem[] = [
  { id: "scores", label: "Scores", icon: "calendar-outline" },
  { id: "stats", label: "Stats", icon: "analytics-outline" },
  { id: "standings", label: "Standings", icon: "list-outline" },
  { id: "playoffs", label: "Playoffs", icon: "git-network-outline" }
];
