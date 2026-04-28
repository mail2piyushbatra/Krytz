import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity, ActivityIndicator, LayoutAnimation, UIManager, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useItemStore } from '../stores/useItemStore';
import { useAuthStore } from '../stores/useAuthStore';
import ItemCard from '../components/ItemCard';
import CaptureModal from '../components/CaptureModal';
import SnoozeModal from '../components/SnoozeModal';
import AnimatedCounter from '../components/AnimatedCounter';
import { theme } from '../theme';

if (Platform.OS === 'android') {
  if (UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }
}

export default function CommandCenterScreen() {
  const { user } = useAuthStore();
  const { items, overview, focus, loadData, isLoading, markDone, toggleBlocker } = useItemStore();
  const [refreshing, setRefreshing] = useState(false);
  const [captureVisible, setCaptureVisible] = useState(false);
  const [snoozeItem, setSnoozeItem] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <Text style={styles.greeting}>Good morning, {user?.name?.split(' ')[0]}</Text>
      
      {overview && (
        <View style={styles.statePanel}>
          <View style={styles.statBox}>
            <AnimatedCounter value={overview.summary?.totalOpen || 0} style={styles.statValue} />
            <Text style={styles.statLabel}>Open Items</Text>
          </View>
          <View style={styles.statBox}>
            <AnimatedCounter value={overview.summary?.totalDone || 0} style={styles.statValue} />
            <Text style={styles.statLabel}>Done</Text>
          </View>
          <View style={styles.statBox}>
            <AnimatedCounter value={overview.summary?.totalBlockers || 0} style={[styles.statValue, { color: theme.colors.warning }]} />
            <Text style={styles.statLabel}>Blockers</Text>
          </View>
        </View>
      )}

      {focus && (
        <View style={styles.focusBox}>
          <Text style={styles.focusLabel}>Focus for Today</Text>
          <Text style={styles.focusText}>{focus.objective}</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Action Items</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {isLoading && !refreshing && items.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.primary} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={renderHeader}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
          renderItem={({ item, index }) => (
            <ItemCard 
              item={item} 
              index={index}
              onDone={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                markDone(item);
              }} 
              onBlocker={() => toggleBlocker(item)} 
              onSnooze={() => setSnoozeItem(item)}
            />
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>You're all caught up!</Text>}
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={() => setCaptureVisible(true)}>
        <Ionicons name="add" size={32} color="#fff" />
      </TouchableOpacity>

      <CaptureModal visible={captureVisible} onClose={() => setCaptureVisible(false)} />
      <SnoozeModal visible={!!snoozeItem} item={snoozeItem} onClose={() => setSnoozeItem(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: theme.spacing.m, paddingBottom: 100 },
  greeting: { ...theme.typography.h1, marginBottom: theme.spacing.l },
  statePanel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.l,
  },
  statBox: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.m,
    borderRadius: theme.radius.m,
    marginHorizontal: theme.spacing.xs,
    alignItems: 'center',
  },
  statValue: { ...theme.typography.h2 },
  statLabel: { ...theme.typography.caption, marginTop: 4 },
  focusBox: {
    backgroundColor: theme.colors.primary + '20', // transparent primary
    padding: theme.spacing.m,
    borderRadius: theme.radius.m,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    marginBottom: theme.spacing.xl,
  },
  focusLabel: { color: theme.colors.primary, fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 4 },
  focusText: { color: '#fff', fontSize: 16 },
  sectionTitle: { ...theme.typography.h2, marginBottom: theme.spacing.m },
  emptyText: { color: theme.colors.textMuted, textAlign: 'center', marginTop: theme.spacing.xxl },
  fab: {
    position: 'absolute',
    bottom: theme.spacing.xl,
    right: theme.spacing.l,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  }
});
