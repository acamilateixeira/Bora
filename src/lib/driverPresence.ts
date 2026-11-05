export type DriverPresenceStatus = 'online' | 'offline' | 'busy';

export const PRESENCE_STALE_MS = 5 * 60 * 1000;

export const resolveDriverPresence = (args: {
  status?: string | null;
  statusUpdatedAt?: string | number | null;
  locationUpdatedAt?: string | number | null;
}) => {
  const toTs = (value?: string | number | null) => {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    const ts = new Date(value).getTime();
    return Number.isFinite(ts) ? ts : 0;
  };
  const statusTs = toTs(args.statusUpdatedAt);
  const locationTs = toTs(args.locationUpdatedAt);
  const lastUpdate = Math.max(statusTs, locationTs);
  const stale = !lastUpdate || Date.now() - lastUpdate > PRESENCE_STALE_MS;
  const raw = (args.status as DriverPresenceStatus) || 'offline';
  const effective: DriverPresenceStatus = stale ? 'offline' : raw;
  return { effective, stale, lastUpdate };
};
