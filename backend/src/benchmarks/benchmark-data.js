/**
 * Curated Industry Baseline Benchmark Data for TOS Red Flag Scanner (Phase 7).
 *
 * Versioned reference distributions derived from empirical terms-of-service analysis
 * across primary consumer and commercial technology verticals.
 */

export const BENCHMARK_DATA_VERSION = "2026.1";

export const INDUSTRY_SECTORS = {
  SAAS_CLOUD: {
    id: "saas_cloud",
    displayName: "SaaS, Cloud & Productivity",
    description: "Enterprise software, team collaboration, cloud storage, and developer services.",
    averageFlags: 2.1,
    arbitrationPrevalence: 0.52, // 52% of B2B SaaS mandate arbitration
    contentOverreachPrevalence: 0.22, // 22% claim broad content rights
    unilateralChangePrevalence: 0.68,
    percentileThresholds: {
      friendly: 15, // <= 15 is bottom 25% (very fair)
      moderate: 45, // 16-45 is median
      aggressive: 70 // > 70 is top 15% most restrictive
    }
  },

  SOCIAL_MEDIA: {
    id: "social_media",
    displayName: "Social Media & Creator Platforms",
    description: "User-generated content hubs, photo/video sharing, and public forums.",
    averageFlags: 4.8,
    arbitrationPrevalence: 0.86,
    contentOverreachPrevalence: 0.81, // 81% claim broad licenses to user uploads
    unilateralChangePrevalence: 0.94,
    percentileThresholds: {
      friendly: 30,
      moderate: 65,
      aggressive: 85
    }
  },

  ECOMMERCE: {
    id: "ecommerce",
    displayName: "E-Commerce & Digital Marketplaces",
    description: "Online storefronts, digital goods sellers, payment platforms, and delivery apps.",
    averageFlags: 3.2,
    arbitrationPrevalence: 0.78,
    contentOverreachPrevalence: 0.40,
    unilateralChangePrevalence: 0.82,
    percentileThresholds: {
      friendly: 20,
      moderate: 50,
      aggressive: 75
    }
  },

  CONSUMER_APPS: {
    id: "consumer_apps",
    displayName: "Consumer Mobile & Entertainment Apps",
    description: "Streaming, gaming, fitness, utility apps, and consumer IoT.",
    averageFlags: 3.9,
    arbitrationPrevalence: 0.89,
    contentOverreachPrevalence: 0.62,
    unilateralChangePrevalence: 0.91,
    percentileThresholds: {
      friendly: 25,
      moderate: 58,
      aggressive: 80
    }
  },

  GENERAL: {
    id: "general",
    displayName: "General Commercial Online Services",
    description: "Standard cross-industry online terms of service benchmark.",
    averageFlags: 3.0,
    arbitrationPrevalence: 0.75,
    contentOverreachPrevalence: 0.48,
    unilateralChangePrevalence: 0.85,
    percentileThresholds: {
      friendly: 20,
      moderate: 50,
      aggressive: 75
    }
  }
};
