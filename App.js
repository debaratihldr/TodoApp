import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Platform, Alert, StatusBar, Modal
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import DateTimePicker from '@react-native-community/datetimepicker';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const STORAGE_KEY = 'todo_tasks';

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [taskText, setTaskText] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const notificationListener = useRef();
  const responseListener = useRef();

  useEffect(() => {
    registerForPushNotifications();
    loadTasks();

    notificationListener.current = Notifications.addNotificationReceivedListener(() => {});
    responseListener.current = Notifications.addNotificationResponseReceivedListener(() => {});

    return () => {
      Notifications.removeNotificationSubscription(notificationListener.current);
      Notifications.removeNotificationSubscription(responseListener.current);
    };
  }, []);

  async function registerForPushNotifications() {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('task-reminders', {
        name: 'Task Reminders',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#6C63FF',
        sound: 'default',
      });
    }
    if (!Device.isDevice) return;
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      Alert.alert('Permission required', 'Enable notifications in Settings to get task reminders.');
    }
  }

  async function loadTasks() {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) setTasks(JSON.parse(stored));
    } catch (_) {}
  }

  async function saveTasks(updated) {
    setTasks(updated);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }

  async function scheduleNotification(task) {
    const triggerDate = new Date(task.datetime);
    if (triggerDate <= new Date()) return null;
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Task Reminder',
        body: task.text,
        sound: 'default',
        android: { channelId: 'task-reminders', priority: 'max' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
      },
    });
  }

  async function cancelNotification(notifId) {
    if (notifId) await Notifications.cancelScheduledNotificationAsync(notifId);
  }

  async function addOrUpdateTask() {
    if (!taskText.trim()) {
      Alert.alert('Error', 'Please enter a task name.');
      return;
    }

    if (editingTask) {
      await cancelNotification(editingTask.notifId);
      const updated = tasks.map(t => {
        if (t.id === editingTask.id) return { ...t, text: taskText, datetime: selectedDate.toISOString(), notifId: null };
        return t;
      });
      const idx = updated.findIndex(t => t.id === editingTask.id);
      const notifId = await scheduleNotification(updated[idx]);
      updated[idx].notifId = notifId;
      await saveTasks(updated);
    } else {
      const newTask = {
        id: Date.now().toString(),
        text: taskText,
        datetime: selectedDate.toISOString(),
        completed: false,
        notifId: null,
      };
      const notifId = await scheduleNotification(newTask);
      newTask.notifId = notifId;
      await saveTasks([...tasks, newTask]);
    }

    closeModal();
  }

  async function deleteTask(task) {
    await cancelNotification(task.notifId);
    await saveTasks(tasks.filter(t => t.id !== task.id));
  }

  async function toggleComplete(task) {
    const updated = tasks.map(t =>
      t.id === task.id ? { ...t, completed: !t.completed } : t
    );
    await saveTasks(updated);
  }

  function openAddModal() {
    setEditingTask(null);
    setTaskText('');
    setSelectedDate(new Date());
    setModalVisible(true);
  }

  function openEditModal(task) {
    setEditingTask(task);
    setTaskText(task.text);
    setSelectedDate(new Date(task.datetime));
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setTaskText('');
    setEditingTask(null);
    setShowDatePicker(false);
    setShowTimePicker(false);
  }

  function formatDateTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  function isPast(iso) {
    return new Date(iso) < new Date();
  }

  const pending = tasks.filter(t => !t.completed);
  const completed = tasks.filter(t => t.completed);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#6C63FF" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Tasks</Text>
        <Text style={styles.headerSub}>{pending.length} pending</Text>
      </View>

      <FlatList
        data={[...pending, ...completed]}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No tasks yet. Tap + to add one!</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.card, item.completed && styles.cardDone]}>
            <TouchableOpacity style={styles.checkbox} onPress={() => toggleComplete(item)}>
              <View style={[styles.checkboxInner, item.completed && styles.checkboxChecked]}>
                {item.completed && <Text style={styles.checkmark}>✓</Text>}
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cardBody} onPress={() => openEditModal(item)}>
              <Text style={[styles.taskText, item.completed && styles.taskDoneText]}>{item.text}</Text>
              <Text style={[styles.taskTime, isPast(item.datetime) && !item.completed && styles.taskOverdue]}>
                {isPast(item.datetime) && !item.completed ? '⚠ ' : '🕐 '}{formatDateTime(item.datetime)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => deleteTask(item)} style={styles.deleteBtn}>
              <Text style={styles.deleteText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      <TouchableOpacity style={styles.fab} onPress={openAddModal}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>{editingTask ? 'Edit Task' : 'New Task'}</Text>

            <TextInput
              style={styles.input}
              placeholder="What needs to be done?"
              placeholderTextColor="#aaa"
              value={taskText}
              onChangeText={setTaskText}
              multiline
            />

            <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowDatePicker(true)}>
              <Text style={styles.pickerBtnText}>📅  {selectedDate.toDateString()}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowTimePicker(true)}>
              <Text style={styles.pickerBtnText}>
                🕐  {selectedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </TouchableOpacity>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={addOrUpdateTask}>
                <Text style={styles.saveText}>{editingTask ? 'Update' : 'Add Task'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {showDatePicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display="default"
          minimumDate={new Date()}
          onChange={(event, date) => {
            setShowDatePicker(false);
            if (event.type !== 'dismissed' && date) {
              const merged = new Date(selectedDate);
              merged.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
              setSelectedDate(merged);
            }
          }}
        />
      )}

      {showTimePicker && (
        <DateTimePicker
          value={selectedDate}
          mode="time"
          display="default"
          onChange={(event, time) => {
            setShowTimePicker(false);
            if (event.type !== 'dismissed' && time) {
              const merged = new Date(selectedDate);
              merged.setHours(time.getHours(), time.getMinutes());
              setSelectedDate(merged);
            }
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F0F7' },
  header: { backgroundColor: '#6C63FF', paddingTop: 56, paddingBottom: 20, paddingHorizontal: 24 },
  headerTitle: { color: '#fff', fontSize: 28, fontWeight: '700' },
  headerSub: { color: '#D4D0FF', fontSize: 14, marginTop: 4 },
  list: { padding: 16, paddingBottom: 100 },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyText: { color: '#aaa', fontSize: 16 },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 12, padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardDone: { opacity: 0.6 },
  checkbox: { marginRight: 12 },
  checkboxInner: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2,
    borderColor: '#6C63FF', alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: '#6C63FF' },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  cardBody: { flex: 1 },
  taskText: { fontSize: 16, color: '#222', fontWeight: '500' },
  taskDoneText: { textDecorationLine: 'line-through', color: '#aaa' },
  taskTime: { fontSize: 12, color: '#888', marginTop: 4 },
  taskOverdue: { color: '#FF5252' },
  deleteBtn: { padding: 6 },
  deleteText: { color: '#ccc', fontSize: 16 },
  fab: {
    position: 'absolute', bottom: 48, right: 24,
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#6C63FF', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#6C63FF', shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabText: { color: '#fff', fontSize: 30, lineHeight: 34 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#222', marginBottom: 16 },
  input: {
    borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 10,
    padding: 12, fontSize: 15, color: '#222', minHeight: 60, marginBottom: 12,
  },
  pickerBtn: {
    borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 10,
    padding: 12, marginBottom: 10,
  },
  pickerBtnText: { fontSize: 15, color: '#444' },
  modalActions: { flexDirection: 'row', marginTop: 16, gap: 12 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#E0E0E0', alignItems: 'center' },
  cancelText: { color: '#666', fontWeight: '600' },
  saveBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#6C63FF', alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
