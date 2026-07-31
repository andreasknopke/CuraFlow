function toIsoDate(value: string | number | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function addMonthsIso(value: string | null | undefined, months: number | null | undefined): string | null {
  if (!value || typeof months !== 'number' || !Number.isFinite(months) || months <= 0) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function compareIsoDate(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a.localeCompare(b);
}

export interface Certificate {
  id: string;
  granted_date?: string | Date | null;
  uploaded_at?: string | Date | null;
  expiry_date?: string | Date | null;
  evidence_role?: string | null;
}

export interface Qualification {
  certificate_requirement_mode?: string | null;
  certificate_validity_months?: number | null;
  certificate_refresh_validity_months?: number | null;
}

type RequirementMode = 'single_document' | 'base_refresh';

type EvidenceRole = 'single' | 'base' | 'refresh' | 'supplement' | 'recertification';

function deriveEffectiveFrom(certificate: Certificate): string | null {
  return toIsoDate(certificate?.granted_date) || toIsoDate(certificate?.uploaded_at);
}

function deriveEffectiveUntil(certificate: Certificate, validityMonths: number | null = null): string | null {
  const explicit = toIsoDate(certificate?.expiry_date);
  if (explicit) return explicit;
  const from = deriveEffectiveFrom(certificate);
  if (from && typeof validityMonths === 'number' && Number.isFinite(validityMonths) && validityMonths > 0) {
    return addMonthsIso(from, validityMonths);
  }
  return null;
}

export function normalizeRequirementMode(mode: unknown): RequirementMode {
  return mode === 'base_refresh' ? 'base_refresh' : 'single_document';
}

function isEvidenceRole(value: string): value is EvidenceRole {
  return ['single', 'base', 'refresh', 'supplement', 'recertification'].includes(value);
}

export function normalizeEvidenceRole(role: unknown, requirementMode: RequirementMode = 'single_document'): EvidenceRole {
  const normalized = String(role || '').trim().toLowerCase();
  if (isEvidenceRole(normalized)) {
    if (requirementMode === 'single_document' && normalized === 'base') {
      return 'single';
    }
    return normalized;
  }
  return requirementMode === 'base_refresh' ? 'base' : 'single';
}

export function getRequiredEvidenceRoles(qualification: Qualification = {}): EvidenceRole[] {
  const mode = normalizeRequirementMode(qualification?.certificate_requirement_mode);
  if (mode === 'base_refresh') {
    return ['base', 'refresh'];
  }
  return ['single'];
}

type NormalizedCertificate = Certificate & { evidence_role: EvidenceRole };

function withNormalizedRole(certificate: Certificate, requirementMode: RequirementMode): NormalizedCertificate {
  return {
    ...certificate,
    evidence_role: normalizeEvidenceRole(certificate?.evidence_role, requirementMode),
  };
}

export interface EvidenceSummary {
  status: 'missing' | 'incomplete' | 'expired' | 'valid';
  valid_from: string | null;
  valid_until: string | null;
  reason: string;
  missing_roles: EvidenceRole[];
  active_certificate_ids: string[];
  certificate_valid_until_by_id?: Record<string, string | null>;
}

interface SummaryInput {
  qualification: Qualification;
  certificates: NormalizedCertificate[];
  today: string;
}

function buildSingleSummary({ qualification, certificates, today }: SummaryInput): EvidenceSummary {
  if (!certificates.length) {
    return {
      status: 'missing',
      valid_from: null,
      valid_until: null,
      reason: 'Kein Nachweis hinterlegt.',
      missing_roles: ['single'],
      active_certificate_ids: [],
    };
  }

  const validityMonths = Number.isFinite(qualification?.certificate_validity_months)
    ? qualification.certificate_validity_months
    : null;

  const ranked = [...certificates].sort((left, right) => {
    const leftUntil = deriveEffectiveUntil(left, validityMonths) || '9999-12-31';
    const rightUntil = deriveEffectiveUntil(right, validityMonths) || '9999-12-31';
    if (leftUntil !== rightUntil) return rightUntil.localeCompare(leftUntil);
    const leftFrom = deriveEffectiveFrom(left) || '';
    const rightFrom = deriveEffectiveFrom(right) || '';
    return rightFrom.localeCompare(leftFrom);
  });

  const winner = ranked[0];
  const validFrom = deriveEffectiveFrom(winner);
  const validUntil = deriveEffectiveUntil(winner, validityMonths);
  const expired = !!validUntil && compareIsoDate(validUntil, today) < 0;

  return {
    status: expired ? 'expired' : 'valid',
    valid_from: validFrom,
    valid_until: validUntil,
    reason: expired
      ? `Nachweis abgelaufen am ${validUntil}.`
      : (validUntil ? `Nachweis gültig bis ${validUntil}.` : 'Nachweis ohne Ablaufdatum hinterlegt.'),
    missing_roles: [],
    active_certificate_ids: [winner.id],
    certificate_valid_until_by_id: winner.id ? { [winner.id]: validUntil } : {},
  };
}

interface ChainResult {
  baseCertificate: NormalizedCertificate;
  valid_from: string | null;
  valid_until: string | null;
  active_certificate_ids: string[];
  certificate_valid_until_by_id: Record<string, string | null>;
}

function buildBaseRefreshSummary({ qualification, certificates, today }: SummaryInput): EvidenceSummary {
  if (!certificates.length) {
    return {
      status: 'missing',
      valid_from: null,
      valid_until: null,
      reason: 'Es fehlt sowohl der Grundnachweis als auch ein Verlängerungsnachweis.',
      missing_roles: ['base', 'refresh'],
      active_certificate_ids: [],
      certificate_valid_until_by_id: {},
    };
  }

  const baseValidityMonths = Number.isFinite(qualification?.certificate_validity_months)
    ? qualification.certificate_validity_months
    : null;
  const refreshValidityMonths = Number.isFinite(qualification?.certificate_refresh_validity_months)
    ? qualification.certificate_refresh_validity_months
    : null;

  const baseCertificates = certificates.filter((certificate) => ['base', 'recertification', 'single'].includes(certificate.evidence_role));
  const refreshCertificates = certificates
    .filter((certificate) => certificate.evidence_role === 'refresh')
    .sort((left, right) => {
      const leftFrom = deriveEffectiveFrom(left) || '';
      const rightFrom = deriveEffectiveFrom(right) || '';
      return leftFrom.localeCompare(rightFrom);
    });

  if (!baseCertificates.length) {
    return {
      status: 'incomplete',
      valid_from: null,
      valid_until: null,
      reason: 'Es liegt nur eine Auffrischung vor, aber der erforderliche Grundnachweis fehlt.',
      missing_roles: ['base'],
      active_certificate_ids: refreshCertificates.map((certificate) => certificate.id),
      certificate_valid_until_by_id: {},
    };
  }

  const chains: ChainResult[] = baseCertificates.map((baseCertificate) => {
    const activeIds = [baseCertificate.id];
    const certificateValidUntilById: Record<string, string | null> = {};
    const baseFrom = deriveEffectiveFrom(baseCertificate);
    let validUntil = deriveEffectiveUntil(baseCertificate, baseValidityMonths);
    certificateValidUntilById[baseCertificate.id] = validUntil;

    for (const refreshCertificate of refreshCertificates) {
      const refreshFrom = deriveEffectiveFrom(refreshCertificate);
      if (!refreshFrom || (baseFrom && compareIsoDate(refreshFrom, baseFrom) < 0)) {
        continue;
      }

      const refreshUntil = deriveEffectiveUntil(
        refreshCertificate,
        Number.isFinite(refreshValidityMonths) ? refreshValidityMonths : baseValidityMonths
      );
      if (refreshUntil && (!validUntil || compareIsoDate(refreshUntil, validUntil) > 0)) {
        validUntil = refreshUntil;
        activeIds.push(refreshCertificate.id);
        certificateValidUntilById[refreshCertificate.id] = refreshUntil;
      }
    }

    return {
      baseCertificate,
      valid_from: baseFrom,
      valid_until: validUntil,
      active_certificate_ids: activeIds,
      certificate_valid_until_by_id: certificateValidUntilById,
    };
  });

  chains.sort((left, right) => {
    const leftUntil = left.valid_until || '9999-12-31';
    const rightUntil = right.valid_until || '9999-12-31';
    if (leftUntil !== rightUntil) return rightUntil.localeCompare(leftUntil);
    return (right.valid_from || '').localeCompare(left.valid_from || '');
  });

  const winner = chains[0];
  const expired = !!winner.valid_until && compareIsoDate(winner.valid_until, today) < 0;
  const usedRefreshes = Math.max(0, winner.active_certificate_ids.length - 1);
  const propagatedValidUntilById: Record<string, string | null> = { ...winner.certificate_valid_until_by_id };
  for (const certificateId of winner.active_certificate_ids) {
    propagatedValidUntilById[certificateId] = winner.valid_until;
  }

  return {
    status: expired ? 'expired' : 'valid',
    valid_from: winner.valid_from,
    valid_until: winner.valid_until,
    reason: expired
      ? `Nachweiskette abgelaufen am ${winner.valid_until || 'unbekannt'}.`
      : (winner.valid_until
          ? `Grundnachweis vorhanden${usedRefreshes ? `, ${usedRefreshes} Verlängerungsnachweis(e) berücksichtigt` : ''}. Gültig bis ${winner.valid_until}.`
          : `Grundnachweis vorhanden${usedRefreshes ? `, ${usedRefreshes} Verlängerungsnachweis(e) berücksichtigt` : ''}.`),
    missing_roles: [],
    active_certificate_ids: winner.active_certificate_ids,
    certificate_valid_until_by_id: propagatedValidUntilById,
  };
}

export interface ComputeSummaryOptions {
  qualification?: Qualification;
  certificates?: Certificate[];
  today?: string | number | Date | null;
}

export function computeQualificationEvidenceSummary({ qualification = {}, certificates = [], today = null }: ComputeSummaryOptions = {}): EvidenceSummary {
  const normalizedToday = toIsoDate(today) || new Date().toISOString().slice(0, 10);
  const requirementMode = normalizeRequirementMode(qualification?.certificate_requirement_mode);
  const normalizedCertificates: NormalizedCertificate[] = certificates.map((certificate) => withNormalizedRole(certificate, requirementMode));

  if (requirementMode === 'base_refresh') {
    return buildBaseRefreshSummary({
      qualification,
      certificates: normalizedCertificates,
      today: normalizedToday,
    });
  }

  return buildSingleSummary({
    qualification,
    certificates: normalizedCertificates,
    today: normalizedToday,
  });
}
