import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { api } from '../services/api';
import { useItemStore } from '../stores/useItemStore';
import { theme } from '../theme';

export default function CaptureModal({ visible, onClose }) {
  const [text, setText] = useState('');
  const [type, setType] = useState('capture');
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState([]);
  const loadData = useItemStore(state => state.loadData);

  const types = [
    { key: 'capture', label: '🧠 Dump' },
    { key: 'todo', label: '📋 Todo' },
    { key: 'done', label: '✅ Done' },
    { key: 'blocked', label: '🚫 Blocked' },
  ];

  const handleImagePick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled) {
      const asset = result.assets[0];
      setFiles([...files, { uri: asset.uri, name: asset.fileName || 'image.jpg', type: asset.mimeType || 'image/jpeg', size: asset.fileSize || 1024 }]);
    }
  };

  const handleDocPick = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'] });
    if (!result.canceled) {
      const asset = result.assets[0];
      setFiles([...files, { uri: asset.uri, name: asset.name, type: asset.mimeType || 'application/pdf', size: asset.size || 1024 }]);
    }
  };

  const handleCapture = async () => {
    if (!text.trim() && files.length === 0) return;
    setSaving(true);
    try {
      const uploadedKeys = [];
      const uploadedMeta = [];
      
      for (const f of files) {
        const urlRes = await api.files.getUploadUrl(f.name, f.type, f.size);
        const { uploadUrl, fileKey } = urlRes.data;
        
        const blob = await (await fetch(f.uri)).blob();
        await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': f.type } });
        
        uploadedKeys.push(fileKey);
        uploadedMeta.push({ fileName: f.name, fileType: f.type, fileSize: f.size });
      }

      const res = await api.entries.capture(text.trim(), { type, fileKeys: uploadedKeys, fileMeta: uploadedMeta });
      
      for (const key of uploadedKeys) {
        await api.files.confirm(key, res.data.entry.id);
      }

      setText('');
      setType('capture');
      setFiles([]);
      onClose();
      loadData(); // refresh list
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.title}>Capture</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={theme.colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.typeSelector}>
            {types.map(t => (
              <TouchableOpacity 
                key={t.key} 
                style={[styles.typeBtn, type === t.key && styles.typeBtnActive]}
                onPress={() => setType(t.key)}
              >
                <Text style={[styles.typeText, type === t.key && styles.typeTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.input}
            placeholder="What's on your mind?"
            placeholderTextColor={theme.colors.textMuted}
            multiline
            autoFocus
            value={text}
            onChangeText={setText}
          />

          {files.length > 0 && (
            <View style={styles.fileList}>
              {files.map((f, i) => (
                <View key={i} style={styles.fileBadge}>
                  <Ionicons name={f.type.includes('image') ? 'image' : 'document'} size={14} color={theme.colors.textMuted} />
                  <Text style={styles.fileText} numberOfLines={1}>{f.name}</Text>
                  <TouchableOpacity onPress={() => setFiles(files.filter((_, idx) => idx !== i))}>
                    <Ionicons name="close-circle" size={16} color={theme.colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <View style={styles.footer}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleImagePick}>
              <Ionicons name="image-outline" size={24} color={theme.colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={handleDocPick}>
              <Ionicons name="document-text-outline" size={24} color={theme.colors.textMuted} />
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.submitBtn} onPress={handleCapture} disabled={saving || (!text.trim() && files.length === 0)}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="arrow-up" size={20} color="#fff" />}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.l,
    borderTopRightRadius: theme.radius.l,
    padding: theme.spacing.l,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.m,
  },
  title: {
    ...theme.typography.h2,
  },
  typeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.s,
    marginBottom: theme.spacing.m,
  },
  typeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.round,
    backgroundColor: theme.colors.surfaceHighlight,
  },
  typeBtnActive: {
    backgroundColor: theme.colors.primary,
  },
  typeText: {
    color: theme.colors.textMuted,
    fontSize: 14,
  },
  typeTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  input: {
    ...theme.typography.body,
    height: 120,
    textAlignVertical: 'top',
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.m,
    padding: theme.spacing.m,
    marginBottom: theme.spacing.m,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtn: {
    padding: theme.spacing.s,
    marginRight: theme.spacing.s,
    backgroundColor: theme.colors.surfaceHighlight,
    borderRadius: theme.radius.round,
  },
  submitBtn: {
    backgroundColor: theme.colors.primary,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.s,
    marginBottom: theme.spacing.m,
  },
  fileBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceHighlight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.radius.s,
    gap: 4,
  },
  fileText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    maxWidth: 100,
  }
});
