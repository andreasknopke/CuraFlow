/**
 * CuraFlow — Qualification Evidence Logic
 *
 * Computes qualification evidence summaries: single-document mode and
 * base_refresh mode (Grundnachweis + Auffrischung chain).
 *
 * @module lib/qualificationEvidence
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type RequirementMode = 'single_document' | 'base_refresh';
export type EvidenceRole = 'single' | 'base' | 'refresh' | 'supplement' | 'recertification';
export type EvidenceStatus = 'valid' | 'expired' | 'missing' | 'incomplete';

export interface Qualification {
  certificate_requirement_mode?: string | null;
  certificate_validity_months?: number | null;
  certificate_refresh_validity_months?: number | null;
}

export interface Certificate {
  id?: string | number;
  evidence_role?: string | null;
  granted_date?: string | null;
  expiry_date?: string | null;
  uploaded_at?: string | null;
}

export interface EvidenceSummary {
  status: EvidenceStatus;
  valid_from: string | null;
  valid_until: string | null;
  reason: string;
  missing_roles: EvidenceRole[];
  active_certificate_ids: (string | number)[];
  certificate_valid_until_by_id: Record<string, string | null>;
}

interface ComputeParams {
  qualification?: Qualification | null;
  certificates?: Certificate[] | null;
  today?: string | null;
}

interface CertificateWithRole extends Certificate {
  evidence_role: EvidenceRole;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const parsed = new Date(value as string | number | Date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function addMonthsIso(value: string | null, months: number): string | null {
  if (!value || !Number.isFinite(months) || months <= 0) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function compareIsoDate(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a.localeCompare(b);
}

function deriveEffectiveFrom(certificate: Certificate | null | undefined): string | null {
  return toIsoDate(certificate?.granted_date) || toIsoDate(certificate?.uploaded_at);
}

function deriveEffectiveUntil(
  certificate: Certificate | null | undefined,
  validityMonths: number | null,
): string | null {
  const explicit = toIsoDate(certificate?.expiry_date);
  if (explicit) return explicit;
  const from = deriveEffectiveFrom(certificate);
  if (from && Number.isFinite(validityMonths) && (validityMonths as number) > 0) {
    return addMonthsIso(from, validityMonths as number);
  }
  return null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function normalizeRequirementMode(mode: string | null | undefined): RequirementMode {
  return mode === 'base_refresh' ? 'base_refresh' : 'single_document';
}

export function normalizeEvidenceRole(
  role: string | null | undefined,
  requirementMode: RequirementMode = 'single_document',
): EvidenceRole {
  const normalized = String(role || '').trim().toLowerCase();
  if (['single', 'base', 'refresh', 'supplement', 'recertification'].includes(normalized)) {
    if (requirementMode === 'single_document' && normalized === 'base') {
      return 'single';
    }
    return normalized as EvidenceRole;
  }
  return requirementMode === 'base_refresh' ? 'base' : 'single';
}

export function getRequiredEvidenceRoles(qualification: Qualification = {}): EvidenceRole[] {
  const mode = normalizeRequirementMode(qualification?.certificate_requirement_mode);
  return mode === 'base_refresh' ? ['base', 'refresh'] : ['single'];
}

function withNormalizedRole(
  certificate: Certificate,
  requirementMode: RequirementMode,
): CertificateWithRole {
  return {
    ...certificate,
    evidence_role: normalizeEvidenceRole(certificate?.evidence_role, requirementMode),
  };
}

/**
 * Computes a qualification evidence summary from certificates.
 *
 * - **single_document** mode: picks the best certificate (latest expiry).
 * - **base_refresh** mode: chains base certificates with refresh certificates,
 *   extending validity as far as the chain supports.
 */
