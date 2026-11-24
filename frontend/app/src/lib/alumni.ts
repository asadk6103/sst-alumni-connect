export type Photo = { url: string; variants: { width: number; height: number; url: string }[] } | null;

export type Relation = { connection: 'sent' | 'received' | 'accepted' | null; connection_id: string | null; following: boolean };

export type PersonCard = Relation & {
  id: string; full_name: string; photo: Photo; kind: 'alumni' | 'student'; verified: boolean; graduation_year: number | null;
  batch: string | null; designation: string | null; organization: string | null; industry: string | null; city: string | null;
  country: string | null; reason?: string | null; request_id?: string; message?: string | null; since?: string;
};

export type Employment = { id: string; organization: string; designation: string; industry: string | null; location: string | null;
  start_date: string | null; end_date: string | null; is_current: boolean; description: string | null };
export type Education = { id: string; institution: string; qualification: string; field_of_study: string | null; start_year: number | null;
  end_year: number | null; is_sst: boolean; description: string | null };
export type Achievement = { id: string; kind: string; title: string; issuer: string | null; year: number | null; url: string | null;
  description: string | null };

export type ProfileDetail = PersonCard & {
  bio: string | null; admission_year: number | null; class_name: string | null; email: string | null; phone: string | null;
  date_of_birth: string | null; website: string | null; linkedin: string | null; verified_at: string | null; followers: number;
  connections: number; member_since: string; is_self: boolean; skills: string[]; employment: Employment[]; education: Education[];
  achievements: Achievement[];
};

export type Level = 'members' | 'connections' | 'only_me';
export type Doc = { id: string; filename: string; size: number; mime: string; created_at: string };

export type MyProfile = ProfileDetail & {
  gender: string | null; batch_id: string | null; registration_no: string | null; phone_verified: boolean;
  privacy: { visibility: 'members' | 'connections' | 'hidden'; sections: Record<string, Level> };
  privacy_sections: Record<string, string>;
  completion: number; completion_missing: { key: string; label: string; tab: string; weight: number }[];
  locked_fields: string[];
  verification: {
    status: 'pending' | 'verified' | 'rejected'; method: string | null; verified_at: string | null; rejection_reason: string | null;
    submitted_at: string | null; note: string | null; documents: Doc[]; documents_allowed: boolean;
  };
};

export type PublicBatch = { id: string; name: string; graduation_year: number };
export type RegistrationPolicy = {
  registration_open: boolean; allow_students: boolean; require_phone: boolean; require_registration_no: boolean;
  require_admission_year: boolean; founding_year: number; terms_url: string | null;
};

export const ACHIEVEMENT_KINDS: [string, string][] = [
  ['award', 'Award'], ['recognition', 'Recognition'], ['publication', 'Publication'], ['milestone', 'Professional milestone'],
  ['certification', 'Certification'],
];

export const METHOD_LABEL: Record<string, string> = {
  manual: 'Approved by an administrator', record_match: 'Matched with school records', institutional_code: 'Alumni office code',
  import: 'Invited from school records',
};

export function photoUrl(p: Photo | undefined, width: number) {
  if (!p) return undefined;
  return p.variants.find((v) => v.width >= width)?.url ?? p.url;
}

export function headline(c: Pick<PersonCard, 'designation' | 'organization'>) {
  if (c.designation && c.organization) return `${c.designation} at ${c.organization}`;
  return c.designation || c.organization || null;
}

export function place(c: Pick<PersonCard, 'city' | 'country'>) {
  return [c.city, c.country].filter(Boolean).join(', ') || null;
}

export function classLabel(c: Pick<PersonCard, 'batch' | 'graduation_year' | 'kind'>) {
  if (c.batch) return c.batch;
  if (!c.graduation_year) return null;
  return c.kind === 'student' ? `Graduating ${c.graduation_year}` : `Class of ${c.graduation_year}`;
}

export function yearsRange(from: number, to: number) {
  const out: number[] = [];
  for (let y = to; y >= from; y--) out.push(y);
  return out;
}

export function monthYear(d: string | null) {
  if (!d) return '';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
