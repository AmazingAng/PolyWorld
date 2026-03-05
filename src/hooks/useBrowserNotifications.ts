"use client";

import { useState, useCallback, useEffect } from "react";

export function useBrowserNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermission(Notification.permission);
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return "denied" as const;
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, []);

  const sendNotification = useCallback(
    (title: string, options?: NotificationOptions) => {
      if (typeof window === "undefined" || !("Notification" in window)) return;
      if (Notification.permission !== "granted") return;
      try {
        new Notification(title, {
          icon: "/favicon.ico",
          ...options,
        });
      } catch {
        // Notification API unavailable
      }
    },
    []
  );

  return { permission, requestPermission, sendNotification };
}
