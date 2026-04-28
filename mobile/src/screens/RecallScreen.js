import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { theme } from '../theme';

export default function RecallScreen() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await api.recall.query(query.trim());
      setResult(res.data);
    } catch (e) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Recall</Text>
      <Text style={styles.subtitle}>Ask Flowra anything about your life, meetings, or plans.</Text>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={20} color={theme.colors.textMuted} style={styles.searchIcon} />
        <TextInput 
          style={styles.input}
          placeholder="What did I decide about the Q3 budget?"
          placeholderTextColor={theme.colors.textMuted}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={20} color={theme.colors.textMuted} style={styles.clearIcon} />
          </TouchableOpacity>
        )}
      </View>

      {loading && <View style={styles.center}><ActivityIndicator color={theme.colors.primary} /></View>}

      {result && (
        <FlatList
          data={[]}
          ListHeaderComponent={
            <View style={styles.resultContainer}>
              <View style={styles.answerBox}>
                <Ionicons name="sparkles" size={20} color={theme.colors.primary} style={styles.sparkle} />
                <Text style={styles.answerText}>{result.answer}</Text>
              </View>
              {result.references?.length > 0 && (
                <View style={styles.refsBox}>
                  <Text style={styles.refsTitle}>Sources</Text>
                  {result.references.map((ref, idx) => (
                    <Text key={idx} style={styles.refItem}>• {ref.text}</Text>
                  ))}
                </View>
              )}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.m },
  center: { marginTop: theme.spacing.xl, alignItems: 'center' },
  title: { ...theme.typography.h1 },
  subtitle: { ...theme.typography.bodyMuted, marginBottom: theme.spacing.l, marginTop: theme.spacing.xs },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.m,
    paddingHorizontal: theme.spacing.m,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.m,
  },
  searchIcon: { marginRight: theme.spacing.s },
  input: { flex: 1, color: theme.colors.text, fontSize: 16, paddingVertical: theme.spacing.m },
  clearIcon: { marginLeft: theme.spacing.s },
  resultContainer: { marginTop: theme.spacing.m },
  answerBox: {
    backgroundColor: theme.colors.primary + '15',
    padding: theme.spacing.l,
    borderRadius: theme.radius.m,
    borderWidth: 1,
    borderColor: theme.colors.primary + '30',
  },
  sparkle: { marginBottom: theme.spacing.s },
  answerText: { ...theme.typography.body, lineHeight: 24 },
  refsBox: { marginTop: theme.spacing.l },
  refsTitle: { ...theme.typography.caption, textTransform: 'uppercase', marginBottom: theme.spacing.s },
  refItem: { ...theme.typography.bodyMuted, marginBottom: theme.spacing.s, fontSize: 13, lineHeight: 20 },
});
