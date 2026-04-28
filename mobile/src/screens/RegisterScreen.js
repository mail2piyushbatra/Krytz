import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useAuthStore } from '../stores/useAuthStore';
import { theme } from '../theme';

export default function RegisterScreen({ navigation }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { register, isLoading, error } = useAuthStore();

  const handleRegister = async () => {
    if (!name || !email || !password) return;
    try {
      await register(name, email, password);
    } catch (e) {
      // Error handled by store
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      <View style={styles.form}>
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Join Flowra to map your daily operations.</Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <TextInput
          style={styles.input}
          placeholder="Full name"
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="words"
          value={name}
          onChangeText={setName}
        />

        <TextInput
          style={styles.input}
          placeholder="Email address"
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={theme.colors.textMuted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <TouchableOpacity style={styles.button} onPress={handleRegister} disabled={isLoading}>
          {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign up</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={styles.linkButton} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.linkText}>Already have an account? Log in</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center' },
  form: { padding: theme.spacing.xl },
  title: { ...theme.typography.h1, marginBottom: theme.spacing.xs },
  subtitle: { ...theme.typography.bodyMuted, marginBottom: theme.spacing.xl },
  error: { color: theme.colors.action, marginBottom: theme.spacing.m, fontSize: 14 },
  input: {
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    padding: theme.spacing.m,
    borderRadius: theme.radius.m,
    marginBottom: theme.spacing.m,
    fontSize: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  button: {
    backgroundColor: theme.colors.primary,
    padding: theme.spacing.m,
    borderRadius: theme.radius.m,
    alignItems: 'center',
    marginTop: theme.spacing.s,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkButton: { marginTop: theme.spacing.l, alignItems: 'center' },
  linkText: { color: theme.colors.textMuted, fontSize: 14 },
});