export function computeQualificationEvidenceSummary({
  qualification = {},
  certificates = [],
  today = null,
}: ComputeParams): EvidenceSummary {
  const normalizedToday =
    toIsoDate(today) || new Date().toISOString().slice(0, 10);
  const requirementMode = normalizeRequirementMode(
    qualification?.certificate_requirement_mode,
  );
  const normalizedCertificates = (certificates || []).map((cert) =>
    withNormalizedRole(cert, requirementMode),
  );

  // ── base_refresh mode ────────────────────────────────────────────────────
  if (requirementMode === 'base_refresh') {
    if (!normalizedCertificates.length) {
      return {
        status: 'missing',
        valid_from: null,
        valid_until: null,
        reason:
          'Es fehlt sowohl der Grundnachweis als auch ein Verlängerungsnachweis.',
        missing_roles: ['base', 'refresh'],
        active_certificate_ids: [],
        certificate_valid_until_by_id: {},
      };
    }

    const baseValidityMonths = Number.isFinite(qualification?.certificate_validity_months)
      ? (qualification!.certificate_validity_months as number)
      : null;
    const refreshValidityMonths = Number.isFinite(qualification?.certificate_refresh_validity_months)
      ? (qualification!.certificate_refresh_validity_months as number)
      : null;

    const bases = normalizedCertificates.filter((cert) =>
      ['base', 'recertification', 'single'].includes(cert.evidence_role),
    );
    const refreshes = normalizedCertificates
      .filter((cert) => cert.evidence_role === 'refresh')
      .sort((left, right) =>
        (deriveEffectiveFrom(left) || '').localeCompare(deriveEffectiveFrom(right) || ''),
      );

    if (!bases.length) {
      return {
        status: 'incomplete',
        valid_from: null,
        valid_until: null,
        reason:
          'Es liegt nur eine Auffrischung vor, aber der erforderliche Grundnachweis fehlt.',
        missing_roles: ['base'],
        active_certificate_ids: refreshes.map((cert) => cert.id!),
        certificate_valid_until_by_id: {},
      };
    }

    // Build chains: each base + applicable refreshes
    const chains = bases.map((baseCertificate) => {
      const activeIds: (string | number)[] = [baseCertificate.id!];
      const certificateValidUntilById: Record<string, string | null> = {};
      const baseFrom = deriveEffectiveFrom(baseCertificate);
      let validUntil = deriveEffectiveUntil(baseCertificate, baseValidityMonths);
      certificateValidUntilById[String(baseCertificate.id!)] = validUntil;

      for (const refreshCertificate of refreshes) {
        const refreshFrom = deriveEffectiveFrom(refreshCertificate);
        if (!refreshFrom || (baseFrom && compareIsoDate(refreshFrom, baseFrom) < 0))
          continue;

        const refreshUntil = deriveEffectiveUntil(
          refreshCertificate,
          Number.isFinite(refreshValidityMonths) ? refreshValidityMonths : baseValidityMonths,
        );
        if (refreshUntil && (!validUntil || compareIsoDate(refreshUntil, validUntil) > 0)) {
          validUntil = refreshUntil;
          activeIds.push(refreshCertificate.id!);
          certificateValidUntilById[String(refreshCertificate.id!)] = refreshUntil;
        }
      }

      return {
        valid_from: baseFrom,
        valid_until: validUntil,
        active_certificate_ids: activeIds,
        certificate_valid_until_by_id: certificateValidUntilById,
      };
    }).sort((left, right) => {
      const leftUntil = left.valid_until || '9999-12-31';
      const rightUntil = right.valid_until || '9999-12-31';
      if (leftUntil !== rightUntil) return rightUntil.localeCompare(leftUntil);
      return (right.valid_from || '').localeCompare(left.valid_from || '');
    });

    const winner = chains[0];
    const expired =
      !!winner.valid_until &&
      compareIsoDate(winner.valid_until, normalizedToday) < 0;
    const usedRefreshes = Math.max(0, winner.active_certificate_ids.length - 1);
    const propagatedValidUntilById: Record<string, string | null> = {
      ...winner.certificate_valid_until_by_id,
    };
    for (const certificateId of winner.active_certificate_ids) {
      propagatedValidUntilById[String(certificateId)] = winner.valid_until;
    }

    return {
      status: expired ? 'expired' : 'valid',
      valid_from: winner.valid_from,
      valid_until: winner.valid_until,
      reason: expired
        ? `Nachweiskette abgelaufen am ${winner.valid_until || 'unbekannt'}.`
        : winner.valid_until
          ? `Grundnachweis vorhanden${usedRefreshes ? `, ${usedRefreshes} Verlängerungsnachweis(e) berücksichtigt` : ''}. Gültig bis ${winner.valid_until}.`
          : `Grundnachweis vorhanden${usedRefreshes ? `, ${usedRefreshes} Verlängerungsnachweis(e) berücksichtigt` : ''}.`,
      missing_roles: [],
      active_certificate_ids: winner.active_certificate_ids,
      certificate_valid_until_by_id: propagatedValidUntilById,
    };
  }

  // ── single_document mode ─────────────────────────────────────────────────
  if (!normalizedCertificates.length) {
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
    ? (qualification!.certificate_validity_months as number)
    : null;

  const winner = [...normalizedCertificates].sort((left, right) => {
    const leftUntil = deriveEffectiveUntil(left, validityMonths) || '9999-12-31';
    const rightUntil =
      deriveEffectiveUntil(right, validityMonths) || '9999-12-31';
    if (leftUntil !== rightUntil) return rightUntil.localeCompare(leftUntil);
    return (
      (deriveEffectiveFrom(right) || '').localeCompare(deriveEffectiveFrom(left) || '')
    );
  })[0];

  const validUntil = deriveEffectiveUntil(winner, validityMonths);
  const expired = !!validUntil && compareIsoDate(validUntil, normalizedToday) < 0;

  return {
    status: expired ? 'expired' : 'valid',
    valid_from: deriveEffectiveFrom(winner),
    valid_until: validUntil,
    reason: expired
      ? `Nachweis abgelaufen am ${validUntil}.`
      : validUntil
        ? `Nachweis gültig bis ${validUntil}.`
        : 'Nachweis ohne Ablaufdatum hinterlegt.',
    missing_roles: [],
    active_certificate_ids: [winner.id!],
    certificate_valid_until_by_id: winner.id
      ? { [String(winner.id)]: validUntil }
      : {},
  };
}
