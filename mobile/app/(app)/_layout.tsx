import React from 'react';
import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function AppLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="view-dashboard" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: 'Requests',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="clipboard-list" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="cog" size={size} color={color} />
          ),
        }}
      />
      {/* Hidden from tab bar — reachable via router.push from Settings/Dashboard */}
      <Tabs.Screen name="materials" options={{ href: null, title: 'Materials' }} />
      <Tabs.Screen name="battery-types" options={{ href: null, title: 'Battery Types' }} />
      <Tabs.Screen name="dispatches" options={{ href: null, title: 'Dispatches' }} />
      <Tabs.Screen name="receipts" options={{ href: null, title: 'Receipts' }} />
      <Tabs.Screen name="adjustments" options={{ href: null, title: 'Adjustments' }} />
    </Tabs>
  );
}
