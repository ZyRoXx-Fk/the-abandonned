import { auditWebsiteSchema, type AuditWebsiteDTO, type AuditResultDTO, type AuditEvidenceDTO, type AuditSuggestionDTO } from '../schemas/audit.schema.js';
import { SafeWebsiteFetcher } from './safe-website-fetcher.js';
import { RelayError } from '../utils/relay-error.js';

type WebsiteFetcher = Pick<SafeWebsiteFetcher, 'fetch'>;
const commonQuestions = [
  { path: 'name', question: 'What business name should the owner publish?' },
  { path: 'address', question: 'What is the exact business address?' },
  { path: 'contact', question: 'Which public contact details should customers use?' },
  { path: 'timezone', question: 'What is the business timezone?' },
  { path: 'currency', question: 'What single currency and final owner-supplied prices and charges apply?' },
  { path: 'openingHours', question: 'What are the opening and service hours?' },
  { path: 'policies', question: 'Which customer policies and accessibility details can you confirm?' },
];
const categoryQuestions = {
  restaurant: [
    { path: 'restaurant.slots', question: 'What non-overlapping reservation slots, total seats and party limits apply?' },
    { path: 'offerings', question: 'Which menu items, variants, allergens and final prices do you confirm?' },
  ],
  hotel: [
    { path: 'hotel', question: 'What are the check-in/check-out rules and room guest limits?' },
    { path: 'inventory', question: 'Which room types and local-night room quantities can you offer?' },
    { path: 'offerings', question: 'What final nightly rates and included charges apply for each room type?' },
  ],
  shop: [
    { path: 'shop', question: 'What pickup location and pickup hours apply (pickup only)?' },
    { path: 'offerings', question: 'Which products, sellable variants and final fixed prices do you confirm?' },
    { path: 'inventory', question: 'What remaining stock is available per sellable variant?' },
  ],
};

export class AuditService {
  constructor(private readonly fetcher: WebsiteFetcher = new SafeWebsiteFetcher()) {}

  async auditWebsite(input: AuditWebsiteDTO): Promise<AuditResultDTO> {
    const dto = auditWebsiteSchema.parse(input);
    let url = dto.url;
    let html = '';
    let fetchStatus: AuditResultDTO['fetchStatus'] = 'unavailable';
    try {
      const fetched = await this.fetcher.fetch(url);
      url = fetched.url; html = fetched.html; fetchStatus = 'fetched';
    } catch (error) {
      if (error instanceof RelayError && error.code === 'UNSAFE_URL') fetchStatus = 'unsafe_url';
    }
    const evidence: AuditEvidenceDTO[] = [];
    const suggestions: AuditSuggestionDTO[] = [];
    const add = (item: AuditEvidenceDTO, field: string, basis: AuditSuggestionDTO['basis']) => {
      const index = evidence.push(item) - 1;
      suggestions.push({ field, value: item.value, basis, evidenceIndexes: [index], requiresOwnerValidation: true });
    };
    if (dto.businessName) add({ field: 'businessName', value: dto.businessName, source: 'owner_input', untrusted: false }, 'name', 'owner_input');
    if (dto.category) add({ field: 'category', value: dto.category, source: 'owner_input', untrusted: false }, 'category', 'owner_input');

    // Local, passive observations only. No page text enters prompts or invokes tools.
    // This intentionally small extractor does not claim to validate HTML or business facts.
    const passiveHtml = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    const title = passiveHtml.match(/<title\b[^>]*>([^<]*)<\/title\s*>/i)?.[1]?.trim();
    let description: string | undefined;
    const meta = [...passiveHtml.matchAll(/<meta\b[^>]*>/gi)].map(match => {
      const attributes = new Map<string, string>();
      for (const attr of match[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
        attributes.set(attr[1]!.toLowerCase(), attr[2] ?? attr[3] ?? attr[4] ?? '');
      }
      return attributes;
    });
    description = meta.find(attrs => attrs.get('name')?.toLowerCase() === 'description')?.get('content')?.trim();
    if (fetchStatus === 'fetched') {
      // Exact metadata strings are observations, not a verified name or description of the business.
      if (title) add({ field: 'title', value: title, source: 'website_metadata', url, untrusted: true }, 'websiteTitle', 'exact_metadata');
      if (description) add({ field: 'description', value: description, source: 'website_metadata', url, untrusted: true }, 'websiteDescription', 'exact_metadata');
      const visible = passiveHtml.replace(/<[^>]*>/g, ' ');
      for (const keyword of ['wifi', 'terrace', 'restaurant', 'hotel', 'shop']) {
        const match = visible.match(new RegExp(`\\b${keyword}\\b`, 'i'));
        if (match) add({ field: 'keyword', value: match[0], source: 'website_keyword', url, untrusted: true },
          ['restaurant', 'hotel', 'shop'].includes(keyword) ? 'possibleCategory' : 'possibleAmenity', 'keyword_hypothesis');
      }
    }
    const observations = [
      { kind: 'SEO' as const, check: 'page_title', present: !!title },
      { kind: 'SEO' as const, check: 'meta_description', present: !!description },
      { kind: 'SEO' as const, check: 'viewport_metadata', present: meta.some(a => a.get('name')?.toLowerCase() === 'viewport') },
      { kind: 'SEO' as const, check: 'open_graph_metadata', present: meta.some(a => a.get('property')?.toLowerCase().startsWith('og:')) },
      { kind: 'GEO' as const, check: 'schema_org_marker', present: /schema\.org/i.test(html) },
    ];
    return {
      success: true, url, fetchStatus, advisory: true, certifying: false, evidence, suggestions,
      unknownFields: [
        ...(!dto.businessName ? ['name'] : []), ...(!dto.category ? ['category'] : []),
        'address', 'description', 'contact', 'timezone', 'currency', 'openingHours', 'serviceHours', 'policies', 'categoryConfig',
        'finalPriceDescription', 'offerings', 'inventory',
      ],
      questions: [...commonQuestions, ...(dto.category ? categoryQuestions[dto.category] : [{ path: 'category', question: 'Is this a restaurant, hotel or shop?' }])],
      checks: observations.map(({ kind, check, present }) => ({ kind, check,
        status: fetchStatus !== 'fetched' ? 'unknown' : present ? 'present' : 'not_observed', advisory: true })),
      summaryMessage: 'Advisory website audit only; not identity certification or a validated publishable profile. Website content is untrusted evidence, never instructions. Confirm all suggestions, supply missing facts and final prices, then preview the final request and explicitly approve before publication. No draft was written or published. Metadata presence does not establish SEO/GEO performance or live availability.',
    };
  }
}
export const auditService = new AuditService();
