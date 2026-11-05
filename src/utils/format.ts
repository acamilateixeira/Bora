export const onlyDigits = (value: string) => (value || '').replace(/\D/g, '');

export const normalizePhone = (value: string) => onlyDigits(value);

export const formatPhoneMask = (value: string) => {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 2) return digits;
  const ddd = digits.slice(0, 2);
  if (digits.length <= 6) return `(${ddd}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${ddd}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${ddd}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

export const formatPhone = (value?: string | null) => {
  if (!value) return '';
  return formatPhoneMask(value);
};

export const formatCpfMask = (value: string) => {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};

export const formatDateTime = (iso?: string | null) => {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export const formatLastSeen = (value?: string | null) => {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  const now = new Date();
  const diffMin = Math.max(0, Math.round((now.getTime() - dt.getTime()) / 60000));
  if (diffMin <= 60) return `há ${diffMin} min`;
  const sameDay =
    dt.getFullYear() === now.getFullYear() &&
    dt.getMonth() === now.getMonth() &&
    dt.getDate() === now.getDate();
  if (sameDay) return `Hoje às ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    dt.getFullYear() === yesterday.getFullYear() &&
    dt.getMonth() === yesterday.getMonth() &&
    dt.getDate() === yesterday.getDate();
  if (isYesterday) return `Ontem às ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  const sameYear = dt.getFullYear() === now.getFullYear();
  return dt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: sameYear ? undefined : 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const formatLastSeenShort = (value?: string | null) => {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  const now = new Date();
  const sameDay =
    dt.getFullYear() === now.getFullYear() &&
    dt.getMonth() === now.getMonth() &&
    dt.getDate() === now.getDate();
  if (sameDay) return `Hoje ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    dt.getFullYear() === yesterday.getFullYear() &&
    dt.getMonth() === yesterday.getMonth() &&
    dt.getDate() === yesterday.getDate();
  if (isYesterday) return `Ontem ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

export const requestStatusLabel = (status: string) => {
  const map: Record<string, string> = {
    open: 'Aberta',
    approved: 'Aprovada',
    assigned: 'Atribuída',
    in_progress: 'Em andamento',
    done: 'Concluída',
    cancelled: 'Cancelada',
  };
  return map[status] || status;
};
