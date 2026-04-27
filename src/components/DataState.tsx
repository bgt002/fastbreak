import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { colors, fonts, radii, spacing } from "../theme";

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <View style={styles.stateCard}>
      <ActivityIndicator color={colors.secondary} />
      <Text style={styles.stateText}>{label}</Text>
    </View>
  );
}

export function EmptyState({ message, title = "No Data" }: { message: string; title?: string }) {
  return (
    <View style={styles.stateCard}>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateText}>{message}</Text>
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <View style={styles.stateCard}>
      <Text style={styles.stateTitle}>Data Unavailable</Text>
      <Text style={styles.stateText}>{error.message}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stateCard: {
    alignItems: "center",
    backgroundColor: "rgba(14, 30, 54, 0.58)",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg
  },
  stateTitle: {
    color: colors.white,
    fontFamily: fonts.heading,
    fontSize: 15,
    lineHeight: 20,
    textAlign: "center"
  },
  stateText: {
    color: "#A5ACB8",
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center"
  },
  retryButton: {
    backgroundColor: colors.secondary,
    borderRadius: radii.sm,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  retryText: {
    color: colors.white,
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    lineHeight: 13,
    textTransform: "uppercase"
  },
  pressed: {
    opacity: 0.72
  }
});
