export type SongMood = "cozy" | "trending" | "cinematic";
export type SongEnergy = "low" | "mid" | "high";
export type SongArc = "build" | "chill" | "emotional" | "confident" | "dark" | "warm";

export type CatalogSong = {
  title: string;
  artist: string;
  query: string;
  use: string;
  mood: SongMood;
  energy: SongEnergy;
  arc: SongArc;
  keywords: string[];
  weight: number;
};

export const SONG_CATALOG: CatalogSong[] = [
  { title: "Love Me Not", artist: "Ravyn Lenae", query: "Love Me Not Ravyn Lenae official audio", use: "967K Reels · reflective self-love", mood: "trending", energy: "mid", arc: "emotional", keywords: ["love", "alone", "confidence", "reflect", "morning", "routine"], weight: 967 },
  { title: "Stan", artist: "Eminem feat. Dido", query: "Stan Eminem Dido audio", use: "storytelling throwback", mood: "cinematic", energy: "mid", arc: "dark", keywords: ["story", "letter", "obsess", "moody", "night", "think"], weight: 320 },
  { title: "Flower In A Hurricane", artist: "Justice, Tame Impala, SZA", query: "Flower In A Hurricane Justice Tame Impala SZA GTA VI", use: "424K reels · cinematic breakout", mood: "cinematic", energy: "high", arc: "build", keywords: ["storm", "change", "cinematic", "transition", "night", "city"], weight: 424 },
  { title: "APT.", artist: "ROSÉ & Bruno Mars", query: "APT ROSÉ Bruno Mars official audio", use: "6M Reels · high energy", mood: "trending", energy: "high", arc: "confident", keywords: ["fun", "party", "outfit", "city", "dance", "friends"], weight: 6000 },
  { title: "Ordinary", artist: "Alex Warren", query: "Ordinary Alex Warren official audio", use: "5M Reels · feel-good everyday", mood: "trending", energy: "mid", arc: "warm", keywords: ["everyday", "ordinary", "home", "love", "simple", "day"], weight: 5000 },
  { title: "Beautiful Things", artist: "Benson Boone", query: "Beautiful Things Benson Boone official audio", use: "3M Reels · emotional build", mood: "trending", energy: "high", arc: "build", keywords: ["grateful", "home", "morning", "life", "emotion", "reveal"], weight: 3000 },
  { title: "Die With A Smile", artist: "Lady Gaga & Bruno Mars", query: "Die With A Smile Lady Gaga Bruno Mars audio", use: "3M Reels · warm emotional", mood: "trending", energy: "mid", arc: "emotional", keywords: ["love", "together", "soft", "evening", "smile", "home"], weight: 3000 },
  { title: "As It Was", artist: "Harry Styles", query: "As It Was Harry Styles official audio", use: "3M Reels · nostalgic", mood: "trending", energy: "mid", arc: "emotional", keywords: ["nostalgia", "change", "alone", "past", "think", "lonely"], weight: 3000 },
  { title: "Viva La Vida", artist: "Coldplay", query: "Viva La Vida Coldplay official audio", use: "3M Reels · cinematic", mood: "cinematic", energy: "high", arc: "build", keywords: ["big", "epic", "reveal", "room", "city", "victory"], weight: 3000 },
  { title: "Dracula", artist: "Tame Impala", query: "Dracula Tame Impala official audio", use: "2M Reels · dark cinematic", mood: "cinematic", energy: "mid", arc: "dark", keywords: ["night", "dark", "mystery", "city", "edit", "moody"], weight: 2000 },
  { title: "Housewife", artist: "Tate McRae", query: "Housewife Tate McRae audio", use: "422K reels · confident beat cuts", mood: "trending", energy: "high", arc: "confident", keywords: ["home", "clean", "outfit", "confident", "reset", "routine"], weight: 422 },
  { title: "Nicole Kidman", artist: "ADÉLA", query: "Nicole Kidman ADÉLA audio", use: "683K reels · glam strut", mood: "trending", energy: "high", arc: "confident", keywords: ["glam", "outfit", "walk", "confident", "mirror", "look"], weight: 683 },
  { title: "Patient Zero", artist: "Taylor Swift", query: "Patient Zero Taylor Swift audio", use: "208K reels · moody story", mood: "cinematic", energy: "mid", arc: "emotional", keywords: ["story", "late", "night", "mood", "reveal", "change"], weight: 208 },
  { title: "Love Me", artist: "JMSN", query: "Love Me JMSN audio", use: "355K Reels · soft trend", mood: "cozy", energy: "low", arc: "chill", keywords: ["love", "soft", "slow", "morning", "hands", "routine"], weight: 355 },
  { title: "Calm Down", artist: "Rema & Selena Gomez", query: "Calm Down Rema Selena Gomez audio", use: "2M Reels · warm groove", mood: "trending", energy: "mid", arc: "warm", keywords: ["warm", "food", "cafe", "cook", "sun", "home"], weight: 2000 },
  { title: "Rush", artist: "Ayra Starr", query: "Rush Ayra Starr audio", use: "973K Reels · high energy", mood: "trending", energy: "high", arc: "confident", keywords: ["energy", "walk", "gym", "workout", "fun", "city"], weight: 973 },
  { title: "Starboy", artist: "The Weeknd", query: "Starboy The Weeknd audio", use: "439K Reels · sleek night", mood: "cinematic", energy: "mid", arc: "dark", keywords: ["night", "car", "city", "dark", "style", "luxury"], weight: 439 },
  { title: "Timeless", artist: "The Weeknd & Playboi Carti", query: "Timeless The Weeknd Playboi Carti audio", use: "529K Reels · late night", mood: "cinematic", energy: "mid", arc: "dark", keywords: ["night", "late", "mood", "city", "dark", "drive"], weight: 529 },
  { title: "I Wanna Be Yours", artist: "Arctic Monkeys", query: "I Wanna Be Yours Arctic Monkeys audio", use: "chart climbing · tender", mood: "cozy", energy: "mid", arc: "emotional", keywords: ["love", "home", "quiet", "morning", "soft", "together"], weight: 400 },
  { title: "Espresso", artist: "Sabrina Carpenter", query: "Espresso Sabrina Carpenter audio", use: "chart hit · bright confident", mood: "trending", energy: "high", arc: "confident", keywords: ["coffee", "morning", "fun", "bright", "outfit", "energy"], weight: 1200 },
  { title: "West Coast", artist: "Lana Del Rey", query: "West Coast Lana Del Rey audio", use: "slow cinematic", mood: "cozy", energy: "low", arc: "chill", keywords: ["slow", "coast", "summer", "drive", "haze", "quiet"], weight: 300 },
  { title: "Apocalypse", artist: "Cigarettes After Sex", query: "Apocalypse Cigarettes After Sex audio", use: "dreamy slow", mood: "cozy", energy: "low", arc: "chill", keywords: ["dream", "slow", "night", "soft", "rain", "quiet"], weight: 280 },
  { title: "BIRDS OF A FEATHER", artist: "Billie Eilish", query: "BIRDS OF A FEATHER Billie Eilish audio", use: "2M Reels · emotional", mood: "trending", energy: "mid", arc: "emotional", keywords: ["love", "sky", "walk", "soft", "nature", "feel"], weight: 2000 },
  { title: "End of Beginning", artist: "Djo", query: "End of Beginning Djo audio", use: "2M Reels · nostalgic", mood: "trending", energy: "mid", arc: "emotional", keywords: ["change", "past", "home", "grow", "reflect", "end"], weight: 2000 },
  { title: "The Sound of Silence (CYRIL Remix)", artist: "Disturbed", query: "Sound of Silence CYRIL remix Disturbed", use: "3M Reels · big build", mood: "cinematic", energy: "high", arc: "build", keywords: ["dark", "drop", "power", "city", "night", "reveal"], weight: 3000 },
  { title: "Raindance", artist: "Dave & Tems", query: "Raindance Dave Tems audio", use: "2M Reels · warm rhythm", mood: "trending", energy: "mid", arc: "warm", keywords: ["rain", "dance", "warm", "food", "home", "friends"], weight: 2000 },
  { title: "Die For You", artist: "The Weeknd", query: "Die For You The Weeknd audio", use: "slow emotional", mood: "cozy", energy: "low", arc: "emotional", keywords: ["love", "late", "night", "soft", "longing", "quiet"], weight: 500 },
  { title: "Blinding Lights", artist: "The Weeknd", query: "Blinding Lights The Weeknd audio", use: "2M+ Reels · night drive", mood: "trending", energy: "high", arc: "confident", keywords: ["night", "drive", "city", "energy", "retro", "walk"], weight: 2000 },
  { title: "Save Your Tears", artist: "The Weeknd", query: "Save Your Tears The Weeknd audio", use: "365K Reels · synth pop", mood: "trending", energy: "mid", arc: "emotional", keywords: ["night", "dance", "retro", "party", "feel", "city"], weight: 365 },
  { title: "After Hours", artist: "The Weeknd", query: "After Hours The Weeknd audio", use: "284K Reels · moody", mood: "cinematic", energy: "mid", arc: "dark", keywords: ["late", "night", "dark", "city", "moody", "drive"], weight: 284 },
  { title: "São Paulo", artist: "The Weeknd & Anitta", query: "Sao Paulo The Weeknd Anitta audio", use: "154K Reels · latin night", mood: "trending", energy: "high", arc: "confident", keywords: ["dance", "night", "party", "latin", "city", "energy"], weight: 154 },
  { title: "The Hills", artist: "The Weeknd", query: "The Hills The Weeknd audio", use: "classic dark edit", mood: "cinematic", energy: "mid", arc: "dark", keywords: ["night", "dark", "city", "car", "moody", "edit"], weight: 400 },
  { title: "In This Shirt", artist: "The Irrepressibles", query: "In This Shirt The Irrepressibles audio", use: "2M Reels · emotional strings", mood: "cinematic", energy: "mid", arc: "emotional", keywords: ["sad", "emotion", "slow", "story", "night", "remember"], weight: 2000 },
  { title: "Runaway", artist: "AURORA", query: "Runaway AURORA audio", use: "2M Reels · ethereal", mood: "cinematic", energy: "mid", arc: "build", keywords: ["nature", "dream", "run", "free", "sky", "emotion"], weight: 2000 },
  { title: "Perfect", artist: "Ed Sheeran", query: "Perfect Ed Sheeran audio", use: "2M Reels · warm love", mood: "trending", energy: "mid", arc: "warm", keywords: ["love", "wedding", "home", "soft", "together", "warm"], weight: 2000 },
  { title: "Strangers", artist: "Kenya Grace", query: "Strangers Kenya Grace audio", use: "2M Reels · cool vocal", mood: "trending", energy: "mid", arc: "chill", keywords: ["night", "walk", "city", "cool", "dance", "alone"], weight: 2000 },
  { title: "Anxiety", artist: "Doechii", query: "Anxiety Doechii audio", use: "2M Reels · rap edit", mood: "trending", energy: "high", arc: "confident", keywords: ["mind", "think", "fast", "edit", "honest", "mood"], weight: 2000 },
  { title: "Sweet Heat Lightning", artist: "Gregory Alan Isakov", query: "Sweet Heat Lightning Gregory Alan Isakov audio", use: "2M Reels · indie folk", mood: "cozy", energy: "low", arc: "chill", keywords: ["morning", "sun", "slow", "nature", "coffee", "home"], weight: 2000 },
  { title: "Papaoutai (Afro Soul)", artist: "mikeeysmind, Chill77 & Unjaps", query: "Papaoutai Afro Soul mikeeysmind audio", use: "3M Reels · afro groove", mood: "trending", energy: "high", arc: "confident", keywords: ["dance", "sun", "warm", "friends", "food", "energy"], weight: 3000 },
  { title: "Dai Dai", artist: "Shakira & Burna Boy", query: "Dai Dai Shakira Burna Boy audio", use: "2M Reels · global pop", mood: "trending", energy: "high", arc: "confident", keywords: ["dance", "summer", "party", "bright", "latin", "fun"], weight: 2000 },
  { title: "Lovely Day", artist: "Bill Withers", query: "Lovely Day Bill Withers audio", use: "965K Reels · feel-good classic", mood: "cozy", energy: "mid", arc: "warm", keywords: ["morning", "sun", "home", "smile", "coffee", "kind"], weight: 965 },
  { title: "Kiss of Life", artist: "Sade", query: "Kiss of Life Sade audio", use: "390K Reels · smooth soul", mood: "cozy", energy: "low", arc: "chill", keywords: ["love", "slow", "evening", "soft", "home", "warm"], weight: 390 },
  { title: "Celebration", artist: "Kool & The Gang", query: "Celebration Kool and the Gang audio", use: "647K Reels · feel-good", mood: "trending", energy: "high", arc: "confident", keywords: ["party", "fun", "friends", "dance", "bright", "celebrate"], weight: 647 },
  { title: "Here Comes The Sun", artist: "The Beatles", query: "Here Comes The Beatles audio", use: "fresh start / morning light", mood: "cozy", energy: "mid", arc: "warm", keywords: ["morning", "sun", "new", "hope", "home", "simple"], weight: 600 },
  { title: "Sweater Weather", artist: "The Neighbourhood", query: "Sweater Weather The Neighbourhood audio", use: "cozy autumn staple", mood: "cozy", energy: "mid", arc: "chill", keywords: ["cozy", "fall", "cold", "home", "sweater", "soft"], weight: 700 },
  { title: "Pink + White", artist: "Frank Ocean", query: "Pink and White Frank Ocean audio", use: "summer golden-hour edit", mood: "cozy", energy: "low", arc: "chill", keywords: ["summer", "sun", "golden", "soft", "dream", "slow"], weight: 500 },
  { title: "Time", artist: "Pink Floyd", query: "Time Pink Floyd audio", use: "477K reels · then vs now", mood: "cinematic", energy: "mid", arc: "build", keywords: ["time", "past", "change", "grow", "reflect", "years"], weight: 477 },
  { title: "Pump It", artist: "Black Eyed Peas", query: "Pump It Black Eyed Peas audio", use: "682K Reels · timestamp vlog trend", mood: "trending", energy: "high", arc: "confident", keywords: ["routine", "timestamps", "vlog", "energy", "morning", "day"], weight: 682 },
  { title: "Old Vibes", artist: "DROPLIKEAI", query: "Old Vibes DROPLIKEAI audio", use: "22K Reels · archive before-after", mood: "cinematic", energy: "mid", arc: "build", keywords: ["archive", "before", "after", "memory", "old", "reveal"], weight: 22 },
  { title: "Let Him Cook", artist: "XNIMXS", query: "Let Him Cook XNIMXS audio", use: "rising · process and reveal", mood: "trending", energy: "mid", arc: "build", keywords: ["cook", "process", "wait", "reveal", "food", "build"], weight: 300 },
];

