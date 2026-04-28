import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, TouchableWithoutFeedback } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { api } from '../services/api';
import { useItemStore } from '../stores/useItemStore';

export default function SnoozeModal({ visible, item, onClose }) {
  const loadData = useItemStore(state => state.loadData);

  const handleSnooze = async (days) => {
    if (!item) return;
    const newDeadline = new Date();
    newDeadline.setDate(newDeadline.getDate() + days);
    
    try {
      await api.items.update(item.id, { deadline: newDeadline.toISOString() });
      loadData();
      onClose();
    } catch (e) {
      alert('Failed to snooze: ' + e.message);
    }
  };

  const options = [
    { label: 'Tomorrow', days: 1, icon: 'sunny-outline' },
    { label: 'This Weekend', days: 5, icon: 'cafe-outline' },
    { label: 'Next Week', days: 7, icon: 'calendar-outline' },
    { label: 'Someday (30 days)', days: 30, icon: 'cloud-outline' },
  ];

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.modalContent}>
              <Text style={styles.title}>Snooze Item</Text>
              <Text style={styles.subtitle} numberOfLines={2}>{item?.text}</Text>
              
              <View style={styles.options}>
                {options.map((opt, i) => (
                  <TouchableOpacity key={i} style={styles.optionBtn} onPress={() => handleSnooze(opt.days)}>
                    <Ionicons name={opt.icon} size={24} color={theme.colors.primary} />
                    <Text style={styles.optionText}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  modalContent: {
    backgroundColor: theme.colors.surfaceHighlight,
    borderRadius: theme.radius.l,
    padding: theme.spacing.l,
  },
  title: {
    ...theme.typography.h2,
    marginBottom: theme.spacing.xs,
  },
  subtitle: {
    ...theme.typography.bodyMuted,
    marginBottom: theme.spacing.l,
  },
  options: {
    gap: theme.spacing.s,
  },
  optionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.m,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.m,
  },
  optionText: {
    ...theme.typography.body,
    marginLeft: theme.spacing.m,
  }
});
