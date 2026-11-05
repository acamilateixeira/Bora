export const normalizeLoose = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const formatStateShort = (state?: string, stateCode?: string) => {
  if (stateCode) return stateCode.toUpperCase();
  const raw = (state || '').trim();
  if (!raw) return '';
  if (raw.length <= 2) return raw.toUpperCase();
  const map: Record<string, string> = {
    'acre': 'AC',
    'alagoas': 'AL',
    'amapa': 'AP',
    'amapá': 'AP',
    'amazonas': 'AM',
    'bahia': 'BA',
    'ceara': 'CE',
    'ceará': 'CE',
    'distrito federal': 'DF',
    'espirito santo': 'ES',
    'espírito santo': 'ES',
    'goias': 'GO',
    'goiás': 'GO',
    'maranhao': 'MA',
    'maranhão': 'MA',
    'mato grosso': 'MT',
    'mato grosso do sul': 'MS',
    'minas gerais': 'MG',
    'para': 'PA',
    'pará': 'PA',
    'paraiba': 'PB',
    'paraíba': 'PB',
    'parana': 'PR',
    'paraná': 'PR',
    'pernambuco': 'PE',
    'piaui': 'PI',
    'piauí': 'PI',
    'rio de janeiro': 'RJ',
    'rio grande do norte': 'RN',
    'rio grande do sul': 'RS',
    'rondonia': 'RO',
    'rondônia': 'RO',
    'roraima': 'RR',
    'santa catarina': 'SC',
    'sao paulo': 'SP',
    'são paulo': 'SP',
    'sergipe': 'SE',
    'tocantins': 'TO',
  };
  const key = raw.toLowerCase();
  return map[key] || raw;
};

export const formatLocalityLine = (opts: {
  neighborhood?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  postcode?: string;
}) => {
  const neighborhood = (opts.neighborhood || '').trim();
  const city = (opts.city || '').trim();
  const state = formatStateShort(opts.state, opts.stateCode);
  const cep = (opts.postcode || '').trim();
  return [neighborhood, city, state, cep].filter(Boolean).join(' - ');
};

export const formatPhotonAddress = (props: any) => {
  if (!props) return '';
  const street = [props.street, props.housenumber].filter(Boolean).join(', ');
  const locality = formatLocalityLine({
    neighborhood: props.district || props.suburb || props.neighbourhood || props.neighborhood || '',
    city: props.city || props.town || props.village || '',
    state: props.state || '',
    stateCode: props.statecode || props.state_code || '',
    postcode: props.postcode || '',
  });
  const parts = [street, locality].filter(Boolean);
  return parts.join(' • ') || props.name || '';
};

export const formatNominatimAddress = (addr: any) => {
  if (!addr) return '';
  const street = [addr.road, addr.house_number].filter(Boolean).join(', ');
  const locality = formatLocalityLine({
    neighborhood: addr.neighbourhood || addr.neighborhood || addr.suburb || addr.city_district || '',
    city: addr.city || addr.town || addr.village || addr.municipality || '',
    state: addr.state || '',
    stateCode: addr.state_code || '',
    postcode: addr.postcode || '',
  });
  const parts = [street, locality].filter(Boolean);
  return parts.join(' • ');
};

export const buildDisplay = (name: string, address: string, streetLine = '') => {
  const n = (name || '').trim();
  const a = (address || '').trim();
  const s = (streetLine || '').trim();
  if (!n) return a;
  const nNorm = normalizeLoose(n);
  const sNorm = normalizeLoose(s);
  if (sNorm && nNorm === sNorm) return a || n;
  if (a && !normalizeLoose(a).includes(nNorm)) return `${n} — ${a}`;
  if (a) return `${n} — ${a}`;
  return n;
};
