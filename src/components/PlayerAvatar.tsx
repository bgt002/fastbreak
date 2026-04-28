import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { playerHeadshotUri, playerInitials, type NbaPlayer } from "../services/nbaApi";
import { colors, fonts } from "../theme";

type Props = {
  player: NbaPlayer;
  size?: number;
  style?: StyleProp<ViewStyle>;
  highlighted?: boolean;
};

export function PlayerAvatar({ player, size = 38, style, highlighted = false }: Props) {
  const [failed, setFailed] = useState(false);

  // Reset error state if the player changes (e.g., re-rendering rows in a modal).
  useEffect(() => {
    setFailed(false);
  }, [player.id]);

  const containerStyle = [
    styles.container,
    { width: size, height: size, borderRadius: size / 2 },
    highlighted && styles.highlighted,
    style
  ];

  if (failed) {
    return (
      <View style={containerStyle}>
        <Text style={[styles.initials, { fontSize: Math.max(10, size * 0.32) }]}>
          {playerInitials(player)}
        </Text>
      </View>
    );
  }

  return (
    <View style={containerStyle}>
      <Image
        accessibilityLabel={`${player.first_name} ${player.last_name} headshot`}
        onError={() => setFailed(true)}
        source={{ uri: playerHeadshotUri(player.id) }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: "#172235",
    justifyContent: "center",
    overflow: "hidden"
  },
  highlighted: {
    borderColor: colors.secondary,
    borderWidth: 1
  },
  initials: {
    color: colors.white,
    fontFamily: fonts.bodyBold
  }
});
