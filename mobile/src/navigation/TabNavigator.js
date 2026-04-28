import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import CommandCenterScreen from '../screens/CommandCenterScreen';
import TimelineScreen from '../screens/TimelineScreen';
import RecallScreen from '../screens/RecallScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { theme } from '../theme';

const Tab = createBottomTabNavigator();

export default function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === 'Today') iconName = focused ? 'home' : 'home-outline';
          else if (route.name === 'Timeline') iconName = focused ? 'time' : 'time-outline';
          else if (route.name === 'Recall') iconName = focused ? 'search' : 'search-outline';
          else if (route.name === 'Settings') iconName = focused ? 'settings' : 'settings-outline';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Today" component={CommandCenterScreen} />
      <Tab.Screen name="Timeline" component={TimelineScreen} />
      <Tab.Screen name="Recall" component={RecallScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}
