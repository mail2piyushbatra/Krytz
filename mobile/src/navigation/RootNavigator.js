import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import TabNavigator from './TabNavigator';
import { useAuthStore } from '../stores/useAuthStore';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  const { token } = useAuthStore();

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {token === null || token === undefined ? (
        // Auth Stack
        <Stack.Group>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
        </Stack.Group>
      ) : (
        // Main App Stack
        <Stack.Group>
          <Stack.Screen name="Main" component={TabNavigator} />
        </Stack.Group>
      )}
    </Stack.Navigator>
  );
}