export const TRENDING_HITS = SONG_CATALOG.filter((song) => song.mood === "trending");

const ENERGY_VALUE: Record<SongEnergy, number> = { low: 0.2, mid: 0.55, high: 0.85 };

export type VideoSignals = {
  focus: string;
  keywords: string[];
  energy: number;
  mood?: SongMood;
};

export function pickMood(text: string): SongMood {
  const lower = text.toLowerCase();
  if (/transform|before|after|makeover|reveal|night|cinematic|story/.test(lower)) return "cinematic";
  if (/slow|cozy|calm|morning|routine|coffee|tea|book|clean|home|alone|journal/.test(lower)) return "cozy";
  return "trending";
}

export function chooseSongForVideo(signals: VideoSignals): CatalogSong {
  const hay = `${signals.focus} ${signals.keywords.join(" ")}`.toLowerCase();
  const want = signals.mood ?? pickMood(hay);
  let best = TRENDING_HITS[0];
  let bestScore = -Infinity;
  for (const song of SONG_CATALOG) {
    const overlap = song.keywords.reduce((sum, word) => sum + (hay.includes(word) ? 1 : 0), 0);
    const energyGap = Math.abs(ENERGY_VALUE[song.energy] - signals.energy);
    const score = overlap * 5 + (song.mood === want ? 6 : 0) + (1 - energyGap) * 4 + Math.log10(1 + song.weight) * 0.6;
    if (score > bestScore) {
      bestScore = score;
      best = song;
    }
  }
  return best;
}

export function pickSong(mood: SongMood, text: string): CatalogSong {
  const pool = mood === "trending" ? TRENDING_HITS : SONG_CATALOG.filter((song) => song.mood === mood);
  const available = pool.length > 0 ? pool : SONG_CATALOG;
  const lower = text.toLowerCase();
  const mentioned = available.find((song) => lower.includes(song.title.toLowerCase()) || lower.includes(song.artist.toLowerCase()));
  if (mentioned) return mentioned;
  const seed = [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return available[seed % available.length];
}
