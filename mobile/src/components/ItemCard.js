import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';

export default function ItemCard({ item, onDone, onBlocker, onSnooze, index = 0 }) {
  const slideAnim = useRef(new Animated.Value(30)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 350,
        delay: Math.min(index * 50, 500),
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 350,
        delay: Math.min(index * 50, 500),
        useNativeDriver: true,
      })
    ]).start();
  }, []);
  const isOverdue = item.deadline && new Date(item.deadline) < new Date();

  return (
    <Animated.View style={[styles.card, item.blocker && styles.cardBlocker, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <TouchableOpacity onPress={onDone} style={styles.checkbox}>
        <Ionicons name="checkmark-circle-outline" size={24} color={theme.colors.textMuted} />
      </TouchableOpacity>
      
      <View style={styles.content}>
        <Text style={styles.text}>{item.text}</Text>
        <View style={styles.badges}>
          {item.blocker && <Text style={[styles.badge, styles.badgeBlocker]}>blocker</Text>}
          {item.category && item.category !== 'uncategorized' && (
            <Text style={[styles.badge, styles.badgeTag]}>{item.category}</Text>
          )}
          {isOverdue && <Text style={[styles.badge, styles.badgeOverdue]}>overdue</Text>}
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity onPress={onSnooze} style={styles.actionBtn}>
          <Ionicons name="alarm-outline" size={20} color={theme.colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onBlocker} style={styles.actionBtn}>
          <Ionicons name={item.blocker ? "close-circle" : "warning-outline"} size={20} color={item.blocker ? theme.colors.textMuted : theme.colors.warning} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceHighlight,
    padding: theme.spacing.m,
    borderRadius: theme.radius.m,
    marginBottom: theme.spacing.s,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  cardBlocker: {
    borderLeftColor: theme.colors.warning,
  },
  checkbox: {
    marginRight: theme.spacing.m,
  },
  content: {
    flex: 1,
  },
  text: {
    ...theme.typography.body,
    marginBottom: theme.spacing.xs,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  badge: {
    fontSize: 10,
    fontWeight: '600',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: theme.radius.s,
    overflow: 'hidden',
    textTransform: 'uppercase',
  },
  badgeBlocker: {
    backgroundColor: 'rgba(212, 155, 75, 0.2)',
    color: theme.colors.warning,
  },
  badgeTag: {
    backgroundColor: theme.colors.tag,
    color: theme.colors.textMuted,
  },
  badgeOverdue: {
    backgroundColor: 'rgba(212, 87, 75, 0.2)',
    color: theme.colors.action,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtn: {
    padding: theme.spacing.xs,
    marginLeft: theme.spacing.xs,
  }
});
