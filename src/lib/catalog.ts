export type CatalogEntry = {
  id: string;
  gloss: string;
  category: string;
  tier: 'free' | 'plus';
};

// Gloss labels only. No sign video or unverified movement instructions are bundled.
export const CATALOG: CatalogEntry[] = [
  ...[
    ['hello', 'Greetings'], ['thank you', 'Courtesy'], ['yes', 'Responses'], ['no', 'Responses'],
    ['please', 'Courtesy'], ['help', 'Needs'], ['goodbye', 'Greetings'], ['how are you', 'Conversation'],
    ['sorry', 'Courtesy'], ['I love you', 'Conversation'],
  ].map(([gloss, category]) => ({ id: gloss.replaceAll(' ', '-'), gloss, category, tier: 'free' as const })),
  ...[
    ['water', 'Needs'], ['food', 'Needs'], ['home', 'Places'], ['work', 'Places'],
    ['friend', 'People'], ['family', 'People'], ['today', 'Time'], ['tomorrow', 'Time'],
    ['good', 'Conversation'], ['bad', 'Conversation'], ['happy', 'Feelings'], ['sad', 'Feelings'],
    ['stop', 'Actions'], ['go', 'Actions'], ['wait', 'Actions'], ['understand', 'Conversation'],
    ['name', 'People'], ['where', 'Questions'], ['when', 'Questions'], ['why', 'Questions'],
  ].map(([gloss, category]) => ({ id: gloss.replaceAll(' ', '-'), gloss, category, tier: 'plus' as const })),
];
