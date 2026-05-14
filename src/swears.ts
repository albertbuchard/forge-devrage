export interface SwearEntry {
  root: string;
  variants: string[];
}

export interface PhraseVariant {
  root: string;
  variant: string;
  pattern: RegExp;
}

export const defaultSwearLexicon: SwearEntry[] = [
  {
    root: "fuck",
    variants: [
      "fuck",
      "fucked",
      "fucker",
      "fuckers",
      "fuckin",
      "fucking",
      "fucks",
      "motherfuck",
      "motherfucked",
      "motherfucker",
      "motherfuckers",
      "motherfucking"
    ]
  },
  {
    root: "wtf",
    variants: ["wtf"]
  },
  {
    root: "shit",
    variants: [
      "shit",
      "shitshow",
      "shits",
      "shitty",
      "bullshit",
      "bullshitting",
      "dipshit",
      "dipshits"
    ]
  },
  {
    root: "dick",
    variants: ["dick", "dicks", "dickhead", "dickheads"]
  },
  {
    root: "ass",
    variants: [
      "ass",
      "asses",
      "asshole",
      "assholes",
      "ashole",
      "asholes",
      "dumbass",
      "dumbasses",
      "dumb ass",
      "dumb asses",
      "dumb-ass",
      "dumb-asses",
      "jackass",
      "jackasses",
      "jack ass",
      "jack asses",
      "jack-ass",
      "jack-asses"
    ]
  },
  {
    root: "damn",
    variants: ["damn", "damned", "dammit", "goddamn", "goddamned"]
  },
  {
    root: "bitch",
    variants: ["bitch", "bitches", "bitching"]
  },
  {
    root: "hell",
    variants: ["hell"]
  },
  {
    root: "crap",
    variants: ["crap", "crappy", "piece of crap", "piece-of-crap"]
  },
  {
    root: "moron",
    variants: ["moron", "morons", "morno", "mornos"]
  },
  {
    root: "idiot",
    variants: ["idiot", "idiots"]
  },
  {
    root: "stupid",
    variants: ["stupid"]
  },
  {
    root: "dumb",
    variants: ["dumb"]
  },
  {
    root: "garbage",
    variants: ["garbage"]
  },
  {
    root: "trash",
    variants: ["trash"]
  },
  {
    root: "suck",
    variants: ["suck", "sucks", "sucked", "sucking"]
  }
];

export function buildVariantIndex(lexicon = defaultSwearLexicon): Map<string, string> {
  const index = new Map<string, string>();

  for (const entry of lexicon) {
    for (const variant of entry.variants) {
      index.set(variant, entry.root);
    }
  }

  return index;
}

export function buildLexiconIndexes(lexicon = defaultSwearLexicon): {
  tokenIndex: Map<string, string>;
  phraseVariants: PhraseVariant[];
} {
  const tokenIndex = new Map<string, string>();
  const phraseVariants: PhraseVariant[] = [];

  for (const entry of lexicon) {
    for (const variant of entry.variants) {
      const normalizedVariant = variant.toLowerCase();

      if (isPhraseVariant(normalizedVariant)) {
        phraseVariants.push({
          root: entry.root,
          variant: normalizedVariant,
          pattern: buildPhrasePattern(normalizedVariant)
        });
        continue;
      }

      tokenIndex.set(normalizedVariant, entry.root);
    }
  }

  phraseVariants.sort((left, right) => right.variant.length - left.variant.length || left.variant.localeCompare(right.variant));

  return { tokenIndex, phraseVariants };
}

function isPhraseVariant(variant: string): boolean {
  return /[\s-]/.test(variant);
}

function buildPhrasePattern(variant: string): RegExp {
  const words = variant.split(/[\s-]+/).map(escapeRegExp);
  return new RegExp(`\\b${words.join("[\\s-]*")}\\b`, "gi");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
