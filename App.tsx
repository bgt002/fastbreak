import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { Lexend_600SemiBold, Lexend_700Bold, Lexend_800ExtraBold } from "@expo-google-fonts/lexend";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { AppChrome } from "./src/components/AppChrome";
import { useAsyncData } from "./src/hooks/useAsyncData";
import { navItems, type TabId } from "./src/navigation";
import { PlayoffsScreen } from "./src/screens/PlayoffsScreen";
import { ScoresScreen } from "./src/screens/ScoresScreen";
import { StandingsScreen } from "./src/screens/StandingsScreen";
import { StatsScreen } from "./src/screens/StatsScreen";
import { getCurrentNbaSeason, getPostseasonGames } from "./src/services/nbaApi";
import { colors } from "./src/theme";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("scores");
  const season = useMemo(() => getCurrentNbaSeason(), []);
  const { data: postseasonGames } = useAsyncData(() => getPostseasonGames(season), [season]);

  // Default to visible while loading or on error so the tab doesn't flicker
  // away on cold start. Only hide when the fetch resolves to an empty list.
  const hasPlayoffs = postseasonGames === undefined || postseasonGames.length > 0;

  const visibleNavItems = useMemo(
    () => (hasPlayoffs ? navItems : navItems.filter((n) => n.id !== "playoffs")),
    [hasPlayoffs]
  );

  useEffect(() => {
    if (activeTab === "playoffs" && !hasPlayoffs) {
      setActiveTab("scores");
    }
  }, [activeTab, hasPlayoffs]);

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Lexend_600SemiBold,
    Lexend_700Bold,
    Lexend_800ExtraBold,
    ...Ionicons.font
  });

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    <>
      <StatusBar style="light" />
      <AppChrome activeTab={activeTab} items={visibleNavItems} onTabChange={setActiveTab}>
        {activeTab === "scores" ? <ScoresScreen /> : null}
        {activeTab === "stats" ? <StatsScreen /> : null}
        {activeTab === "standings" ? <StandingsScreen /> : null}
        {activeTab === "playoffs" ? <PlayoffsScreen /> : null}
      </AppChrome>
    </>
  );
}
