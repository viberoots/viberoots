import React from "react";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native-web";
import { resolveSubtitleFromCppWasm } from "./subtitle-from-cpp-wasm";

export function Home(props: { url: string }) {
  const [subtitle, setSubtitle] = useState("Reading subtitle from C++ Wasm library...");
  useEffect(() => {
    let active = true;
    const refreshSubtitle = async () => {
      const next = await resolveSubtitleFromCppWasm();
      if (!active) return;
      setSubtitle((prev) => (prev === next ? prev : next));
    };
    void refreshSubtitle();
    if (import.meta.env.DEV) {
      const intervalId = window.setInterval(() => {
        void refreshSubtitle();
      }, 1000);
      return () => {
        active = false;
        window.clearInterval(intervalId);
      };
    }
    return () => {
      active = false;
    };
  }, []);
  return (
    <View style={styles.page}>
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Vite SSR + React Native Web</Text>
        <Text style={styles.title}>Welcome to example-webapp</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Route</Text>
          <Text style={styles.value}>{props.url}</Text>
        </View>
        <View style={styles.actions}>
          <Pressable style={styles.primary}>
            <Text style={styles.primaryText}>Start Building!</Text>
          </Pressable>
          <Pressable style={styles.secondary}>
            <Text style={styles.secondaryText}>Read SSR Flow</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    minHeight: "100vh",
    backgroundColor: "#070B19",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    position: "relative",
    overflow: "hidden",
  },
  glowTop: {
    position: "absolute",
    width: 360,
    height: 360,
    borderRadius: 999,
    backgroundColor: "#1B5AFA66",
    top: -120,
    left: -80,
    filter: "blur(28px)",
  },
  glowBottom: {
    position: "absolute",
    width: 320,
    height: 320,
    borderRadius: 999,
    backgroundColor: "#7C2BFF55",
    bottom: -120,
    right: -60,
    filter: "blur(30px)",
  },
  card: {
    width: "100%",
    maxWidth: 820,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#FFFFFF20",
    backgroundColor: "#0F1530D9",
    paddingVertical: 34,
    paddingHorizontal: 30,
    gap: 12,
  },
  eyebrow: {
    color: "#93C5FD",
    fontSize: 13,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  title: {
    color: "#F8FAFC",
    fontSize: 44,
    fontWeight: "800",
    lineHeight: 52,
  },
  subtitle: {
    color: "#C7D2FE",
    fontSize: 17,
    lineHeight: 26,
    maxWidth: 620,
  },
  row: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FFFFFF18",
    backgroundColor: "#05081655",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  label: {
    color: "#93C5FD",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  value: {
    color: "#E2E8F0",
    fontSize: 15,
    fontWeight: "500",
  },
  actions: {
    marginTop: 14,
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
  },
  primary: {
    backgroundColor: "#2F6DFB",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  primaryText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  secondary: {
    borderWidth: 1,
    borderColor: "#FFFFFF33",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    backgroundColor: "#0B122955",
  },
  secondaryText: {
    color: "#E2E8F0",
    fontSize: 14,
    fontWeight: "700",
  },
});
