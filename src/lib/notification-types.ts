/** Serializable notification data shared by the server feed and bell drawer. */
export type NotificationItem = {
  id: string;
  category: string;
  severity: string;
  status: string;
  title: string;
  message: string;
  createdAt: string;
  assetCode: string | null;
  driverName: string | null;
  actionUrl: string | null;
};

export type NotificationFeed = {
  items: NotificationItem[];
  /** Open warning/critical items, not a misleading count of every historical log row. */
  attentionCount: number;
};
