import React, { useEffect, useState, useRef } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEntryStore } from '../stores/useEntryStore';
import { theme } from '../theme';

export default function TimelineScreen() {
  const { entries, loadEntries, isLoading } = useEntryStore();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadEntries();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadEntries();
    setRefreshing(false);
  };

  const AnimatedCard = ({ item, index }) => {
    const slideAnim = useRef(new Animated.Value(20)).current;
    const fadeAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 300, delay: Math.min(index * 40, 400), useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, delay: Math.min(index * 40, 400), useNativeDriver: true })
      ]).start();
    }, []);

    const d = new Date(item.timestamp);
    const timeStr = `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
    
    return (
      <Animated.View style={[styles.card, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.header}>
          <Text style={styles.source}>{item.source === 'manual' ? '🧠 Dump' : item.source}</Text>
          <Text style={styles.time}>{timeStr}</Text>
        </View>
        <Text style={styles.text}>{item.rawText}</Text>
      </Animated.View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Timeline</Text>
      
      {isLoading && !refreshing && entries.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.primary} /></View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={e => e.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
          renderItem={({ item, index }) => <AnimatedCard item={item} index={index} />}
          ListEmptyComponent={<Text style={styles.emptyText}>No captures yet. Tap the + to start dumping.</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { ...theme.typography.h1, padding: theme.spacing.m },
  listContent: { padding: theme.spacing.m, paddingBottom: 100 },
  card: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.m,
    borderRadius: theme.radius.m,
    marginBottom: theme.spacing.m,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: theme.spacing.xs },
  source: { ...theme.typography.caption, color: theme.colors.primary, textTransform: 'uppercase' },
  time: { ...theme.typography.caption },
  text: { ...theme.typography.body, lineHeight: 22 },
  emptyText: { color: theme.colors.textMuted, textAlign: 'center', marginTop: theme.spacing.xxl }
});
