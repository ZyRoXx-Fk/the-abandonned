import {
  AuditWebsiteDTO,
  AuditResultDTO,
  AuditReportDTO,
  DraftMcpProfile,
} from "../schemas/audit.schema.js";

export class AuditService {
  async auditWebsite(dto: AuditWebsiteDTO): Promise<AuditResultDTO> {
    const rawUrl = dto.url.trim();
    const normalizedUrl = rawUrl.startsWith("http://") || rawUrl.startsWith("https://")
      ? rawUrl
      : `https://${rawUrl}`;

    let htmlContent = "";
    let fetchSuccessful = false;

    try {
      const response = await fetch(normalizedUrl, {
        signal: AbortSignal.timeout(3500),
        headers: {
          "User-Agent": "The-Abandonned-MCP-Auditor/1.0 (+https://the-abandonned.adobe.baselhack)",
          Accept: "text/html,application/xhtml+xml",
        },
      });

      if (response.ok) {
        htmlContent = await response.text();
        fetchSuccessful = true;
      }
    } catch {
      fetchSuccessful = false;
    }

    const report = this.analyzeHtml(normalizedUrl, htmlContent, dto.businessName, fetchSuccessful);
    const summaryMessage = this.generateSummaryMessage(report);

    return {
      success: true,
      url: normalizedUrl,
      report,
      summaryMessage,
    };
  }

  private analyzeHtml(
    url: string,
    html: string,
    providedName?: string,
    isLiveFetch: boolean = false
  ): AuditReportDTO {
    const lowerHtml = html.toLowerCase();

    // 1. Title Extraction
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const rawTitle = titleMatch ? titleMatch[1].trim() : undefined;

    // 2. Meta description extraction
    const descMatch =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    const description = descMatch ? descMatch[1].trim() : undefined;

    // 3. Technical Structure Checks
    const hasSchemaOrg = lowerHtml.includes("schema.org/restaurant") || lowerHtml.includes('"@type":"restaurant"');
    const hasOpenGraph = lowerHtml.includes('property="og:') || lowerHtml.includes("property='og:");
    const hasViewport = lowerHtml.includes('name="viewport"') || lowerHtml.includes("name='viewport'");

    // 4. Content / Keyword Detection
    const detectedKeywords: string[] = [];
    const amenities: string[] = [];

    if (/terrasse|terrace|outdoor|garten|garden/.test(lowerHtml)) {
      detectedKeywords.push("terrace");
      amenities.push("terrace");
    }
    if (/chien|hund|pet|dog|animaux/.test(lowerHtml)) {
      detectedKeywords.push("pets allowed");
      amenities.push("dog_friendly");
    }
    if (/wifi|wi-fi|w-lan|internet/.test(lowerHtml)) {
      detectedKeywords.push("wifi");
      amenities.push("wifi");
    }
    if (/handicap|wheelchair|accessib|rollstuhl/.test(lowerHtml)) {
      detectedKeywords.push("wheelchair accessible");
      amenities.push("accessible");
    }

    // Detect cuisine type
    let cuisine = "Swiss";
    if (/fondue|raclette|rösti|schweiz|suisse|swiss/.test(lowerHtml)) {
      cuisine = "Swiss";
    } else if (/pizza|pasta|trattoria|italien|ristorante|italian/.test(lowerHtml)) {
      cuisine = "Italian";
    } else if (/brasserie|bistrot|bistro|français|french/.test(lowerHtml)) {
      cuisine = "Brasserie";
    } else if (/sushi|ramen|japonais|japanese/.test(lowerHtml)) {
      cuisine = "Japanese";
    } else if (/tapas|paella|espagnol|spanish/.test(lowerHtml)) {
      cuisine = "Spanish";
    }

    // 5. Score Calculation
    let agentReadinessScore = 20;
    if (hasSchemaOrg) agentReadinessScore += 35;
    if (hasOpenGraph) agentReadinessScore += 15;
    if (hasViewport) agentReadinessScore += 10;
    if (description) agentReadinessScore += 10;
    if (amenities.length > 0) agentReadinessScore += 10;
    agentReadinessScore = Math.min(100, agentReadinessScore);

    const seoScore = isLiveFetch
      ? (hasViewport ? 30 : 0) + (description ? 35 : 0) + (rawTitle ? 35 : 0)
      : 30;

    const isWebsiteLegacy = !hasSchemaOrg || agentReadinessScore < 60;

    // 6. Missing Data for AI Agents
    const missingData: string[] = [
      "Real-time terrace opening status (weather/rain dependent)",
      "Live available seating capacity",
      "Explicit pet policy",
      "Dietary and allergen options (gluten-free, vegetarian, vegan)",
      "Live MCP stream queryable by ChatGPT and Claude without hallucination",
    ];

    if (!amenities.includes("accessible")) {
      missingData.push("Wheelchair accessibility (PRM)");
    }

    // 7. Deduce Business Name
    let businessName = providedName;
    if (!businessName && rawTitle) {
      businessName = rawTitle.split(/[-|–•]/)[0].trim();
    }
    if (!businessName) {
      try {
        const parsed = new URL(url);
        businessName = parsed.hostname
          .replace(/^www\./, "")
          .split(".")[0]
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
      } catch {
        businessName = "Basel Restaurant";
      }
    }

    const draftMcpProfile: DraftMcpProfile = {
      name: businessName,
      category: "restaurant",
      cuisine,
      address: "Basel, Switzerland",
      baseCapacity: 50,
      amenities: amenities.length > 0 ? amenities : ["terrace", "wifi"],
    };

    const recommendations = [
      "Transition from passive website or legacy CMS to a structured MCP directory profile.",
      "Publish real-time seat availability and outdoor terrace status.",
      "Activate 'trusted' certification status verified by civil entity signature to eliminate AI hallucinations.",
    ];

    const suggestedQuestionsForOwner = [
      `Confirm the restaurant name: "${businessName}"?`,
      `Is your primary cuisine type "${cuisine}"?`,
      `What is your exact street address in Basel?`,
      `What is your maximum seating capacity? (Suggested: ${draftMcpProfile.baseCapacity})`,
      `Do you have an outdoor terrace and do you welcome dogs?`,
    ];

    return {
      isWebsiteLegacy,
      seoScore,
      agentReadinessScore,
      missingData,
      detectedData: {
        title: rawTitle,
        description,
        hasSchemaOrg,
        hasOpenGraph,
        hasViewport,
        detectedKeywords,
      },
      recommendations,
      suggestedQuestionsForOwner,
      draftMcpProfile,
    };
  }

  private generateSummaryMessage(report: AuditReportDTO): string {
    const legacyStatus = report.isWebsiteLegacy
      ? "⚠️ Legacy website: Unstructured data for AI agents."
      : "✅ Partially structured data, but lacking real-time state.";

    return [
      `📊 Agent-Readiness Audit Report for "${report.draftMcpProfile.name}":`,
      `- AI accessibility score: ${report.agentReadinessScore}/100 (SEO score: ${report.seoScore}/100)`,
      `- Diagnosis: ${legacyStatus}`,
      `- Critical data missing for ChatGPT/Claude: ${report.missingData.slice(0, 3).join(", ")}`,
      `💡 Suggested MCP Profile: Cuisine: ${report.draftMcpProfile.cuisine}, capacity: ${report.draftMcpProfile.baseCapacity} seats, amenities: [${report.draftMcpProfile.amenities.join(", ")}].`,
      `👉 Ask the suggested questions to the business owner to finalize and save the profile using the 'save_business_profile' tool.`,
    ].join("\n");
  }
}

export const auditService = new AuditService();
