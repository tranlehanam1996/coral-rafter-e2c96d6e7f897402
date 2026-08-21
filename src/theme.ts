import type { ThemeConfig } from "./types";

export const theme = {
  "id": "travel",
  "product": "Departure Canvas",
  "tagline": "Organize trip preparation with dependency-aware priorities.",
  "itemLabel": "Trip task",
  "dateLabel": "Complete by",
  "effortLabel": "Minutes",
  "impactLabel": "Trip impact",
  "categories": [
    "Documents",
    "Packing",
    "Transport",
    "Lodging",
    "Health"
  ],
  "seeds": [
    [
      "Verify travel documents",
      "Documents",
      20,
      5
    ],
    [
      "Build a capsule packing list",
      "Packing",
      35,
      3
    ],
    [
      "Confirm airport transfer",
      "Transport",
      15,
      4
    ]
  ]
} as const satisfies ThemeConfig;
