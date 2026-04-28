import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../stores/useAuthStore';
import { theme } from '../theme';

export default function SettingsScreen() {
  const { user, logout, updateProfile } = useAuthStore();

  const toggleTheme = () => {
    const newTheme = user?.settings?.theme === 'light' ? 'dark' : 'light';
    updateProfile({ settings: { ...user?.settings, theme: newTheme } }).catch(e => alert(e.message));
  };

  const toggleNotifications = () => {
    const newNotifs = !(user?.settings?.notifications ?? true);
    updateProfile({ settings: { ...user?.settings, notifications: newNotifs } }).catch(e => alert(e.message));
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Name</Text>
          <Text style={styles.value}>{user?.name}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.label}>Email</Text>
          <Text style={styles.value}>{user?.email}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Preferences</Text>
        <View style={styles.menuItem}>
          <Ionicons name="notifications-outline" size={22} color={theme.colors.text} />
          <Text style={styles.menuText}>Notifications</Text>
          <Switch 
            value={user?.settings?.notifications ?? true} 
            onValueChange={toggleNotifications}
            trackColor={{ false: theme.colors.surfaceHighlight, true: theme.colors.primary }}
          />
        </View>
        <View style={styles.menuItem}>
          <Ionicons name="color-palette-outline" size={22} color={theme.colors.text} />
          <Text style={styles.menuText}>Dark Theme</Text>
          <Switch 
            value={user?.settings?.theme !== 'light'} 
            onValueChange={toggleTheme}
            trackColor={{ false: theme.colors.surfaceHighlight, true: theme.colors.primary }}
          />
        </View>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
        <Ionicons name="log-out-outline" size={20} color={theme.colors.action} />
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.m },
  title: { ...theme.typography.h1, marginBottom: theme.spacing.xl },
  section: { marginBottom: theme.spacing.xl },
  sectionTitle: { ...theme.typography.caption, textTransform: 'uppercase', marginBottom: theme.spacing.m, color: theme.colors.primary },
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.m,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  label: { ...theme.typography.bodyMuted },
  value: { ...theme.typography.body },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.m,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  menuText: { flex: 1, ...theme.typography.body, marginLeft: theme.spacing.m },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.m,
    borderRadius: theme.radius.m,
    marginTop: theme.spacing.xxl,
  },
  logoutText: { color: theme.colors.action, fontWeight: '600', fontSize: 16, marginLeft: theme.spacing.s }
});
